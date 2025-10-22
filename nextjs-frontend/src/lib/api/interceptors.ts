import { apiClient } from './client';
import { APIError } from './errors';
import { HTTP_STATUS } from '@/lib/constants';

// Token management utilities
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token!);
    }
  });

  failedQueue = [];
};

/**
 * Setup automatic token refresh interceptor
 * This will be called when the auth store is initialized
 */
export const setupTokenInterceptor = (
  getRefreshToken: () => string | null,
  refreshTokens: () => Promise<{ accessToken: string; refreshToken: string }>,
  logout: () => void
) => {
  // Store original request method
  const originalRequest = apiClient.get.bind(apiClient);

  // Override the request method to add retry logic
  const requestWithRetry = async (endpoint: string, options: any = {}) => {
    try {
      return await originalRequest(endpoint, options);
    } catch (error) {
      if (error instanceof APIError && error.status === HTTP_STATUS.UNAUTHORIZED) {
        const refreshToken = getRefreshToken();

        if (!refreshToken) {
          logout();
          throw error;
        }

        if (isRefreshing) {
          // If already refreshing, queue this request
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((token) => {
            apiClient.setAccessToken(token as string);
            return originalRequest(endpoint, options);
          });
        }

        isRefreshing = true;

        try {
          const tokens = await refreshTokens();
          apiClient.setAccessToken(tokens.accessToken);
          processQueue(null, tokens.accessToken);
          
          // Retry original request
          return await originalRequest(endpoint, options);
        } catch (refreshError) {
          processQueue(refreshError, null);
          logout();
          throw refreshError;
        } finally {
          isRefreshing = false;
        }
      }

      throw error;
    }
  };

  // Note: In a real implementation, you would need to override all HTTP methods
  // This is a simplified example showing the concept
};

/**
 * Request interceptor to add correlation ID and timing
 */
export const addRequestInterceptor = () => {
  // Add request ID for tracking
  const generateRequestId = () => {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  // This would be implemented as middleware in the actual fetch call
  return {
    onRequest: (config: RequestInit & { url?: string }) => {
      // Add request ID header
      const headers = new Headers(config.headers);
      headers.set('X-Request-ID', generateRequestId());
      headers.set('X-Client-Version', process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0');
      
      return {
        ...config,
        headers,
      };
    },
  };
};

/**
 * Response interceptor for logging and error handling
 */
export const addResponseInterceptor = () => {
  return {
    onResponse: (response: Response, requestId?: string) => {
      // Log successful responses in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[API] ${response.status} ${response.url}`, {
          requestId,
          status: response.status,
          statusText: response.statusText,
        });
      }

      return response;
    },

    onError: (error: any, requestId?: string) => {
      // Log errors
      console.error(`[API Error] ${requestId}:`, error);

      // Add additional error context
      if (error instanceof APIError) {
        error.data = {
          ...error.data,
          requestId,
          timestamp: new Date().toISOString(),
        };
      }

      return error;
    },
  };
};

/**
 * Setup all interceptors
 */
export const setupInterceptors = (authCallbacks: {
  getRefreshToken: () => string | null;
  refreshTokens: () => Promise<{ accessToken: string; refreshToken: string }>;
  logout: () => void;
}) => {
  setupTokenInterceptor(
    authCallbacks.getRefreshToken,
    authCallbacks.refreshTokens,
    authCallbacks.logout
  );

  const requestInterceptor = addRequestInterceptor();
  const responseInterceptor = addResponseInterceptor();

  return {
    requestInterceptor,
    responseInterceptor,
  };
};