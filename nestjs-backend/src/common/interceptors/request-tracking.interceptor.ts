import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

import { EnhancedLoggerService } from '../services/enhanced-logger.service';
import { MetricsService } from '../services/metrics.service';
import { HealthService } from '../services/health.service';

@Injectable()
export class RequestTrackingInterceptor implements NestInterceptor {
  constructor(
    private logger: EnhancedLoggerService,
    private metricsService: MetricsService,
    private healthService: HealthService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    // Generate request ID if not present
    const requestId = request.headers['x-request-id'] || uuidv4();
    request.requestId = requestId;
    response.setHeader('X-Request-ID', requestId);

    const startTime = Date.now();
    const method = request.method;
    const url = request.url;
    const userAgent = request.get('User-Agent') || '';
    const ip = request.ip || request.connection.remoteAddress || '';
    const userId = request.user?.id;
    const adminId = request.admin?.id;

    // Create request context
    const requestContext = {
      requestId,
      method,
      url,
      ip,
      userAgent,
      userId,
      adminId,
    };

    // Log request start
    this.logger.logHttpRequest(method, url, 0, 0, {
      ...requestContext,
      phase: 'start',
    });

    return next.handle().pipe(
      tap((data) => {
        const responseTime = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Log successful request
        this.logger.logHttpRequest(method, url, statusCode, responseTime, {
          ...requestContext,
          phase: 'complete',
          success: true,
        });

        // Record metrics
        this.metricsService.recordHttpRequest(method, url, statusCode, responseTime);
        this.healthService.recordRequest(responseTime, false);

        // Log performance if slow
        if (responseTime > 1000) {
          this.logger.logPerformanceMetric('slow_request', responseTime, 'ms', requestContext);
        }
      }),
      catchError((error) => {
        const responseTime = Date.now() - startTime;
        const statusCode = error.status || 500;

        // Log error request
        this.logger.error('Request failed', error, {
          ...requestContext,
          phase: 'error',
          statusCode,
          responseTime,
        });

        // Record error metrics
        this.metricsService.recordHttpRequest(method, url, statusCode, responseTime);
        this.healthService.recordRequest(responseTime, true);

        // Log security events for suspicious activity
        if (statusCode === 401 || statusCode === 403) {
          this.logger.logSecurityEvent(
            'unauthorized_access_attempt',
            'medium',
            { method, url, statusCode, userAgent },
            requestContext,
          );
        }

        throw error;
      }),
    );
  }
}