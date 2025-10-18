import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';

export interface LogContext {
  requestId?: string;
  userId?: string;
  adminId?: string;
  ip?: string;
  userAgent?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  responseTime?: number;
  [key: string]: any;
}

@Injectable()
export class EnhancedLoggerService implements NestLoggerService {
  private logger: winston.Logger;

  constructor(private configService: ConfigService) {
    const logLevel = this.configService.get('LOG_LEVEL', 'info');
    const environment = this.configService.get('NODE_ENV', 'development');
    
    // Create custom format for structured logging
    const structuredFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
        const logEntry = {
          timestamp,
          level,
          message,
          service: 'nestjs-url-shortener',
          environment,
          ...(typeof context === 'object' && context !== null ? context : {}),
          ...meta,
        };
        return JSON.stringify(logEntry);
      }),
    );

    // Console format for development
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, context, ...meta }) => {
        const contextStr = context ? ` [${JSON.stringify(context)}]` : '';
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}: ${message}${contextStr}${metaStr}`;
      }),
    );

    const transports: winston.transport[] = [
      new winston.transports.Console({
        format: environment === 'production' ? structuredFormat : consoleFormat,
      }),
    ];

    // Add file transports for production
    if (environment === 'production') {
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: structuredFormat,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: structuredFormat,
          maxsize: 5242880, // 5MB
          maxFiles: 10,
        }),
      );

      // Add CloudWatch transport if configured
      const cloudWatchGroup = this.configService.get('CLOUDWATCH_LOG_GROUP');
      const cloudWatchStream = this.configService.get('CLOUDWATCH_LOG_STREAM');
      const awsRegion = this.configService.get('AWS_REGION');

      if (cloudWatchGroup && cloudWatchStream && awsRegion) {
        try {
          const CloudWatchTransport = require('winston-cloudwatch');
          transports.push(
            new CloudWatchTransport({
              logGroupName: cloudWatchGroup,
              logStreamName: cloudWatchStream,
              awsRegion: awsRegion,
              jsonMessage: true,
              messageFormatter: ({ level, message, ...meta }) => {
                return JSON.stringify({
                  level,
                  message,
                  timestamp: new Date().toISOString(),
                  service: 'nestjs-url-shortener',
                  ...meta,
                });
              },
            }),
          );
        } catch (error) {
          console.warn('CloudWatch transport not available:', error.message);
        }
      }
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports,
      exitOnError: false,
    });

    // Handle uncaught exceptions and unhandled rejections
    if (environment === 'production') {
      this.logger.exceptions.handle(
        new winston.transports.File({ filename: 'logs/exceptions.log' }),
      );

      this.logger.rejections.handle(
        new winston.transports.File({ filename: 'logs/rejections.log' }),
      );
    }
  }

  log(message: string, context?: LogContext | string) {
    const contextObj = typeof context === 'string' ? { context } : context;
    this.logger.info(message, { context: contextObj });
  }

  error(message: string, error?: Error | string, context?: LogContext | string) {
    const contextObj = typeof context === 'string' ? { context } : context;
    const errorInfo = error instanceof Error 
      ? { stack: error.stack, name: error.name, message: error.message }
      : { error };
    
    this.logger.error(message, { context: contextObj, ...errorInfo });
  }

  warn(message: string, context?: LogContext | string) {
    const contextObj = typeof context === 'string' ? { context } : context;
    this.logger.warn(message, { context: contextObj });
  }

  debug(message: string, context?: LogContext | string) {
    const contextObj = typeof context === 'string' ? { context } : context;
    this.logger.debug(message, { context: contextObj });
  }

  verbose(message: string, context?: LogContext | string) {
    const contextObj = typeof context === 'string' ? { context } : context;
    this.logger.verbose(message, { context: contextObj });
  }

  // Structured logging methods for specific events
  logHttpRequest(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    context?: LogContext,
  ) {
    this.logger.info('HTTP Request', {
      context: {
        ...context,
        method,
        url,
        statusCode,
        responseTime,
        type: 'http_request',
      },
    });
  }

  logDatabaseQuery(
    database: string,
    operation: string,
    duration: number,
    success: boolean,
    context?: LogContext,
  ) {
    this.logger.info('Database Query', {
      context: {
        ...context,
        database,
        operation,
        duration,
        success,
        type: 'database_query',
      },
    });
  }

  logCacheOperation(
    operation: string,
    key: string,
    hit: boolean,
    duration: number,
    context?: LogContext,
  ) {
    this.logger.info('Cache Operation', {
      context: {
        ...context,
        operation,
        key,
        hit,
        duration,
        type: 'cache_operation',
      },
    });
  }

  logSecurityEvent(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: Record<string, any>,
    context?: LogContext,
  ) {
    this.logger.warn('Security Event', {
      context: {
        ...context,
        event,
        severity,
        details,
        type: 'security_event',
      },
    });
  }

  logBusinessEvent(
    event: string,
    details: Record<string, any>,
    context?: LogContext,
  ) {
    this.logger.info('Business Event', {
      context: {
        ...context,
        event,
        details,
        type: 'business_event',
      },
    });
  }

  logPerformanceMetric(
    metric: string,
    value: number,
    unit: string,
    context?: LogContext,
  ) {
    this.logger.info('Performance Metric', {
      context: {
        ...context,
        metric,
        value,
        unit,
        type: 'performance_metric',
      },
    });
  }

  // Create child logger with persistent context
  createChildLogger(persistentContext: LogContext): EnhancedLoggerService {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(persistentContext);
    return childLogger;
  }

  // Get logger instance for advanced usage
  getWinstonLogger(): winston.Logger {
    return this.logger;
  }
}