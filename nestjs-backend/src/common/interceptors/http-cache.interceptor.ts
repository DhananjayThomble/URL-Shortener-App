import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response, Request } from 'express';
import { HttpCachingService, CacheControlOptions } from '../services/http-caching.service';

export const HTTP_CACHE_KEY = 'http-cache';
export const HTTP_CACHE_OPTIONS_KEY = 'http-cache-options';

export interface HttpCacheMetadata {
  type?: 'url-resolution' | 'user-data' | 'analytics' | 'public-bio' | 'static-assets' | 'api-metadata';
  maxAge?: number;
  private?: boolean;
  etag?: boolean;
  lastModified?: boolean;
  vary?: string[];
  noCache?: boolean;
}

/**
 * Decorator to enable HTTP caching for endpoints
 */
export const HttpCache = (metadata: HttpCacheMetadata = {}) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(HTTP_CACHE_KEY, true, descriptor.value);
    Reflect.defineMetadata(HTTP_CACHE_OPTIONS_KEY, metadata, descriptor.value);
    return descriptor;
  };
};

@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpCacheInterceptor.name);

  constructor(
    private readonly httpCachingService: HttpCachingService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const handler = context.getHandler();

    // Check if caching is enabled for this endpoint
    const isCacheEnabled = this.reflector.get<boolean>(HTTP_CACHE_KEY, handler);
    if (!isCacheEnabled) {
      return next.handle();
    }

    // Get cache options
    const cacheOptions = this.reflector.get<HttpCacheMetadata>(
      HTTP_CACHE_OPTIONS_KEY,
      handler,
    ) || {};

    // Handle no-cache scenarios
    if (cacheOptions.noCache) {
      this.httpCachingService.applyNoCaching(response);
      return next.handle();
    }

    return next.handle().pipe(
      tap((data) => {
        try {
          this.applyCaching(request, response, data, cacheOptions);
        } catch (error) {
          this.logger.error('Failed to apply HTTP caching:', error);
        }
      }),
    );
  }

  private applyCaching(
    request: Request,
    response: Response,
    data: any,
    options: HttpCacheMetadata,
  ): void {
    // Skip caching if response has already been sent or has error status
    if (response.headersSent || response.statusCode >= 400) {
      return;
    }

    const { type, maxAge, private: isPrivate, etag, lastModified, vary } = options;

    // Apply caching based on resource type
    if (type) {
      this.applyCachingByType(request, response, data, type);
      return;
    }

    // Apply custom caching options
    let etagValue = '';
    if (etag !== false) {
      etagValue = this.httpCachingService.setETag(response, data);
    }

    // Set Last-Modified if requested and data has timestamp
    let lastModifiedDate: Date | undefined;
    if (lastModified && data) {
      lastModifiedDate = this.extractLastModified(data);
      if (lastModifiedDate) {
        this.httpCachingService.setLastModified(response, lastModifiedDate);
      }
    }

    // Handle conditional requests
    if (this.httpCachingService.handleConditionalRequest(
      request,
      response,
      etagValue,
      lastModifiedDate,
    )) {
      return; // 304 Not Modified response sent
    }

    // Set Cache-Control header
    const cacheControlOptions: CacheControlOptions = {
      maxAge: maxAge,
      private: isPrivate,
      public: !isPrivate,
    };

    this.httpCachingService.setCacheControl(response, cacheControlOptions);

    // Set Vary header
    if (vary && vary.length > 0) {
      this.httpCachingService.setVary(response, vary);
    }

    this.logger.debug(`Applied HTTP caching for ${request.method} ${request.path}`);
  }

  private applyCachingByType(
    request: Request,
    response: Response,
    data: any,
    type: string,
  ): void {
    switch (type) {
      case 'url-resolution':
        this.applyUrlResolutionCaching(request, response, data);
        break;
      case 'user-data':
        this.applyUserDataCaching(request, response, data);
        break;
      case 'analytics':
        this.applyAnalyticsCaching(request, response, data);
        break;
      case 'public-bio':
        this.applyPublicBioCaching(request, response, data);
        break;
      case 'static-assets':
        this.applyStaticAssetsCaching(response);
        break;
      case 'api-metadata':
        this.applyApiMetadataCaching(request, response, data);
        break;
      default:
        this.logger.warn(`Unknown cache type: ${type}`);
    }
  }

  private applyUrlResolutionCaching(request: Request, response: Response, data: any): void {
    const etag = this.httpCachingService.setETag(response, data);
    
    if (this.httpCachingService.handleConditionalRequest(request, response, etag)) {
      return;
    }

    this.httpCachingService.setCacheControl(response, {
      public: true,
      maxAge: 3600, // 1 hour
      staleWhileRevalidate: 86400, // 1 day
    });

    this.httpCachingService.setVary(response, ['Accept-Encoding']);
  }

  private applyUserDataCaching(request: Request, response: Response, data: any): void {
    const lastModified = this.extractLastModified(data);
    const etag = this.httpCachingService.setETag(response, data);

    if (lastModified) {
      this.httpCachingService.setLastModified(response, lastModified);
    }

    if (this.httpCachingService.handleConditionalRequest(
      request,
      response,
      etag,
      lastModified,
    )) {
      return;
    }

    this.httpCachingService.setCacheControl(response, {
      private: true,
      maxAge: 900, // 15 minutes
      mustRevalidate: true,
    });

    this.httpCachingService.setVary(response, ['Authorization']);
  }

  private applyAnalyticsCaching(request: Request, response: Response, data: any): void {
    const etag = this.httpCachingService.setETag(response, data);

    if (this.httpCachingService.handleConditionalRequest(request, response, etag)) {
      return;
    }

    this.httpCachingService.setCacheControl(response, {
      private: true,
      maxAge: 300, // 5 minutes
      mustRevalidate: true,
    });

    this.httpCachingService.setVary(response, ['Authorization', 'Accept-Encoding']);
  }

  private applyPublicBioCaching(request: Request, response: Response, data: any): void {
    const lastModified = this.extractLastModified(data);
    const etag = this.httpCachingService.setETag(response, data);

    if (lastModified) {
      this.httpCachingService.setLastModified(response, lastModified);
    }

    if (this.httpCachingService.handleConditionalRequest(
      request,
      response,
      etag,
      lastModified,
    )) {
      return;
    }

    this.httpCachingService.setCacheControl(response, {
      public: true,
      maxAge: 1800, // 30 minutes
      staleWhileRevalidate: 3600, // 1 hour
    });

    this.httpCachingService.setVary(response, ['Accept-Encoding']);
  }

  private applyStaticAssetsCaching(response: Response): void {
    this.httpCachingService.setCacheControl(response, {
      public: true,
      maxAge: 31536000, // 1 year
      immutable: true,
    });
  }

  private applyApiMetadataCaching(request: Request, response: Response, data: any): void {
    const etag = this.httpCachingService.setETag(response, data);

    if (this.httpCachingService.handleConditionalRequest(request, response, etag)) {
      return;
    }

    this.httpCachingService.setCacheControl(response, {
      public: true,
      maxAge: 86400, // 24 hours
      staleWhileRevalidate: 172800, // 2 days
    });

    this.httpCachingService.setVary(response, ['Accept-Encoding']);
  }

  private extractLastModified(data: any): Date | undefined {
    if (!data) return undefined;

    // Try common timestamp fields
    const timestampFields = ['updatedAt', 'updated_at', 'modifiedAt', 'modified_at', 'lastModified'];
    
    for (const field of timestampFields) {
      if (data[field]) {
        const date = new Date(data[field]);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }

    // If data is an array, find the most recent timestamp
    if (Array.isArray(data) && data.length > 0) {
      const timestamps = data
        .map(item => this.extractLastModified(item))
        .filter(date => date !== undefined)
        .sort((a, b) => b!.getTime() - a!.getTime());

      return timestamps[0];
    }

    return undefined;
  }
}