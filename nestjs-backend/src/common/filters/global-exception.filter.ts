import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ValidationError } from 'class-validator';
import { QueryFailedError, EntityNotFoundError } from 'typeorm';
import { MongoError } from 'mongodb';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  userAgent?: string;
  ip?: string;
  method?: string;
  url?: string;
  body?: any;
  query?: any;
  params?: any;
}

export interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    timestamp: string;
    requestId: string;
    path: string;
    method: string;
    statusCode: number;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorContext: ErrorContext = {
      requestId: request.headers['x-request-id'] as string || this.generateRequestId(),
      userId: request['user']?.id,
      userAgent: request.get('User-Agent'),
      ip: request.ip || request.connection.remoteAddress,
      method: request.method,
      url: request.url,
      body: this.sanitizeBody(request.body),
      query: request.query,
      params: request.params,
    };

    const errorResponse = this.buildErrorResponse(exception, errorContext);
    
    // Log the error with appropriate level
    this.logError(exception, errorContext, errorResponse);

    // Set response headers
    response.setHeader('X-Request-ID', errorContext.requestId);
    response.setHeader('Content-Type', 'application/json');

    // Send error response
    response.status(errorResponse.error.statusCode).json(errorResponse);
  }

  private buildErrorResponse(exception: unknown, context: ErrorContext): StandardErrorResponse {
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = 'An unexpected error occurred';
    let details: any = null;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      errorCode = this.getErrorCodeFromHttpException(exception);
      
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || message;
        details = responseObj.details || responseObj.errors || null;
        errorCode = responseObj.code || errorCode;
      }
    } else if (exception instanceof QueryFailedError) {
      statusCode = HttpStatus.BAD_REQUEST;
      errorCode = 'DATABASE_ERROR';
      message = 'Database operation failed';
      details = this.buildDatabaseErrorDetails(exception);
    } else if (exception instanceof EntityNotFoundError) {
      statusCode = HttpStatus.NOT_FOUND;
      errorCode = 'ENTITY_NOT_FOUND';
      message = 'The requested resource was not found';
    } else if (exception instanceof MongoError) {
      statusCode = HttpStatus.BAD_REQUEST;
      errorCode = 'MONGODB_ERROR';
      message = 'MongoDB operation failed';
      details = this.buildMongoErrorDetails(exception);
    } else if (exception instanceof TokenExpiredError) {
      statusCode = HttpStatus.UNAUTHORIZED;
      errorCode = 'TOKEN_EXPIRED';
      message = 'Authentication token has expired';
    } else if (exception instanceof JsonWebTokenError) {
      statusCode = HttpStatus.UNAUTHORIZED;
      errorCode = 'INVALID_TOKEN';
      message = 'Invalid authentication token';
    } else if (exception instanceof Error) {
      errorCode = this.getErrorCodeFromError(exception);
      message = exception.message;
      
      // Handle specific error patterns
      if (exception.message.includes('ECONNREFUSED')) {
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
        errorCode = 'SERVICE_UNAVAILABLE';
        message = 'External service is temporarily unavailable';
      } else if (exception.message.includes('timeout')) {
        statusCode = HttpStatus.REQUEST_TIMEOUT;
        errorCode = 'REQUEST_TIMEOUT';
        message = 'Request timed out';
      } else if (exception.message.includes('ENOTFOUND')) {
        statusCode = HttpStatus.BAD_GATEWAY;
        errorCode = 'DNS_RESOLUTION_FAILED';
        message = 'Unable to resolve external service';
      }
    }

    return {
      error: {
        code: errorCode,
        message,
        details,
        timestamp: new Date().toISOString(),
        requestId: context.requestId!,
        path: context.url!,
        method: context.method!,
        statusCode,
      },
    };
  }

  private getErrorCodeFromHttpException(exception: HttpException): string {
    const status = exception.getStatus();
    const statusCodeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
      [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
      [HttpStatus.GATEWAY_TIMEOUT]: 'GATEWAY_TIMEOUT',
    };

    return statusCodeMap[status] || 'HTTP_ERROR';
  }

  private getErrorCodeFromError(error: Error): string {
    const errorName = error.constructor.name;
    const errorNameMap: Record<string, string> = {
      'ValidationError': 'VALIDATION_ERROR',
      'CastError': 'INVALID_DATA_TYPE',
      'MongoError': 'DATABASE_ERROR',
      'TimeoutError': 'REQUEST_TIMEOUT',
      'TypeError': 'TYPE_ERROR',
      'ReferenceError': 'REFERENCE_ERROR',
      'SyntaxError': 'SYNTAX_ERROR',
    };

    return errorNameMap[errorName] || 'UNKNOWN_ERROR';
  }

  private buildDatabaseErrorDetails(error: QueryFailedError): any {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // Don't expose sensitive database information in production
      return {
        type: 'database_error',
        constraint: this.extractConstraintName(error.message),
      };
    }

    return {
      type: 'database_error',
      query: error.query,
      parameters: error.parameters,
      constraint: this.extractConstraintName(error.message),
      driverError: error.driverError?.message,
    };
  }

  private buildMongoErrorDetails(error: MongoError): any {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      return {
        type: 'mongodb_error',
        code: error.code,
      };
    }

    return {
      type: 'mongodb_error',
      code: error.code,
      codeName: error.codeName,
      errmsg: error.errmsg,
    };
  }

  private extractConstraintName(errorMessage: string): string | null {
    // Extract constraint name from database error messages
    const constraintMatch = errorMessage.match(/constraint "([^"]+)"/);
    if (constraintMatch) {
      return constraintMatch[1];
    }

    const uniqueMatch = errorMessage.match(/duplicate key value violates unique constraint "([^"]+)"/);
    if (uniqueMatch) {
      return uniqueMatch[1];
    }

    return null;
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') {
      return body;
    }

    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  private logError(exception: unknown, context: ErrorContext, errorResponse: StandardErrorResponse): void {
    const { error } = errorResponse;
    const logContext = {
      requestId: context.requestId,
      userId: context.userId,
      method: context.method,
      url: context.url,
      statusCode: error.statusCode,
      errorCode: error.code,
      userAgent: context.userAgent,
      ip: context.ip,
    };

    if (error.statusCode >= 500) {
      // Server errors - log as error with full stack trace
      this.logger.error(
        `${error.code}: ${error.message}`,
        exception instanceof Error ? exception.stack : 'Unknown error',
        logContext,
      );
    } else if (error.statusCode >= 400) {
      // Client errors - log as warning
      this.logger.warn(
        `${error.code}: ${error.message}`,
        logContext,
      );
    } else {
      // Other errors - log as debug
      this.logger.debug(
        `${error.code}: ${error.message}`,
        logContext,
      );
    }

    // Log security-related events
    if (error.statusCode === 401 || error.statusCode === 403) {
      this.logger.warn(
        `Security event: ${error.code} - ${context.method} ${context.url}`,
        {
          ...logContext,
          securityEvent: true,
          severity: 'medium',
        },
      );
    }

    // Log rate limiting events
    if (error.statusCode === 429) {
      this.logger.warn(
        `Rate limit exceeded: ${context.method} ${context.url}`,
        {
          ...logContext,
          rateLimitEvent: true,
        },
      );
    }
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}