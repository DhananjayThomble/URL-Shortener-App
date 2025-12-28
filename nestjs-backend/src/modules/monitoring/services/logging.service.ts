import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

export interface LogContext {
  correlationId?: string;
  userId?: string;
  requestId?: string;
  module?: string;
  operation?: string;
  metadata?: Record<string, any>;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  correlationId?: string;
  userId?: string;
  requestId?: string;
  module?: string;
  operation?: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

@Injectable()
export class LoggingService implements LoggerService {
  private readonly logger: winston.Logger;
  private correlationId: string | null = null;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf((info: any) => {
          const logEntry: StructuredLogEntry = {
            timestamp: info.timestamp as string,
            level: info.level as string,
            message: info.message as string,
            correlationId: (info.correlationId as string) || this.correlationId,
            userId: info.userId as string,
            requestId: info.requestId as string,
            module: info.module as string,
            operation: info.operation as string,
            metadata: info.metadata as Record<string, any>,
          };

          if (info.error) {
            const error = info.error as Error;
            logEntry.error = {
              name: error.name,
              message: error.message,
              stack: error.stack,
            };
          }

          return JSON.stringify(logEntry);
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          maxsize: 5242880, // 5MB
          maxFiles: 10,
        }),
      ],
    });

    // Add CloudWatch transport in production
    if (process.env.NODE_ENV === 'production' && process.env.AWS_CLOUDWATCH_LOG_GROUP) {
      const CloudWatchTransport = require('winston-cloudwatch');
      this.logger.add(new CloudWatchTransport({
        logGroupName: process.env.AWS_CLOUDWATCH_LOG_GROUP,
        logStreamName: `${process.env.NODE_ENV}-${new Date().toISOString().split('T')[0]}`,
        awsRegion: process.env.AWS_REGION || 'us-east-1',
        jsonMessage: true,
      }));
    }
  }

  // Set correlation ID for request tracing
  setCorrelationId(correlationId: string) {
    this.correlationId = correlationId;
  }

  // Generate new correlation ID
  generateCorrelationId(): string {
    const correlationId = uuidv4();
    this.setCorrelationId(correlationId);
    return correlationId;
  }

  // Clear correlation ID
  clearCorrelationId() {
    this.correlationId = null;
  }

  // Standard logging methods
  log(message: string, context?: LogContext) {
    this.logger.info(message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    this.logger.error(message, { ...context, error });
  }

  warn(message: string, context?: LogContext) {
    this.logger.warn(message, context);
  }

  debug(message: string, context?: LogContext) {
    this.logger.debug(message, context);
  }

  verbose(message: string, context?: LogContext) {
    this.logger.verbose(message, context);
  }

  // Business-specific logging methods
  logUserAction(userId: string, action: string, metadata?: Record<string, any>) {
    this.log(`User action: ${action}`, {
      userId,
      module: 'user-actions',
      operation: action,
      metadata,
    });
  }

  logUrlCreation(userId: string, urlId: string, originalUrl: string, shortCode: string) {
    this.log('URL created', {
      userId,
      module: 'urls',
      operation: 'create',
      metadata: {
        urlId,
        originalUrl,
        shortCode,
      },
    });
  }

  logUrlClick(urlId: string, clickData: Record<string, any>) {
    this.log('URL clicked', {
      module: 'analytics',
      operation: 'click',
      metadata: {
        urlId,
        ...clickData,
      },
    });
  }

  logAuthAttempt(email: string, success: boolean, reason?: string) {
    this.log(`Authentication attempt: ${success ? 'success' : 'failed'}`, {
      module: 'auth',
      operation: 'login',
      metadata: {
        email,
        success,
        reason,
      },
    });
  }

  logSecurityEvent(eventType: string, severity: 'low' | 'medium' | 'high' | 'critical', details: Record<string, any>) {
    const logMethod = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
    
    if (logMethod === 'error') {
      this.error(`Security event: ${eventType}`, undefined, {
        module: 'security',
        operation: eventType,
        metadata: {
          severity,
          ...details,
        },
      });
    } else {
      this.warn(`Security event: ${eventType}`, {
        module: 'security',
        operation: eventType,
        metadata: {
          severity,
          ...details,
        },
      });
    }
  }

  logDatabaseOperation(operation: string, table: string, duration: number, success: boolean, error?: Error) {
    const message = `Database ${operation} on ${table}: ${success ? 'success' : 'failed'} (${duration}ms)`;
    
    if (success) {
      this.log(message, {
        module: 'database',
        operation,
        metadata: {
          table,
          duration,
          success,
        },
      });
    } else {
      this.error(message, error, {
        module: 'database',
        operation,
        metadata: {
          table,
          duration,
          success,
        },
      });
    }
  }

  logCacheOperation(operation: string, key: string, hit: boolean, duration?: number) {
    this.log(`Cache ${operation}: ${hit ? 'hit' : 'miss'}`, {
      module: 'cache',
      operation,
      metadata: {
        key,
        hit,
        duration,
      },
    });
  }

  logHttpRequest(method: string, url: string, statusCode: number, duration: number, userId?: string) {
    this.log(`HTTP ${method} ${url} - ${statusCode} (${duration}ms)`, {
      userId,
      module: 'http',
      operation: 'request',
      metadata: {
        method,
        url,
        statusCode,
        duration,
      },
    });
  }

  logHealthCheck(result: any) {
    const isHealthy = result.status === 'ok';
    const message = `Health check: ${isHealthy ? 'healthy' : 'unhealthy'}`;
    
    if (isHealthy) {
      this.log(message, {
        module: 'health',
        operation: 'check',
        metadata: result,
      });
    } else {
      this.warn(message, {
        module: 'health',
        operation: 'check',
        metadata: result,
      });
    }
  }

  logDetailedHealthCheck(healthStatus: any) {
    this.log(`Detailed health check: ${healthStatus.overall}`, {
      module: 'health',
      operation: 'detailed-check',
      metadata: healthStatus,
    });
  }

  logBulkOperation(operation: string, userId: string, recordCount: number, success: boolean, duration: number, errors?: any[]) {
    const message = `Bulk ${operation}: ${success ? 'completed' : 'failed'} - ${recordCount} records (${duration}ms)`;
    
    if (success) {
      this.log(message, {
        userId,
        module: 'bulk-operations',
        operation,
        metadata: {
          recordCount,
          duration,
          success,
        },
      });
    } else {
      this.error(message, undefined, {
        userId,
        module: 'bulk-operations',
        operation,
        metadata: {
          recordCount,
          duration,
          success,
          errors,
        },
      });
    }
  }

  logRateLimitHit(endpoint: string, userId?: string, ip?: string) {
    this.warn('Rate limit exceeded', {
      userId,
      module: 'rate-limiting',
      operation: 'limit-exceeded',
      metadata: {
        endpoint,
        ip,
      },
    });
  }

  logPerformanceMetric(operation: string, duration: number, metadata?: Record<string, any>) {
    this.log(`Performance metric: ${operation} took ${duration}ms`, {
      module: 'performance',
      operation,
      metadata: {
        duration,
        ...metadata,
      },
    });
  }

  // Error aggregation for monitoring
  logAggregatedError(errorType: string, count: number, timeWindow: string) {
    this.error(`Aggregated error: ${errorType} occurred ${count} times in ${timeWindow}`, undefined, {
      module: 'error-aggregation',
      operation: 'aggregate',
      metadata: {
        errorType,
        count,
        timeWindow,
      },
    });
  }

  // System events
  logSystemEvent(event: string, metadata?: Record<string, any>) {
    this.log(`System event: ${event}`, {
      module: 'system',
      operation: event,
      metadata,
    });
  }

  // Query logging for slow queries
  logSlowQuery(query: string, duration: number, database: string) {
    this.warn(`Slow query detected: ${duration}ms`, {
      module: 'database',
      operation: 'slow-query',
      metadata: {
        query: query.substring(0, 500), // Truncate long queries
        duration,
        database,
      },
    });
  }

  // Configuration logging
  logConfigurationChange(key: string, oldValue: any, newValue: any, userId?: string) {
    this.log(`Configuration changed: ${key}`, {
      userId,
      module: 'configuration',
      operation: 'change',
      metadata: {
        key,
        oldValue,
        newValue,
      },
    });
  }

  // Get logger instance for advanced usage
  getWinstonLogger(): winston.Logger {
    return this.logger;
  }

  // Flush logs (useful for testing and shutdown)
  async flush(): Promise<void> {
    return new Promise((resolve) => {
      this.logger.on('finish', resolve);
      this.logger.end();
    });
  }
}