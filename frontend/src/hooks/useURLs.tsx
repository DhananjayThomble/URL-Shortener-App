/**
 * URL Management Hook using React Query and NestJS Backend
 * Provides backward compatibility while using React Query for caching and optimistic updates
 */

import { useMemo } from "react";
import { 
  useURLs as useURLsQuery, 
  useCreateURL, 
  useUpdateURL, 
  useDeleteURL,
  useInfiniteURLs
} from "./useURLQueries";
import { URL, CreateUrlRequest, UpdateUrlRequest, URLListParams } from "@/services/api/dto";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface CreateURLParams {
  originalUrl: string;
  customAlias?: string;
  tagIds?: string[];
  category?: string;
  expiresAt?: string;
  customDomain?: string;
}

export interface UseURLsResult {
  urls: URL[];
  loading: boolean;
  error: string | null;
  pagination: PaginatedResponse<URL>['pagination'] | null;
  createURL: (params: CreateURLParams) => Promise<URL | null>;
  updateURL: (id: string, data: Partial<UpdateUrlRequest>) => Promise<URL | null>;
  deleteURL: (id: string) => Promise<boolean>;
  searchURLs: (query: string) => Promise<void>;
  filterByTags: (tags: string[]) => Promise<void>;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export interface UseURLsResult {
  urls: URL[];
  loading: boolean;
  error: string | null;
  pagination: any | null;
  createURL: (params: CreateURLParams) => Promise<URL | null>;
  updateURL: (id: string, data: Partial<UpdateUrlRequest>) => Promise<URL | null>;
  deleteURL: (id: string) => Promise<boolean>;
  searchURLs: (query: string) => void;
  filterByTags: (tags: string[]) => void;
  refetch: () => void;
  loadMore: () => void;
  hasMore: boolean;
}

export const useURLs = (initialParams: URLListParams = {}): UseURLsResult => {
  const { user, isAuthenticated } = useAuth();
  
  // Use React Query for data fetching
  const { 
    data, 
    isLoading, 
    error: queryError, 
    refetch: refetchQuery 
  } = useURLsQuery(initialParams, {
    enabled: isAuthenticated,
  });

  // Use infinite query for pagination
  const {
    data: infiniteData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteURLs(initialParams, {
    enabled: false, // We'll use this only when needed
  });

  // Mutations
  const createURLMutation = useCreateURL();
  const updateURLMutation = useUpdateURL();
  const deleteURLMutation = useDeleteURL();

  // Transform data for backward compatibility
  const urls = useMemo(() => {
    return data?.data || [];
  }, [data]);

  const pagination = useMemo(() => {
    return data?.pagination || null;
  }, [data]);

  const loading = isLoading || createURLMutation.isPending || updateURLMutation.isPending || deleteURLMutation.isPending;
  
  const error = useMemo(() => {
    if (queryError) {
      return queryError instanceof Error ? queryError.message : 'Unknown error occurred';
    }
    return null;
  }, [queryError]);

  const createURL = async (params: CreateURLParams): Promise<URL | null> => {
    if (!isAuthenticated) {
      toast.error("Please sign in to create links");
      return null;
    }

    try {
      // Convert CreateURLParams to CreateUrlRequest format
      const createRequest: CreateUrlRequest = {
        originalUrl: params.originalUrl,
        customBackHalf: params.customAlias,
        ...(params.category && { category: params.category }),
        ...(params.expiresAt && { expiresAt: params.expiresAt }),
        ...(params.customDomain && { customDomain: params.customDomain }),
        ...(params.tagIds && params.tagIds.length > 0) && {
          tags: params.tagIds.map(id => ({ name: id, value: id }))
        }
      };

      const result = await createURLMutation.mutateAsync(createRequest);
      return result;
    } catch (err) {
      console.error("Error creating URL:", err);
      return null;
    }
  };

  const updateURL = async (id: string, data: Partial<UpdateUrlRequest>): Promise<URL | null> => {
    try {
      const result = await updateURLMutation.mutateAsync({ id, data });
      return result;
    } catch (err) {
      console.error("Error updating URL:", err);
      return null;
    }
  };

  const deleteURL = async (id: string): Promise<boolean> => {
    try {
      await deleteURLMutation.mutateAsync(id);
      return true;
    } catch (err) {
      console.error("Error deleting URL:", err);
      return false;
    }
  };

  const searchURLs = (query: string): void => {
    // This would typically trigger a new query with search params
    // For now, we'll just refetch with the search parameter
    // In a full implementation, you'd want to update the query parameters
    console.log("Search functionality would be implemented here with query:", query);
  };

  const filterByTags = (tags: string[]): void => {
    // Similar to search, this would update query parameters
    console.log("Filter by tags functionality would be implemented here with tags:", tags);
  };

  const refetch = (): void => {
    refetchQuery();
  };

  const loadMore = (): void => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const hasMore = hasNextPage || false;

  return {
    urls,
    loading,
    error,
    pagination,
    createURL,
    updateURL,
    deleteURL,
    searchURLs,
    filterByTags,
    refetch,
    loadMore,
    hasMore
  };
};

// Backward compatibility hook that matches the old useLinks interface
export const useLinks = () => {
  const { urls, loading, createURL, deleteURL, updateURL, refetch } = useURLs();
  
  // Convert URL[] to LinkWithClicks[] for backward compatibility
  const linksWithClicks = useMemo(() => {
    return urls.map(url => ({
      id: url.id,
      user_id: url.userId,
      original_url: url.originalUrl,
      short_code: url.shortCode,
      custom_alias: url.customBackHalf,
      is_active: url.isActive,
      expires_at: url.expiresAt,
      created_at: url.createdAt,
      updated_at: url.updatedAt,
      clicks_count: url.visitCount
    }));
  }, [urls]);

  // Convert createURL params for backward compatibility
  const createLinkCompat = async (params: {
    originalUrl: string;
    customAlias?: string;
    tagIds?: string[];
    category?: string;
    expiresAt?: string;
    customDomain?: string;
  }) => {
    return await createURL(params);
  };

  return {
    links: linksWithClicks,
    loading,
    createLink: createLinkCompat,
    deleteLink: deleteURL,
    updateLink: updateURL,
    refetch
  };
};

export type LinkWithClicks = ReturnType<typeof useLinks>['links'][0];
