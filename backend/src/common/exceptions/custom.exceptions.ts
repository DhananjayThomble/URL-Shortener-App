import { HttpException, HttpStatus } from '@nestjs/common';

export class BusinessLogicException extends HttpException {
  constructor(
    message: string,
    code: string = 'BUSINESS_LOGIC_ERROR',
    details?: any,
  ) {
    super(
      {
        code,
        message,
        details,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class ValidationException extends HttpException {
  constructor(
    message: string,
    validationErrors: any[] = [],
    code: string = 'VALIDATION_ERROR',
  ) {
    super(
      {
        code,
        message,
        details: {
          validationErrors,
        },
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class ResourceNotFoundException extends HttpException {
  constructor(
    resource: string,
    identifier?: string | number,
    code: string = 'RESOURCE_NOT_FOUND',
  ) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;

    super(
      {
        code,
        message,
        details: {
          resource,
          identifier,
        },
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class DuplicateResourceException extends HttpException {
  constructor(
    resource: string,
    field: string,
    value: string,
    code: string = 'DUPLICATE_RESOURCE',
  ) {
    super(
      {
        code,
        message: `${resource} with ${field} '${value}' already exists`,
        details: {
          resource,
          field,
          value,
        },
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class AuthenticationException extends HttpException {
  constructor(
    message: string = 'Authentication failed',
    code: string = 'AUTHENTICATION_FAILED',
    details?: any,
  ) {
    super(
      {
        code,
        message,
        details,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class AuthorizationException extends HttpException {
  constructor(
    message: string = 'Access denied',
    code: string = 'ACCESS_DENIED',
    requiredPermissions?: string[],
  ) {
    super(
      {
        code,
        message,
        details: {
          requiredPermissions,
        },
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export class RateLimitException extends HttpException {
  constructor(
    message: string = 'Rate limit exceeded',
    retryAfter?: number,
    code: string = 'RATE_LIMIT_EXCEEDED',
  ) {
    super(
      {
        code,
        message,
        details: {
          retryAfter,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class ExternalServiceException extends HttpException {
  constructor(
    service: string,
    message: string = 'External service error',
    code: string = 'EXTERNAL_SERVICE_ERROR',
    originalError?: any,
  ) {
    super(
      {
        code,
        message: `${service}: ${message}`,
        details: {
          service,
          originalError: process.env.NODE_ENV === 'development' ? originalError : undefined,
        },
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

export class ConfigurationException extends HttpException {
  constructor(
    configKey: string,
    message: string = 'Configuration error',
    code: string = 'CONFIGURATION_ERROR',
  ) {
    super(
      {
        code,
        message: `Configuration error for '${configKey}': ${message}`,
        details: {
          configKey,
        },
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class DataIntegrityException extends HttpException {
  constructor(
    message: string = 'Data integrity violation',
    constraint?: string,
    code: string = 'DATA_INTEGRITY_ERROR',
  ) {
    super(
      {
        code,
        message,
        details: {
          constraint,
        },
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class FileProcessingException extends HttpException {
  constructor(
    fileName: string,
    message: string = 'File processing error',
    code: string = 'FILE_PROCESSING_ERROR',
    details?: any,
  ) {
    super(
      {
        code,
        message: `File processing error for '${fileName}': ${message}`,
        details: {
          fileName,
          ...details,
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class LinkExpiredException extends BusinessLogicException {
  constructor(shortCode: string) {
    super(
      `Link '${shortCode}' has expired`,
      'LINK_EXPIRED',
      { shortCode },
    );
  }
}

export class LinkPasswordRequiredException extends HttpException {
  constructor(shortCode: string, hint?: string) {
    super(
      {
        code: 'LINK_PASSWORD_REQUIRED',
        message: 'This link is password protected',
        details: {
          shortCode,
          hint,
          requiresPassword: true,
        },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class InvalidPasswordException extends AuthenticationException {
  constructor(attempts?: number, maxAttempts?: number) {
    super(
      'Invalid password provided',
      'INVALID_PASSWORD',
      {
        attempts,
        maxAttempts,
        remainingAttempts: maxAttempts ? maxAttempts - (attempts || 0) : undefined,
      },
    );
  }
}

export class GeoTargetingException extends BusinessLogicException {
  constructor(country: string, message: string = 'Geo-targeting restriction') {
    super(
      `${message} for country '${country}'`,
      'GEO_TARGETING_RESTRICTION',
      { country },
    );
  }
}

export class AnalyticsException extends BusinessLogicException {
  constructor(message: string = 'Analytics processing error') {
    super(message, 'ANALYTICS_ERROR');
  }
}

export class BulkOperationException extends BusinessLogicException {
  constructor(
    operation: string,
    message: string = 'Bulk operation failed',
    errors?: any[],
  ) {
    super(
      `${operation}: ${message}`,
      'BULK_OPERATION_ERROR',
      {
        operation,
        errors,
      },
    );
  }
}

export class QuotaExceededException extends HttpException {
  constructor(
    quotaType: string,
    current: number,
    limit: number,
    resetDate?: Date,
  ) {
    super(
      {
        code: 'QUOTA_EXCEEDED',
        message: `${quotaType} quota exceeded`,
        details: {
          quotaType,
          current,
          limit,
          resetDate: resetDate?.toISOString(),
        },
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}