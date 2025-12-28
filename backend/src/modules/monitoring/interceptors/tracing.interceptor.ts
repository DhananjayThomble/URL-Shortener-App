import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { TracingService } from '../services/tracing.service';
import { SpanKind } from '@opentelemetry/api';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracingService: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    
    const { method, url, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const userId = (request as any).user?.id;

    // Create span for HTTP request
    const span = this.tracingService.createSpan(`HTTP ${method} ${url}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': method,
        'http.url': url,
        'http.user_agent': userAgent,
        'user.id': userId || 'anonymous',
        'http.request_content_length': headers['content-length'] || '0',
      },
    });

    if (!span) {
      return next.handle();
    }

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const { statusCode } = response;

          span.setAttributes({
            'http.status_code': statusCode,
            'http.response_size': JSON.stringify(data).length,
            'http.duration_ms': duration,
            'operation.success': true,
          });

          // Add specific attributes based on endpoint
          this.addEndpointSpecificAttributes(method, url, data, span);

          span.setStatus({ code: 1 }); // OK
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          span.recordException(error);
          span.setAttributes({
            'http.status_code': statusCode,
            'http.duration_ms': duration,
            'operation.success': false,
            'error.name': error.name,
            'error.message': error.message,
          });

          span.setStatus({
            code: 2, // ERROR
            message: error.message,
          });
        },
        finalize: () => {
          span.end();
        },
      })
    );
  }

  private addEndpointSpecificAttributes(method: string, url: string, data: any, span: any) {
    // URL creation endpoints
    if (method === 'POST' && url.includes('/urls')) {
      span.setAttributes({
        'business.operation': 'url_creation',
        'url.has_custom_alias': !!(data?.customAlias),
        'url.has_expiration': !!(data?.expiresAt),
        'url.has_password': !!(data?.password),
      });
    }

    // URL access (redirect) endpoints
    if (method === 'GET' && url.match(/\/[a-zA-Z0-9]{10}$/)) {
      const shortCode = url.split('/').pop();
      span.setAttributes({
        'business.operation': 'url_access',
        'url.short_code': shortCode,
      });
    }

    // Authentication endpoints
    if (url.includes('/auth/')) {
      if (url.includes('/login')) {
        span.setAttributes({
          'business.operation': 'user_login',
          'auth.method': 'email_password',
        });
      } else if (url.includes('/register')) {
        span.setAttributes({
          'business.operation': 'user_registration',
        });
      } else if (url.includes('/refresh')) {
        span.setAttributes({
          'business.operation': 'token_refresh',
        });
      }
    }

    // Bio page endpoints
    if (url.includes('/bio/')) {
      if (method === 'GET') {
        span.setAttributes({
          'business.operation': 'bio_page_view',
          'bio.username': url.split('/bio/')[1]?.split('/')[0],
        });
      } else if (method === 'POST' || method === 'PUT') {
        span.setAttributes({
          'business.operation': 'bio_page_update',
        });
      }
    }

    // Analytics endpoints
    if (url.includes('/analytics')) {
      span.setAttributes({
        'business.operation': 'analytics_query',
        'analytics.type': this.extractAnalyticsType(url),
      });
    }

    // Bulk operations
    if (url.includes('/bulk')) {
      span.setAttributes({
        'business.operation': 'bulk_operation',
        'bulk.type': url.includes('/import') ? 'import' : 'export',
      });
    }

    // Health checks
    if (url.includes('/health')) {
      span.setAttributes({
        'business.operation': 'health_check',
        'health.type': this.extractHealthCheckType(url),
      });
    }

    // Metrics endpoints
    if (url.includes('/metrics')) {
      span.setAttributes({
        'business.operation': 'metrics_collection',
        'metrics.format': url.includes('/json') ? 'json' : 'prometheus',
      });
    }
  }

  private extractAnalyticsType(url: string): string {
    if (url.includes('/clicks')) return 'clicks';
    if (url.includes('/devices')) return 'devices';
    if (url.includes('/locations')) return 'locations';
    if (url.includes('/referrers')) return 'referrers';
    return 'general';
  }

  private extractHealthCheckType(url: string): string {
    if (url.includes('/detailed')) return 'detailed';
    if (url.includes('/ready')) return 'readiness';
    if (url.includes('/live')) return 'liveness';
    if (url.includes('/external')) return 'external';
    return 'basic';
  }
}