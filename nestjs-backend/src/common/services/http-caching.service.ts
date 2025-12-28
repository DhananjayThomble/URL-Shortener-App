import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as crypto from 'crypto';

export interface CacheControlOptions {
  maxAge?: number;
  sMaxAge?: number;
  public?: boolean;
  private?: boolean;
  noCache?: boolean;
  noStore?: boolean;
  mustRevalidate?: boolean;
  proxyRevalidate?: boolean;
  immutable?: boolean;
  staleWhileRevalidate?: number;
  staleIfError?: number;
}

export interface ETagOptions {
  weak?: boolean;
  algorithm?: 'md5' | 'sha1' | 'sha256';
}

@Injectable()
export class HttpCachingService {
  private readonly logger = new Logger(HttpCachingService.name);
  private readonly defaultMaxAge: number;
  private readonly enableETag: boolean;

  constructor(private readonly configService: ConfigService) {
    this.defaultMaxAge = parseInt(
      this.configService.get('HTTP_CACHE_DEFAULT_MAX_AGE', '3600'),
      10,
    );
    this.enableETag = this.configService.get('HTTP_CACHE_ENABLE_ETAG', 'true') === 'true';
  }

  /**
   * Set Cache-Control header
   */
  setCacheControl(response: Response, options: CacheControlOptions): void {
    const directives: string[] = [];

    if (options.maxAge !== undefined) {
      directives.push(`max-age=${options.maxAge}`);
    }

    if (options.sMaxAge !== undefined) {
      directives.push(`s-maxage=${options.sMaxAge}`);
    }

    if (options.public) {
      directives.push('public');
    }

    if (options.private) {
      directives.push('private');
    }

    if (options.noCache) {
      directives.push('no-cache');
    }

    if (options.noStore) {
      directives.push('no-store');
    }

    if (options.mustRevalidate) {
      directives.push('must-revalidate');
    }

    if (options.proxyRevalidate) {
      directives.push('proxy-revalidate');
    }

    if (options.immutable) {
      directives.push('immutable');
    }

    if (options.staleWhileRevalidate !== undefined) {
      directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
    }

    if (options.staleIfError !== undefined) {
      directives.push(`stale-if-error=${options.staleIfError}`);
    }

    if (directives.length > 0) {
      response.setHeader('Cache-Control', directives.join(', '));
      this.logger.debug(`Set Cache-Control: ${directives.join(', ')}`);
    }
  }

  /**
   * Set ETag header
   */
  setETag(response: Response, data: any, options: ETagOptions = {}): string {
    if (!this.enableETag) {
      return '';
    }

    const algorithm = options.algorithm || 'md5';
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const hash = crypto.createHash(algorithm).update(content).digest('hex');
    const etag = options.weak ? `W/"${hash}"` : `"${hash}"`;

    response.setHeader('ETag', etag);
    this.logger.debug(`Set ETag: ${etag}`);

    return etag;
  }

  /**
   * Check if request has matching ETag
   */
  checkETag(ifNoneMatch: string | undefined, etag: string): boolean {
    if (!ifNoneMatch || !etag) {
      return false;
    }

    // Handle multiple ETags in If-None-Match header
    const clientETags = ifNoneMatch.split(',').map(tag => tag.trim());
    
    // Check for wildcard
    if (clientETags.includes('*')) {
      return true;
    }

    // Check for exact match
    return clientETags.includes(etag);
  }

  /**
   * Set Last-Modified header
   */
  setLastModified(response: Response, date: Date): void {
    response.setHeader('Last-Modified', date.toUTCString());
    this.logger.debug(`Set Last-Modified: ${date.toUTCString()}`);
  }

  /**
   * Check if request has If-Modified-Since header
   */
  checkIfModifiedSince(ifModifiedSince: string | undefined, lastModified: Date): boolean {
    if (!ifModifiedSince) {
      return true; // No header means we should return the resource
    }

    try {
      const clientDate = new Date(ifModifiedSince);
      return lastModified > clientDate;
    } catch (error) {
      this.logger.warn('Invalid If-Modified-Since header:', ifModifiedSince);
      return true;
    }
  }

  /**
   * Set Expires header
   */
  setExpires(response: Response, date: Date): void {
    response.setHeader('Expires', date.toUTCString());
    this.logger.debug(`Set Expires: ${date.toUTCString()}`);
  }

  /**
   * Set Vary header
   */
  setVary(response: Response, headers: string[]): void {
    const varyHeader = headers.join(', ');
    response.setHeader('Vary', varyHeader);
    this.logger.debug(`Set Vary: ${varyHeader}`);
  }

