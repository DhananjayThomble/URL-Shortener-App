import { HTTP_STATUS, ERROR_MESSAGES } from '@/lib/constants';

export class APIError extends Error {
  constructor(
    public status: number,
    public message: string,
    public data?: any
  ) {
    super(message);
    this.name = 'APIError';
  }

  static fromResponse(status: number, data?: any): APIError {
    let message: string = ERROR_MESSAGES.SERVER_ERROR;

    switch (status) {
      case HTTP_STATUS.BAD_REQUEST:
        message = data?.message || ERROR_MESSAGES.VALIDATION_ERROR;
        break;
      case HTTP_STATUS.UNAUTHORIZED:
        message = ERROR_MESSAGES.UNAUTHORIZED;
        break;
      case HTTP_STATUS.FORBIDDEN:
        message = ERROR_MESSAGES.FORBIDDEN;
        break;
      case HTTP_STATUS.NOT_FOUND:
        message = ERROR_MESSAGES.NOT_FOUND;
        break;
      case HTTP_STATUS.CONFLICT:
        message = data?.message || ERROR_MESSAGES.VALIDATION_ERROR;
        break;
      case HTTP_STATUS.TOO_MANY_REQUESTS:
        message = ERROR_MESSAGES.RATE_LIMITED;
        break;
      case HTTP_STATUS.INTERNAL_SERVER_ERROR:
        message = ERROR_MESSAGES.SERVER_ERROR;
        break;
      default:
        message = data?.message || ERROR_MESSAGES.SERVER_ERROR;
    }

    return new APIError(status, message, data);
  }
}

export class NetworkError extends Error {
  constructor(message: string = ERROR_MESSAGES.NETWORK_ERROR) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const handleAPIError = (error: APIError | NetworkError | Error) => {
  console.error('API Error:', error);

  if (error instanceof APIError) {
    switch (error.status) {
      case HTTP_STATUS.UNAUTHORIZED:
        // Handle token expiration - will be implemented with auth store
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        break;
      case HTTP_STATUS.FORBIDDEN:
        console.warn('Access denied:', error.message);
        break;
      case HTTP_STATUS.TOO_MANY_REQUESTS:
        console.warn('Rate limited:', error.message);
        break;
      default:
        console.error('API Error:', error.message);
    }
    return error;
  }

  if (error instanceof NetworkError) {
    console.error('Network Error:', error.message);
    return error;
  }

  // Generic error
  console.error('Unexpected Error:', error.message);
  return new APIError(HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
};