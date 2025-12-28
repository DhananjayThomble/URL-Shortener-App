import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export interface TracingContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  requestId: string;
  startTime: number;
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      tracing?: TracingContext;
      requestId?: string;
    }
  }
}

@Injectable()
export class TracingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Extract or generate trace information
    const traceId = req.headers['x-trace-id'] as string || uuidv4();
    const parentSpanId = req.headers['x-parent-span-id'] as string;
    const spanId = uuidv4();
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    
    // Create tracing context
    const tracing: TracingContext = {
      traceId,
      spanId,
      parentSpanId,
      requestId,
      startTime: Date.now(),
    };

    // Attach to request
    req.tracing = tracing;
    req.requestId = requestId;

    // Set response headers for downstream services
    res.setHeader('X-Trace-ID', traceId);
    res.setHeader('X-Span-ID', spanId);
    res.setHeader('X-Request-ID', requestId);

    // Add correlation ID to all logs in this request context
    const originalJson = res.json;
    res.json = function(body) {
      // Add tracing info to response if in debug mode
      if (process.env.NODE_ENV === 'development') {
        if (typeof body === 'object' && body !== null) {
          body._tracing = {
            traceId,
            spanId,
            requestId,
            processingTime: Date.now() - tracing.startTime,
          };
        }
      }
      return originalJson.call(this, body);
    };

    next();
  }
}

// Utility class for creating child spans
export class TracingService {
  static createChildSpan(req: Request, operationName: string): TracingContext {
    const parentTracing = req.tracing;
    
    if (!parentTracing) {
      // Create new trace if none exists
      return {
        traceId: uuidv4(),
        spanId: uuidv4(),
        requestId: req.requestId || uuidv4(),
        startTime: Date.now(),
      };
    }

    return {
      traceId: parentTracing.traceId,
      spanId: uuidv4(),
      parentSpanId: parentTracing.spanId,
      requestId: parentTracing.requestId,
      startTime: Date.now(),
    };
  }

  static finishSpan(span: TracingContext, success: boolean = true): {
    duration: number;
    success: boolean;
  } {
    return {
      duration: Date.now() - span.startTime,
      success,
    };
  }

  static getTraceHeaders(tracing: TracingContext): Record<string, string> {
    return {
      'X-Trace-ID': tracing.traceId,
      'X-Parent-Span-ID': tracing.spanId,
      'X-Request-ID': tracing.requestId,
    };
  }
}