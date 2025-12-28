import { HttpStatus } from '@nestjs/common';

export class HttpStatusUtil {
  /**
   * Get human-readable status message for HTTP status code
   */
  static getStatusMessage(statusCode: number): string {
    const statusMessages: Record<number, string> = {
      // 2xx Success
      [HttpStatus.OK]: 'OK',
      [HttpStatus.CREATED]: 'Created',
      [HttpStatus.ACCEPTED]: 'Accepted',
      [HttpStatus.NO_CONTENT]: 'No Content',

      // 3xx Redirection
      [HttpStatus.MOVED_PERMANENTLY]: 'Moved Permanently',
      [HttpStatus.FOUND]: 'Found',
      [HttpStatus.NOT_MODIFIED]: 'Not Modified',

      // 4xx Client Error
      [HttpStatus.BAD_REQUEST]: 'Bad Request',
      [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
      [HttpStatus.PAYMENT_REQUIRED]: 'Payment Required',
      [HttpStatus.FORBIDDEN]: 'Forbidden',
      [HttpStatus.NOT_FOUND]: 'Not Found',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'Method Not Allowed',
      [HttpStatus.NOT_ACCEPTABLE]: 'Not Acceptable',
      [HttpStatus.REQUEST_TIMEOUT]: 'Request Timeout',
      [HttpStatus.CONFLICT]: 'Conflict',
      [HttpStatus.GONE]: 'Gone',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
      [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',

      // 5xx Server Error
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
      [HttpStatus.NOT_IMPLEMENTED]: 'Not Implemented',
      [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
      [HttpStatus.GATEWAY_TIMEOUT]: 'Gateway Timeout',
    };

    return statusMessages[statusCode] || 'Unknown Status';
  }

  /**
   * Check if status code indicates success (2xx)
   */
  static isSuccess(statusCode: number): boolean {
    return statusCode >= 200 && statusCode < 300;
  }

  /**
   * Check if status code indicates client error (4xx)
   */
  static isClientError(statusCode: number): boolean {
    return statusCode >= 400 && statusCode < 500;
  }

  /**
   * Check if status code indicates server error (5xx)
   */
  static isServerError(statusCode: number): boolean {
    return statusCode >= 500 && statusCode < 600;
  }

  /**
   * Check if status code indicates redirection (3xx)
   */
  static isRedirection(statusCode: number): boolean {
    return statusCode >= 300 && statusCode < 400;
  }

  /**
   * Get appropriate status code for common scenarios
   */
  static getStatusForScenario(scenario: string): number {
    const scenarioMap: Record<string, number> = {
      // Success scenarios
      'created': HttpStatus.CREATED,
      'updated': HttpStatus.OK,
      'deleted': HttpStatus.NO_CONTENT,
      'found': HttpStatus.OK,
      'listed': HttpStatus.OK,

      // Error scenarios
      'not_found': HttpStatus.NOT_FOUND,
      'validation_failed': HttpStatus.UNPROCESSABLE_ENTITY,
      'unauthorized': HttpStatus.UNAUTHORIZED,
      'forbidden': HttpStatus.FORBIDDEN,
      'conflict': HttpStatus.CONFLICT,
      'rate_limited': HttpStatus.TOO_MANY_REQUESTS,
      'server_error': HttpStatus.INTERNAL_SERVER_ERROR,
      'service_unavailable': HttpStatus.SERVICE_UNAVAILABLE,
      'bad_request': HttpStatus.BAD_REQUEST,

      // Specific business scenarios
      'link_expired': HttpStatus.GONE,
      'password_required': HttpStatus.UNAUTHORIZED,
      'quota_exceeded': HttpStatus.PAYMENT_REQUIRED,
      'geo_restricted': HttpStatus.FORBIDDEN,
    };

    return scenarioMap[scenario] || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  /**
   * Get error category based on status code
   */
  static getErrorCategory(statusCode: number): string {
    if (this.isClientError(statusCode)) {
      return 'client_error';
    } else if (this.isServerError(statusCode)) {
      return 'server_error';
    } else if (this.isRedirection(statusCode)) {
      return 'redirection';
    } else if (this.isSuccess(statusCode)) {
      return 'success';
    }
    return 'unknown';
  }

  /**
   * Get recommended retry strategy based on status code
   */
  static getRetryStrategy(statusCode: number): {
    shouldRetry: boolean;
    retryAfter?: number;
    maxRetries?: number;
  } {
    // Don't retry client errors (except specific cases)
    if (this.isClientError(statusCode)) {
      const retryableClientErrors = [
        HttpStatus.REQUEST_TIMEOUT,
        HttpStatus.TOO_MANY_REQUESTS,
      ];
      
      if (retryableClientErrors.includes(statusCode)) {
        return {
          shouldRetry: true,
          retryAfter: statusCode === HttpStatus.TOO_MANY_REQUESTS ? 60 : 5,
          maxRetries: 3,
        };
      }
      
      return { shouldRetry: false };
    }

    // Retry server errors with exponential backoff
    if (this.isServerError(statusCode)) {
      return {
        shouldRetry: true,
        retryAfter: 5,
        maxRetries: 3,
      };
    }

    return { shouldRetry: false };
  }

  /**
   * Get security implications of status code
   */
  static getSecurityImplications(statusCode: number): {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    securityRelevant: boolean;
    alertRequired: boolean;
  } {
    const securitySensitiveCodes = [
      HttpStatus.UNAUTHORIZED,
      HttpStatus.FORBIDDEN,
      HttpStatus.TOO_MANY_REQUESTS,
    ];

    const criticalCodes = [
      HttpStatus.INTERNAL_SERVER_ERROR,
      HttpStatus.BAD_GATEWAY,
      HttpStatus.SERVICE_UNAVAILABLE,
    ];

    if (securitySensitiveCodes.includes(statusCode)) {
      return {
        logLevel: 'warn',
        securityRelevant: true,
        alertRequired: statusCode === HttpStatus.TOO_MANY_REQUESTS,
      };
    }

    if (criticalCodes.includes(statusCode)) {
      return {
        logLevel: 'error',
        securityRelevant: false,
        alertRequired: true,
      };
    }

    if (this.isClientError(statusCode)) {
      return {
        logLevel: 'warn',
        securityRelevant: false,
        alertRequired: false,
      };
    }

    if (this.isServerError(statusCode)) {
      return {
        logLevel: 'error',
        securityRelevant: false,
        alertRequired: true,
      };
    }

    return {
      logLevel: 'info',
      securityRelevant: false,
      alertRequired: false,
    };
  }
}