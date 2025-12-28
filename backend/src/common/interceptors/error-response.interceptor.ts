import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Request, Response } from 'express';

export interface SuccessResponse<T = any> {
  success: true;
  data: T;
  meta?: {
    timestamp: string;
    requestId: string;
    apiVersion: string;
    [key: string]: any;
  };
}

export interface ErrorResponse {
  success: false;
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

@Injectable()
export class ErrorResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    const requestId = request.headers['x-request-id'] as string || 
                     request['requestId'] || 
                     this.generateRequestId();
    const apiVersion = request['apiVersion'] || 'v1';

    return next.handle().pipe(
      map((data) => {
        // Don't wrap already wrapped responses
        if (data && typeof data === 'object' && ('success' in data || 'error' in data)) {
          return data;
        }

        // Don't wrap file downloads, redirects, or other special responses
        if (response.getHeader('content-type')?.toString().includes('application/octet-stream') ||
            response.statusCode === HttpStatus.FOUND ||
            response.statusCode === HttpStatus.MOVED_PERMANENTLY) {
          return data;
        }

        // Wrap successful responses
        const successResponse: SuccessResponse = {
          success: true,
          data,
          meta: {
            timestamp: new Date().toISOString(),
            requestId,
            apiVersion,
            statusCode: response.statusCode,
          },
        };

        return successResponse;
      }),
      catchError((error) => {
        // Error handling is done by GlobalExceptionFilter
        // This interceptor just ensures the error is properly propagated
        return throwError(() => error);
      }),
    );
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}