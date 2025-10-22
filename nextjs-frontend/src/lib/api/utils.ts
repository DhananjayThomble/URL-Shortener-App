import { APIError, NetworkError, handleAPIError } from './errors';
import toast from 'react-hot-toast';

/**
 * Wrapper for API calls that handles errors and loading states
 */
export const withErrorHandling = async <T>(
  apiCall: () => Promise<T>,
  options: {
    showSuccessToast?: boolean;
    successMessage?: string;
    showErrorToast?: boolean;
    onError?: (error: APIError | NetworkError | Error) => void;
    onSuccess?: (data: T) => void;
  } = {}
): Promise<T | null> => {
  const {
    showSuccessToast = false,
    successMessage = 'Operation completed successfully',
    showErrorToast = true,
    onError,
    onSuccess,
  } = options;

  try {
    const result = await apiCall();

    if (showSuccessToast) {
      toast.success(successMessage);
    }

    if (onSuccess) {
      onSuccess(result);
    }

    return result;
  } catch (error) {
    const handledError = handleAPIError(error as any);

    if (showErrorToast) {
      toast.error(handledError.message);
    }

    if (onError) {
      onError(handledError);
    }

    // Re-throw for component-level handling if needed
    throw handledError;
  }
};

/**
 * Hook-like wrapper for API calls with loading state
 */
export const createAsyncHandler = <T extends any[], R>(
  apiCall: (...args: T) => Promise<R>
) => {
  return async (
    ...args: T
  ): Promise<{
    data: R | null;
    error: APIError | NetworkError | Error | null;
    success: boolean;
  }> => {
    try {
      const data = await apiCall(...args);
      return { data, error: null, success: true };
    } catch (error) {
      const handledError = handleAPIError(error as any);
      return { data: null, error: handledError, success: false };
    }
  };
};

/**
 * Utility to check if an error is a specific API error
 */
export const isAPIError = (
  error: any,
  status?: number
): error is APIError => {
  if (!(error instanceof APIError)) return false;
  if (status !== undefined) return error.status === status;
  return true;
};

/**
 * Utility to check if an error is a network error
 */
export const isNetworkError = (error: any): error is NetworkError => {
  return error instanceof NetworkError;
};

/**
 * Utility to extract error message from various error types
 */
export const getErrorMessage = (error: any): string => {
  if (error instanceof APIError || error instanceof NetworkError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred';
};

/**
 * Utility to format validation errors
 */
export const formatValidationErrors = (error: APIError): Record<string, string> => {
  if (error.status !== 400 || !error.data?.errors) {
    return {};
  }

  const errors: Record<string, string> = {};
  
  if (Array.isArray(error.data.errors)) {
    error.data.errors.forEach((err: any) => {
      if (err.field && err.message) {
        errors[err.field] = err.message;
      }
    });
  } else if (typeof error.data.errors === 'object') {
    Object.entries(error.data.errors).forEach(([field, message]) => {
      errors[field] = String(message);
    });
  }

  return errors;
};

/**
 * Utility to retry API calls with exponential backoff
 */
export const retryWithBackoff = async <T>(
  apiCall: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> => {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (error instanceof APIError) {
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error;
        }
      }

      // Don't retry on the last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

/**
 * Utility to cancel API requests
 */
export const createCancellableRequest = <T>(
  apiCall: (signal: AbortSignal) => Promise<T>
) => {
  const controller = new AbortController();

  const request = apiCall(controller.signal);

  return {
    request,
    cancel: () => controller.abort(),
  };
};

/**
 * Utility to batch API requests
 */
export const batchRequests = async <T>(
  requests: Array<() => Promise<T>>,
  batchSize = 5
): Promise<T[]> => {
  const results: T[] = [];

  for (let i = 0; i < requests.length; i += batchSize) {
    const batch = requests.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(request => request()));
    results.push(...batchResults);
  }

  return results;
};

/**
 * Utility to debounce API calls
 */
export const debounceApiCall = <T extends any[], R>(
  apiCall: (...args: T) => Promise<R>,
  delay = 300
) => {
  let timeoutId: NodeJS.Timeout;

  return (...args: T): Promise<R> => {
    return new Promise((resolve, reject) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        try {
          const result = await apiCall(...args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, delay);
    });
  };
};