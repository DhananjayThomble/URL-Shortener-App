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
import { QueryFailedError } from 'typeorm';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = null;
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = exception.name;
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        details = (exceptionResponse as any).details || (exceptionResponse as any).errors || null;
      }
    } else if (exception instanceof QueryFailedError) {
      // Database errors
      status = HttpStatus.BAD_REQUEST;
      error = 'Database Error';
      message = 'Database operation failed';
      
      // Don't expose sensitive database information in production
      if (process.env.NODE_ENV === 'development') {
        details = { 
          query: exception.query,
          parameters: exception.parameters,
          driverError: exception.driverError?.message 
        };
      }
    } else if (exception instanceof Error) {
      error = exception.name;
      message = exception.message;
      
      // Handle specific error types
      if (exception.message.includes('ECONNREFUSED')) {
        message = 'Service temporarily unavailable';
        status = HttpStatus.SERVICE_UNAVAILABLE;
      } else if (exception.message.includes('timeout')) {
        message = 'Request timeout';
        status = HttpStatus.REQUEST_TIMEOUT;
      }
    }

    const errorResponse = {
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(details && { details }),
      ...(request.headers['x-request-id'] && { requestId: request.headers['x-request-id'] }),
      ...(process.env.NODE_ENV === 'development' && {
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
    };

    // Log the error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : 'Unknown error',
      'GlobalExceptionFilter',
    );

    response.status(status).json(errorResponse);
  }
}