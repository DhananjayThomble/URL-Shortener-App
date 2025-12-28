import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { LoggingService } from '../services/logging.service';
import { MetricsService } from '../services/metrics.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly metricsService: MetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Generate correlation ID if not present
    const correlationId = request.headers['x-correlation-id'] as string || uuidv4();
    
    // Set correlation ID in logging service
    this.loggingService.setCorrelationId(correlationId);
    
    // Add correlation ID to response headers
    response.setHeader('x-correlation-id', correlationId);

    // Extract user ID from request if available
    const userId = (request as any).user?.id;

    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || '';

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const { statusCode } = response;

          // Log HTTP request
          this.loggingService.logHttpRequest(method, url, statusCode, duration, userId);

          // Record metrics
          this.metricsService.recordHttpRequest(method, url, statusCode, duration);

          // Log additional context for specific endpoints
          this.logEndpointSpecificData(method, url, data, userId);
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          // Log HTTP error
          this.loggingService.error(
            `HTTP ${method} ${url} - ${statusCode} (${duration}ms)`,
            error,
            {
              userId,
              module: 'http',
              operation: 'request-error',
              metadata: {
                method,
                url,
                statusCode,
                duration,
                userAgent,
                ip,
              },
            }
          );

          // Record error metrics
          this.metricsService.recordHttpRequest(method, url, statusCode, duration);
          this.metricsService.recordError(
            error.name || 'UnknownError',
            'http',
            this.getErrorSeverity(statusCode)
          );
        },
        finalize: () => {
          // Clear correlation ID after request
          this.loggingService.clearCorrelationId();
        },
      })
    );
  }

  private logEndpointSpecificData(method: string, url: string, data: any, userId?: string) {
    // Log specific business events based on endpoint patterns
    if (method === 'POST' && url.includes('/urls')) {
      this.loggingService.logUserAction(userId || 'anonymous', 'url-creation', {
        endpoint: url,
        hasData: !!data,
      });
    }

    if (method === 'GET' && url.match(/\/[a-zA-Z0-9]{10}$/)) {
      // This looks like a short URL access
      this.loggingService.logUserAction(userId || 'anonymous', 'url-access', {
        endpoint: url,
        shortCode: url.split('/').pop(),
      });
    }

    if (method === 'POST' && url.includes('/auth/login')) {
      this.loggingService.logUserAction(userId || 'anonymous', 'login-attempt', {
        endpoint: url,
      });
    }

    if (method === 'POST' && url.includes('/auth/register')) {
      this.loggingService.logUserAction(userId || 'anonymous', 'registration-attempt', {
        endpoint: url,
      });
    }

    if (url.includes('/bio/')) {
      this.loggingService.logUserAction(userId || 'anonymous', 'bio-page-interaction', {
        endpoint: url,
        method,
      });
    }
  }

  private getErrorSeverity(statusCode: number): 'low' | 'medium' | 'high' | 'critical' {
    if (statusCode >= 500) {
      return 'critical';
    } else if (statusCode >= 400) {
      return 'medium';
    } else {
      return 'low';
    }
  }
}