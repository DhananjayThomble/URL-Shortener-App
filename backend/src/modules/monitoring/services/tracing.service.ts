import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

@Injectable()
export class TracingService implements OnModuleInit {
  private readonly logger = new Logger(TracingService.name);
  private sdk: NodeSDK;
  private tracer: any;

  constructor() {
    this.initializeTracing();
  }

  onModuleInit() {
    this.logger.log('Distributed tracing initialized');
  }

  private initializeTracing() {
    // Skip tracing initialization in test environment
    if (process.env.NODE_ENV === 'test') {
      this.logger.log('Skipping OpenTelemetry initialization in test environment');
      return;
    }

    try {
      // Configure resource information
      const { Resource } = require('@opentelemetry/resources');
      const resource = Resource.default().merge(new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'nestjs-url-shortener',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }));

    // Configure exporters
    const exporters = [];

    // Jaeger exporter for distributed tracing
    if (process.env.JAEGER_ENDPOINT) {
      exporters.push(new JaegerExporter({
        endpoint: process.env.JAEGER_ENDPOINT,
      }));
    }

    // Prometheus exporter for metrics
    if (process.env.ENABLE_PROMETHEUS_TRACING === 'true') {
      exporters.push(new PrometheusExporter({
        port: parseInt(process.env.PROMETHEUS_METRICS_PORT || '9090'),
      }));
    }

    // Initialize SDK
    this.sdk = new NodeSDK({
      resource,
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable some instrumentations if needed
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable file system instrumentation to reduce noise
          },
        }),
      ],
      traceExporter: exporters.length > 0 ? exporters[0] : undefined,
    });

    // Start the SDK
    try {
      this.sdk.start();
      this.tracer = trace.getTracer('nestjs-url-shortener');
      this.logger.log('OpenTelemetry tracing started successfully');
    } catch (error) {
      this.logger.error('Failed to start OpenTelemetry tracing:', error);
    }
  } catch (error) {
    this.logger.error('Failed to initialize OpenTelemetry tracing:', error);
  }
  }

  // Create a new span for business operations
  createSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: Record<string, string | number | boolean>;
    parent?: any;
  }) {
    if (!this.tracer) {
      this.logger.warn('Tracer not initialized, returning no-op span');
      return null;
    }

    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    }, options?.parent);

    return span;
  }

  // Trace URL creation operation
  async traceUrlCreation<T>(
    userId: string,
    originalUrl: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan('url.create', {
      kind: SpanKind.INTERNAL,
      attributes: {
        'user.id': userId,
        'url.original': originalUrl,
        'operation.type': 'create',
      },
    });

    if (!span) {
      return operation();
    }

    try {
      const result = await operation();
      
      span.setAttributes({
        'operation.success': true,
        'url.short_code': (result as any)?.shortCode || 'unknown',
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace URL click operation
  async traceUrlClick<T>(
    shortCode: string,
    userAgent: string,
    ip: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan('url.click', {
      kind: SpanKind.SERVER,
      attributes: {
        'url.short_code': shortCode,
        'http.user_agent': userAgent,
        'client.ip': ip,
        'operation.type': 'click',
      },
    });

    if (!span) {
      return operation();
    }

    try {
      const result = await operation();
      
      span.setAttributes({
        'operation.success': true,
        'url.original': (result as any)?.originalUrl || 'unknown',
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace database operations
  async traceDatabaseOperation<T>(
    operation: string,
    table: string,
    query: string,
    dbOperation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`db.${operation}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
        'db.operation': operation,
        'db.sql.table': table,
        'db.statement': query.substring(0, 500), // Truncate long queries
      },
    });

    if (!span) {
      return dbOperation();
    }

    try {
      const result = await dbOperation();
      
      span.setAttributes({
        'operation.success': true,
        'db.rows_affected': Array.isArray(result) ? result.length : 1,
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace cache operations
  async traceCacheOperation<T>(
    operation: string,
    key: string,
    cacheOperation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`cache.${operation}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'cache.system': 'redis',
        'cache.operation': operation,
        'cache.key': key,
      },
    });

    if (!span) {
      return cacheOperation();
    }

    try {
      const result = await cacheOperation();
      
      span.setAttributes({
        'operation.success': true,
        'cache.hit': operation === 'get' && result !== null,
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace authentication operations
  async traceAuthOperation<T>(
    operation: string,
    email: string,
    authOperation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`auth.${operation}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'auth.operation': operation,
        'user.email': email,
      },
    });

    if (!span) {
      return authOperation();
    }

    try {
      const result = await authOperation();
      
      span.setAttributes({
        'operation.success': true,
        'auth.success': true,
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setAttributes({
        'auth.success': false,
        'auth.error': (error as Error).message,
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace external service calls
  async traceExternalService<T>(
    serviceName: string,
    operation: string,
    url: string,
    serviceCall: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`external.${serviceName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'service.name': serviceName,
        'service.operation': operation,
        'http.url': url,
        'http.method': 'GET', // Assuming GET, adjust as needed
      },
    });

    if (!span) {
      return serviceCall();
    }

    try {
      const result = await serviceCall();
      
      span.setAttributes({
        'operation.success': true,
        'http.status_code': 200, // Assuming success
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setAttributes({
        'http.status_code': 500, // Assuming error
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Trace bulk operations
  async traceBulkOperation<T>(
    operation: string,
    recordCount: number,
    userId: string,
    bulkOperation: () => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(`bulk.${operation}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'bulk.operation': operation,
        'bulk.record_count': recordCount,
        'user.id': userId,
      },
    });

    if (!span) {
      return bulkOperation();
    }

    try {
      const result = await bulkOperation();
      
      span.setAttributes({
        'operation.success': true,
        'bulk.processed_count': recordCount,
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }

  // Add custom attributes to current span
  addSpanAttributes(attributes: Record<string, string | number | boolean>) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  // Add event to current span
  addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>) {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  // Get current trace ID for correlation
  getCurrentTraceId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().traceId;
    }
    return undefined;
  }

  // Get current span ID
  getCurrentSpanId(): string | undefined {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().spanId;
    }
    return undefined;
  }

  // Shutdown tracing (useful for graceful shutdown)
  async shutdown(): Promise<void> {
    try {
      await this.sdk.shutdown();
      this.logger.log('OpenTelemetry tracing shut down successfully');
    } catch (error) {
      this.logger.error('Failed to shut down OpenTelemetry tracing:', error);
    }
  }

  // Health check for tracing service
  healthCheck(): { status: string; traceId?: string; spanId?: string } {
    const traceId = this.getCurrentTraceId();
    const spanId = this.getCurrentSpanId();
    
    return {
      status: this.tracer ? 'healthy' : 'unhealthy',
      traceId,
      spanId,
    };
  }
}