/**
 * React Query hooks for URL management
 * Provides optimistic updates, caching, and error handling
 */

import { 
  useQuery, 
  useMutation, 
  useQueryClient, 
  useInfiniteQuery,
  UseQueryOptions,
  UseMutationOptions
} from '@tanstack/react-query';
import { urlService } from '@/services/url.service';
import { 
  URL, 
  CreateUrlRequest, 
  UpdateUrlRequest, 
  URLListParams, 
  PaginatedResponse,
  QRCodeOptions,
  QRCodeResponse
} from '@/services/api/dto';
import { queryKeys, invalidateQueries, removeQueries } from '@/lib/react-query';
import { toast } from 'sonner';
import { useAuth } from './useAuth';

/**
 * Hook to fetch paginated URLs with caching
 */
export function useURLs(
  params: URLListParams = {},
  options?: Omit<UseQueryOptions<PaginatedResponse<URL>>, 'queryKey' | 'queryFn'>
) {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: queryKeys.urlList(params),
    queryFn: async () => {
      if (!isAuthenticated) {
        throw new Error('User not authenticated');
      }
      
      const result = await urlService.getURLs(params);
      if (!result) {
        throw new Error('Failed to fetch URLs');
      }
      return result;
    },
    enabled: isAuthenticated,
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...options,
  });
}

/**
 * Hook to fetch infinite paginated URLs (for infinite scrolling)
 */
export function useInfiniteURLs(
  baseParams: Omit<URLListParams, 'page'> = {},
  options?: Omit<Parameters<typeof useInfiniteQuery>[0], 'queryKey' | 'queryFn' | 'getNextPageParam'>
) {
  const { isAuthenticated } = useAuth();

  return useInfiniteQuery({
    queryKey: queryKeys.urlList(baseParams),
    queryFn: async ({ pageParam = 1 }) => {
      if (!isAuthenticated) {
        throw new Error('User not authenticated');
      }

      const params = { ...baseParams, page: pageParam };
      const result = await urlService.getURLs(params);
      if (!result) {
        throw new Error('Failed to fetch URLs');
      }
      return result;
    },
    getNextPageParam: (lastPage) => {
      return lastPage.pagination.hasNext ? lastPage.pagination.page + 1 : undefined;
    },
    enabled: isAuthenticated,
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...options,
  });
}

/**
 * Hook to fetch a single URL by ID
 */
export function useURL(
  id: string,
  options?: Omit<UseQueryOptions<URL>, 'queryKey' | 'queryFn'>
) {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: queryKeys.url(id),
    queryFn: async () => {
      if (!isAuthenticated) {
        throw new Error('User not authenticated');
      }
      
      const result = await urlService.getURL(id);
      if (!result) {
        throw new Error('Failed to fetch URL');
      }
      return result;
    },
    enabled: isAuthenticated && !!id,
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

/**
 * Hook to create a new URL with optimistic updates
 */
export function useCreateURL(
  options?: UseMutationOptions<URL, Error, CreateUrlRequest>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUrlRequest) => {
      const result = await urlService.createURL(data);
      if (!result) {
        throw new Error('Failed to create URL');
      }
      return result;
    },
    onMutate: async (newURL) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.urls });

      // Snapshot the previous value
      const previousURLs = queryClient.getQueriesData({ queryKey: queryKeys.urls });

      // Optimistically update to the new value
      queryClient.setQueriesData<PaginatedResponse<URL>>(
        { queryKey: queryKeys.urls, predicate: (query) => query.queryKey.includes('list') },
        (old) => {
          if (!old) return old;
          
          // Create optimistic URL object
          const optimisticURL: URL = {
            id: `temp-${Date.now()}`,
            shortCode: 'generating...',
            originalUrl: newURL.originalUrl,
            customBackHalf: newURL.customBackHalf,
            category: newURL.category,
            tags: newURL.tags || [],
            visitCount: 0,
            isActive: true,
            userId: 'current-user',
            expiresAt: newURL.expiresAt,
            customDomain: newURL.customDomain,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          return {
            ...old,
            data: [optimisticURL, ...old.data],
            pagination: {
              ...old.pagination,
              total: old.pagination.total + 1,
            },
          };
        }
      );

      return { previousURLs };
    },
    onError: (err, newURL, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousURLs) {
        context.previousURLs.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error('Failed to create URL');
    },
    onSuccess: (data) => {
      // Invalidate and refetch
      invalidateQueries.urls(queryClient);
      toast.success('URL created successfully!');
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.urls });
    },
    ...options,
  });
}

/**
 * Hook to update a URL with optimistic updates
 */
