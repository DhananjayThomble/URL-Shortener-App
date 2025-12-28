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
import { PerformanceMonitoringService } from '../services/performance-monitoring.service';

@Injectable()
export class PerformanceMonitoringInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceMonitoringInterceptor.name);

  constructor(
    private readonly performanceMonitoringService: PerformanceMonitoringService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Track active connections
    this.trackActiveConnection(true);

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(request, response, startTime);
        },
        error: (error) => {
          this.recordMetrics(request, response, startTime, error);
        },
        finalize: () => {
          this.trackActiveConnection(false);
        },
      }),
    );
  }

  private recordMetrics(
    request: Request,
    response: Response,
    startTime: number,
    error?: any,
  ): void {
    try {
      const responseTime = Date.now() - startTime;
      const statusCode = error ? 500 : response.statusCode;

      // Record HTTP metrics
      this.performanceMonitoringService.recordHTTPRequest(responseTime, statusCode);

      // Log slow requests
      const slowRequestThreshold = 1000; // 1 second
      if (responseTime > slowRequestThreshold) {
        this.logger.warn(`Slow request detected: ${request.method} ${request.url} - ${responseTime}ms`, {
          method: request.method,
          url: request.url,
          responseTime,
          statusCode,
          userAgent: request.get('User-Agent'),
          ip: request.ip,
        });
      }

      // Log errors
      if (error) {
        this.logger.error(`Request error: ${request.method} ${request.url}`, {
          error: error.message,
          stack: error.stack,
          method: request.method,
          url: request.url,
          responseTime,
          ip: request.ip,
        });
      }
    } catch (monitoringError) {
      this.logger.error('Failed to record performance metrics:', monitoringError);
    }
  }

  private trackActiveConnection(increment: boolean): void {
    // This would typically be implemented with a counter
    // For now, we'll just log the connection tracking
    if (increment) {
      // Increment active connections counter
    } else {
      // Decrement active connections counter
    }
  }
}