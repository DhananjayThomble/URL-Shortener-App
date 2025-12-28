import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EnhancedSecurityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(EnhancedSecurityMiddleware.name);
  private readonly isDevelopment: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isDevelopment = this.configService.get('NODE_ENV') === 'development';
  }

  use(req: Request, res: Response, next: NextFunction) {
    try {
      // Log security-relevant request details
      this.logSecurityEvent(req);

      // Sanitize request data
      this.sanitizeRequest(req);

      // Set comprehensive security headers
      this.setSecurityHeaders(res);

      // Add request tracking
      this.addRequestTracking(req, res);

      next();
    } catch (error) {
      this.logger.error('Security middleware error:', error.stack);
      next(error);
    }
  }

  private logSecurityEvent(req: Request): void {
    const securityHeaders = {
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      referer: req.get('Referer'),
      xForwardedFor: req.get('X-Forwarded-For'),
      xRealIp: req.get('X-Real-IP'),
      authorization: req.get('Authorization') ? '[PRESENT]' : '[ABSENT]',
    };

    // Log suspicious patterns
    const suspiciousPatterns = [
      /script/i,
      /javascript/i,
      /vbscript/i,
      /onload/i,
      /onerror/i,
      /eval\(/i,
      /expression\(/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /data:text\/html/i,
    ];

    const requestData = JSON.stringify({
      url: req.url,
      query: req.query,
      body: req.body,
      headers: securityHeaders,
    });

    const hasSuspiciousContent = suspiciousPatterns.some(pattern => 
      pattern.test(requestData)
    );

    if (hasSuspiciousContent) {
      this.logger.warn('Suspicious request detected', {
        method: req.method,
        url: req.url,
        ip: this.getClientIp(req),
        userAgent: req.get('User-Agent'),
        suspiciousContent: true,
      });
    }

    // Log authentication attempts
    if (req.url.includes('/auth/')) {
      this.logger.log('Authentication request', {
        method: req.method,
        url: req.url,
        ip: this.getClientIp(req),
        userAgent: req.get('User-Agent'),
      });
    }
  }

  private sanitizeRequest(req: Request): void {
    // Sanitize query parameters
    if (req.query) {
      req.query = this.sanitizeObject(req.query);
    }

    // Sanitize request body
    if (req.body) {
      req.body = this.sanitizeObject(req.body);
    }

    // Sanitize headers (remove potentially dangerous ones)
    const dangerousHeaders = [
      'x-forwarded-host',
      'x-forwarded-server',
      'x-forwarded-proto',
    ];

    dangerousHeaders.forEach(header => {
      if (req.headers[header] && !this.isDevelopment) {
        delete req.headers[header];
      }
    });
  }

  private sanitizeObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return this.sanitizeString(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item));
    }

    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = this.sanitizeString(key);
      sanitized[sanitizedKey] = this.sanitizeObject(value);
    }

    return sanitized;
  }

  private sanitizeString(value: any): any {
    if (typeof value !== 'string') {
      return value;
    }

    // Remove potentially dangerous characters and patterns
    return value
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/vbscript:/gi, '') // Remove vbscript: protocol
      .replace(/data:text\/html/gi, '') // Remove data:text/html
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .replace(/expression\s*\(/gi, '') // Remove CSS expressions
      .replace(/eval\s*\(/gi, '') // Remove eval calls
      .trim();
  }

  private setSecurityHeaders(res: Response): void {
    // Remove server identification
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Control referrer information
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Disable potentially dangerous browser features
    res.setHeader('Permissions-Policy', 
      'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
    );

    // Strict Transport Security (HTTPS only)
    if (!this.isDevelopment) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // Content Security Policy
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Relaxed for development
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ];

    if (!this.isDevelopment) {
      // Stricter CSP for production
      cspDirectives[1] = "script-src 'self'"; // Remove unsafe-inline and unsafe-eval
    }

    res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

    // Expect-CT header for certificate transparency
    if (!this.isDevelopment) {
      res.setHeader('Expect-CT', 'max-age=86400, enforce');
    }

    // Feature Policy (deprecated but still supported)
    res.setHeader('Feature-Policy', 
      "geolocation 'none'; microphone 'none'; camera 'none'; payment 'none'"
    );

    // Cross-Origin policies
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    // Cache control for sensitive endpoints
    if (this.isSensitiveEndpoint(res.req as Request)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }

  private addRequestTracking(req: Request, res: Response): void {
    // Add correlation ID if not present
    if (!req.headers['x-correlation-id']) {
      const correlationId = this.generateCorrelationId();
      req.headers['x-correlation-id'] = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
    }

    // Add request timestamp
    (req as any).requestStartTime = Date.now();

    // Track response time
    res.on('finish', () => {
      const responseTime = Date.now() - (req as any).requestStartTime;
      
      if (responseTime > 5000) { // Log slow requests
        this.logger.warn('Slow request detected', {
          method: req.method,
          url: req.url,
          responseTime,
          statusCode: res.statusCode,
          ip: this.getClientIp(req),
        });
      }
    });
  }

  private isSensitiveEndpoint(req: Request): boolean {
    const sensitivePatterns = [
      /\/auth\//,
      /\/admin\//,
      /\/api\/.*\/password/,
      /\/api\/.*\/token/,
      /\/api\/.*\/reset/,
      /\/api\/.*\/verify/,
    ];

    return sensitivePatterns.some(pattern => pattern.test(req.url));
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'] as string;
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    
    return req.headers['x-real-ip'] as string || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           'unknown';
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}