export function useUpdateURL(
  options?: UseMutationOptions<URL, Error, { id: string; data: UpdateUrlRequest }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }) => {
      const result = await urlService.updateURL(id, data);
      if (!result) {
        throw new Error('Failed to update URL');
      }
      return result;
    },
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.url(id) });

      // Snapshot the previous value
      const previousURL = queryClient.getQueryData<URL>(queryKeys.url(id));

      // Optimistically update to the new value
      queryClient.setQueryData<URL>(queryKeys.url(id), (old) => {
        if (!old) return old;
        return { ...old, ...data, updatedAt: new Date().toISOString() };
      });

      // Also update in list queries
      queryClient.setQueriesData<PaginatedResponse<URL>>(
        { queryKey: queryKeys.urls, predicate: (query) => query.queryKey.includes('list') },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map(url => 
              url.id === id 
                ? { ...url, ...data, updatedAt: new Date().toISOString() }
                : url
            ),
          };
        }
      );

      return { previousURL };
    },
    onError: (err, { id }, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousURL) {
        queryClient.setQueryData(queryKeys.url(id), context.previousURL);
      }
      toast.error('Failed to update URL');
    },
    onSuccess: (data) => {
      toast.success('URL updated successfully!');
    },
    onSettled: (data, error, { id }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.url(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.urls });
    },
    ...options,
  });
}

/**
 * Hook to delete a URL with optimistic updates
 */
export function useDeleteURL(
  options?: UseMutationOptions<boolean, Error, string>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await urlService.deleteURL(id);
      if (!result) {
        throw new Error('Failed to delete URL');
      }
      return result;
    },
    onMutate: async (id) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.urls });

      // Snapshot the previous value
      const previousURLs = queryClient.getQueriesData({ queryKey: queryKeys.urls });

      // Optimistically remove from list queries
      queryClient.setQueriesData<PaginatedResponse<URL>>(
        { queryKey: queryKeys.urls, predicate: (query) => query.queryKey.includes('list') },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.filter(url => url.id !== id),
            pagination: {
              ...old.pagination,
              total: Math.max(0, old.pagination.total - 1),
            },
          };
        }
      );

      return { previousURLs };
    },
    onError: (err, id, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousURLs) {
        context.previousURLs.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error('Failed to delete URL');
    },
    onSuccess: (data, id) => {
      // Remove the specific URL from cache
      removeQueries.url(queryClient, id);
      toast.success('URL deleted successfully!');
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: queryKeys.urls });
    },
    ...options,
  });
}

/**
 * Hook to generate QR code for a URL
 */
export function useGenerateQRCode(
  options?: UseMutationOptions<QRCodeResponse, Error, { id: string; options?: QRCodeOptions }>
) {
  return useMutation({
    mutationFn: async ({ id, options: qrOptions }) => {
      const result = await urlService.generateQRCode(id, qrOptions);
      if (!result) {
        throw new Error('Failed to generate QR code');
      }
      return result;
    },
    onError: () => {
      toast.error('Failed to generate QR code');
    },
    onSuccess: () => {
      toast.success('QR code generated successfully!');
    },
    ...options,
  });
}

/**
 * Hook to check alias availability
 */
export function useCheckAliasAvailability() {
  return useMutation({
    mutationFn: async (alias: string) => {
      return await urlService.checkAliasAvailability(alias);
    },
  });
}

/**
 * Hook to bulk update URL status
 */
export function useBulkUpdateURLStatus(
  options?: UseMutationOptions<boolean, Error, { ids: string[]; isActive: boolean }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, isActive }) => {
      const result = await urlService.bulkUpdateStatus(ids, isActive);
      if (!result) {
        throw new Error('Failed to bulk update URLs');
      }
      return result;
    },
    onSuccess: (data, { ids, isActive }) => {
      // Invalidate all URL queries to refetch updated data
      invalidateQueries.urls(queryClient);
      toast.success(`${ids.length} URLs ${isActive ? 'activated' : 'deactivated'} successfully!`);
    },
    onError: () => {
      toast.error('Failed to bulk update URLs');
    },
    ...options,
  });
}

/**
 * Prefetch URLs for better performance
 */
export function usePrefetchURLs() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const prefetchURLs = (params: URLListParams = {}) => {
    if (!isAuthenticated) return;

    queryClient.prefetchQuery({
      queryKey: queryKeys.urlList(params),
      queryFn: async () => {
        const result = await urlService.getURLs(params);
        if (!result) {
          throw new Error('Failed to fetch URLs');
        }
        return result;
      },
      staleTime: 2 * 60 * 1000, // 2 minutes
    });
  };

  const prefetchURL = (id: string) => {
    if (!isAuthenticated) return;

    queryClient.prefetchQuery({
      queryKey: queryKeys.url(id),
      queryFn: async () => {
        const result = await urlService.getURL(id);
        if (!result) {
          throw new Error('Failed to fetch URL');
        }
        return result;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };

  return { prefetchURLs, prefetchURL };
}