  /**
   * Apply caching for static resources
   */
  applyStaticResourceCaching(response: Response, resourceType: 'image' | 'css' | 'js' | 'font'): void {
    const cacheOptions: CacheControlOptions = {
      public: true,
      immutable: true,
    };

    switch (resourceType) {
      case 'image':
        cacheOptions.maxAge = 31536000; // 1 year
        break;
      case 'css':
      case 'js':
        cacheOptions.maxAge = 31536000; // 1 year
        break;
      case 'font':
        cacheOptions.maxAge = 31536000; // 1 year
        break;
      default:
        cacheOptions.maxAge = this.defaultMaxAge;
    }

    this.setCacheControl(response, cacheOptions);
  }

  /**
   * Apply caching for API responses
   */
  applyApiCaching(
    response: Response,
    data: any,
    options: {
      maxAge?: number;
      private?: boolean;
      etag?: boolean;
      lastModified?: Date;
      vary?: string[];
    } = {},
  ): string {
    const cacheOptions: CacheControlOptions = {
      maxAge: options.maxAge || this.defaultMaxAge,
      public: !options.private,
      private: options.private,
    };

    this.setCacheControl(response, cacheOptions);

    let etag = '';
    if (options.etag !== false) {
      etag = this.setETag(response, data);
    }

    if (options.lastModified) {
      this.setLastModified(response, options.lastModified);
    }

    if (options.vary && options.vary.length > 0) {
      this.setVary(response, options.vary);
    }

    return etag;
  }

  /**
   * Apply no-cache headers for sensitive data
   */
  applyNoCaching(response: Response): void {
    this.setCacheControl(response, {
      noCache: true,
      noStore: true,
      mustRevalidate: true,
      private: true,
    });

    // Additional security headers
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
  }

  /**
   * Apply caching for URL redirects
   */
  applyRedirectCaching(response: Response, permanent: boolean = false): void {
    if (permanent) {
      // Permanent redirects can be cached for a long time
      this.setCacheControl(response, {
        public: true,
        maxAge: 31536000, // 1 year
        immutable: true,
      });
    } else {
      // Temporary redirects should have shorter cache time
      this.setCacheControl(response, {
        public: true,
        maxAge: 300, // 5 minutes
      });
    }
  }

  /**
   * Apply caching for analytics data
   */
  applyAnalyticsCaching(response: Response, data: any): string {
    return this.applyApiCaching(response, data, {
      maxAge: 300, // 5 minutes
      private: true,
      etag: true,
      vary: ['Authorization', 'Accept-Encoding'],
    });
  }

  /**
   * Apply caching for user-specific data
   */
  applyUserDataCaching(response: Response, data: any, lastModified?: Date): string {
    return this.applyApiCaching(response, data, {
      maxAge: 900, // 15 minutes
      private: true,
      etag: true,
      lastModified,
      vary: ['Authorization'],
    });
  }

  /**
   * Apply caching for public data
   */
  applyPublicDataCaching(response: Response, data: any, maxAge?: number): string {
    return this.applyApiCaching(response, data, {
      maxAge: maxAge || 3600, // 1 hour
      private: false,
      etag: true,
      vary: ['Accept-Encoding'],
    });
  }

  /**
   * Handle conditional requests
   */
  handleConditionalRequest(
    request: any,
    response: Response,
    etag?: string,
    lastModified?: Date,
  ): boolean {
    const ifNoneMatch = request.headers['if-none-match'];
    const ifModifiedSince = request.headers['if-modified-since'];

    // Check ETag first
    if (etag && this.checkETag(ifNoneMatch, etag)) {
      response.status(304).end();
      return true;
    }

    // Check Last-Modified
    if (lastModified && !this.checkIfModifiedSince(ifModifiedSince, lastModified)) {
      response.status(304).end();
      return true;
    }

    return false;
  }

  /**
   * Get cache configuration for different resource types
   */
  getCacheConfig(resourceType: string): CacheControlOptions {
    const configs: Record<string, CacheControlOptions> = {
      'url-resolution': {
        public: true,
        maxAge: 3600, // 1 hour
        staleWhileRevalidate: 86400, // 1 day
      },
      'user-data': {
        private: true,
        maxAge: 900, // 15 minutes
        mustRevalidate: true,
      },
      'analytics': {
        private: true,
        maxAge: 300, // 5 minutes
        mustRevalidate: true,
      },
      'public-bio': {
        public: true,
        maxAge: 1800, // 30 minutes
        staleWhileRevalidate: 3600, // 1 hour
      },
      'static-assets': {
        public: true,
        maxAge: 31536000, // 1 year
        immutable: true,
      },
      'api-metadata': {
        public: true,
        maxAge: 86400, // 24 hours
        staleWhileRevalidate: 172800, // 2 days
      },
    };

    return configs[resourceType] || { maxAge: this.defaultMaxAge };
  }
}