import { QueryClient, DefaultOptions } from '@tanstack/react-query';
import { APIError } from '@/services/api/types';

/**
 * Query key factory for consistent query key management
 */
export const queryKeys = {
  // Authentication
  auth: ['auth'] as const,
  currentUser: () => [...queryKeys.auth, 'current-user'] as const,
  
  // URLs
  urls: ['urls'] as const,
  urlList: (params?: Record<string, any>) => [...queryKeys.urls, 'list', params] as const,
  url: (id: string) => [...queryKeys.urls, 'detail', id] as const,
  urlAnalytics: (id: string, params?: Record<string, any>) => [...queryKeys.urls, 'analytics', id, params] as const,
  
  // Analytics
  analytics: ['analytics'] as const,
  dashboardAnalytics: (params?: Record<string, any>) => [...queryKeys.analytics, 'dashboard', params] as const,
  
  // Bio Pages
  bioPages: ['bio-pages'] as const,
  bioPage: (id: string) => [...queryKeys.bioPages, 'detail', id] as const,
  publicBioPage: (username: string) => [...queryKeys.bioPages, 'public', username] as const,
  
  // Tags
  tags: ['tags'] as const,
  tagList: () => [...queryKeys.tags, 'list'] as const,
  
  // Bulk Operations
  bulkOperations: ['bulk-operations'] as const,
  bulkOperationStatus: (jobId: string) => [...queryKeys.bulkOperations, 'status', jobId] as const,
} as const;

/**
 * Default options for React Query
 */
const defaultOptions: DefaultOptions = {
  queries: {
    // Cache data for 5 minutes
    staleTime: 5 * 60 * 1000,
    // Keep data in cache for 10 minutes
    gcTime: 10 * 60 * 1000,
    // Retry failed requests
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors (client errors)
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const apiError = error as APIError;
        if (apiError.statusCode >= 400 && apiError.statusCode < 500) {
          return false;
        }
      }
      // Retry up to 3 times for other errors
      return failureCount < 3;
    },
    // Exponential backoff for retries
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    // Don't refetch on window focus by default (can be overridden per query)
    refetchOnWindowFocus: false,
    // Refetch on reconnect
    refetchOnReconnect: true,
    // Network mode - always try to fetch, even when offline
    networkMode: 'always',
  },
  mutations: {
    // Retry mutations on network errors
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors
      if (error && typeof error === 'object' && 'statusCode' in error) {
        const apiError = error as APIError;
        if (apiError.statusCode >= 400 && apiError.statusCode < 500) {
          return false;
        }
      }
      // Retry up to 2 times for other errors
      return failureCount < 2;
    },
    // Exponential backoff for mutation retries
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // Network mode
    networkMode: 'always',
  },
};

/**
 * Create and configure the React Query client
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions,
    logger: {
      log: console.log,
      warn: console.warn,
      error: (error) => {
        // Log errors but don't spam the console with network errors
        if (error && typeof error === 'object' && 'code' in error) {
          const apiError = error as APIError;
          if (apiError.code === 'NETWORK_ERROR') {
            console.warn('Network error occurred:', apiError.message);
            return;
          }
        }
        console.error('Query error:', error);
      },
    },
  });
}

/**
 * Utility function to invalidate related queries
 */
export const invalidateQueries = {
  // Invalidate all URL-related queries
  urls: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.urls });
  },
  
  // Invalidate specific URL
  url: (queryClient: QueryClient, id: string) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.url(id) });
  },
  
  // Invalidate analytics queries
  analytics: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.analytics });
  },
  
  // Invalidate bio page queries
  bioPages: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.bioPages });
  },
  
  // Invalidate tags
  tags: (queryClient: QueryClient) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  },
  
  // Invalidate all queries (use sparingly)
  all: (queryClient: QueryClient) => {
    queryClient.invalidateQueries();
  },
};

/**
 * Utility function to remove queries from cache
 */
export const removeQueries = {
  // Remove specific URL from cache
  url: (queryClient: QueryClient, id: string) => {
    queryClient.removeQueries({ queryKey: queryKeys.url(id) });
  },
  
  // Remove URL list queries (useful after bulk operations)
  urlLists: (queryClient: QueryClient) => {
    queryClient.removeQueries({ 
      queryKey: queryKeys.urls,
      predicate: (query) => query.queryKey.includes('list')
    });
  },
};

/**
 * Error boundary helper for React Query errors
 */
export function isQueryError(error: unknown): error is APIError {
  return error !== null && 
         typeof error === 'object' && 
         'code' in error && 
         'message' in error;
}

/**
 * Get error message from React Query error
 */
export function getQueryErrorMessage(error: unknown): string {
  if (isQueryError(error)) {
    return error.message;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'An unexpected error occurred';
}