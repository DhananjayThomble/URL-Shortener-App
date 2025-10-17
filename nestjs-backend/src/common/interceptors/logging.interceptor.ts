import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    
    const { method, url, ip } = request;
    const userAgent = request.get('User-Agent') || '';
    const startTime = Date.now();

    // Generate correlation ID for request tracking
    const correlationId = this.generateCorrelationId();
    request['correlationId'] = correlationId;

    this.logger.log(
      `Incoming Request: ${method} ${url} - IP: ${ip} - User-Agent: ${userAgent} - Correlation ID: ${correlationId}`,
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const { statusCode } = response;
          const responseTime = Date.now() - startTime;
          
          this.logger.log(
            `Outgoing Response: ${method} ${url} - ${statusCode} - ${responseTime}ms - Correlation ID: ${correlationId}`,
          );
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;
          
          this.logger.error(
            `Error Response: ${method} ${url} - ${error.status || 500} - ${responseTime}ms - Correlation ID: ${correlationId}`,
            error.stack,
          );
        },
      }),
    );
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}