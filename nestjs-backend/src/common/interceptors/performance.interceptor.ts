import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { PerformanceService } from '../services/performance.service';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);

  constructor(private performanceService: PerformanceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    const startTime = Date.now();
    const method = request.method;
    const url = request.url;
    
    // Track the request
    this.performanceService.trackRequest();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;
          
          // Log slow requests
          if (duration > 1000) {
            this.logger.warn(
              `Slow request detected: ${method} ${url} - ${duration}ms - Status: ${statusCode}`
            );
          }
          
          // Add performance headers
          response.setHeader('X-Response-Time', `${duration}ms`);
          response.setHeader('X-Request-ID', request['requestId'] || 'unknown');
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          
          // Track the error
          this.performanceService.trackError();
          
          this.logger.error(
            `Request error: ${method} ${url} - ${duration}ms - Error: ${error.message}`
          );
        },
      }),
    );
  }
}