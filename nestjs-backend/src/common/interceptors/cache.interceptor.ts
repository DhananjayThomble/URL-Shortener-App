import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { CachingService, CacheOptions } from '../services/caching.service';
import {
  CACHE_KEY_METADATA,
  CACHE_OPTIONS_METADATA,
  CACHE_INVALIDATE_METADATA,
} from '../decorators/cache.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInterceptor.name);

  constructor(
    private readonly cachingService: CachingService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();
    const className = context.getClass().name;
    const methodName = handler.name;

    // Check for cache invalidation
    const invalidateTags = this.reflector.get<string[]>(CACHE_INVALIDATE_METADATA, handler);
    if (invalidateTags && invalidateTags.length > 0) {
      try {
        await this.cachingService.invalidateByTags(invalidateTags);
        this.logger.debug(`Invalidated cache tags: ${invalidateTags.join(', ')}`);
      } catch (error) {
        this.logger.error('Failed to invalidate cache tags:', error);
      }
    }

    // Check for caching configuration
    const cacheKey = this.reflector.get<string>(CACHE_KEY_METADATA, handler);
    const cacheOptions = this.reflector.get<CacheOptions>(CACHE_OPTIONS_METADATA, handler) || {};

    // Skip caching if no cache key is defined or for non-GET requests
    if (!cacheKey || (request.method && request.method !== 'GET')) {
      return next.handle();
    }

    try {
      // Build cache key with method parameters
      const fullCacheKey = this.buildCacheKey(cacheKey, className, methodName, request);
      
      // Try to get from cache
      const cachedResult = await this.cachingService.get(fullCacheKey);
      if (cachedResult !== null) {
        this.logger.debug(`Cache hit for key: ${fullCacheKey}`);
        return of(cachedResult);
      }

      // Cache miss - execute method and cache result
      this.logger.debug(`Cache miss for key: ${fullCacheKey}`);
      return next.handle().pipe(
        tap(async (result) => {
          try {
            await this.cachingService.set(fullCacheKey, result, cacheOptions);
            this.logger.debug(`Cached result for key: ${fullCacheKey}`);
          } catch (error) {
            this.logger.error(`Failed to cache result for key ${fullCacheKey}:`, error);
          }
        }),
      );
    } catch (error) {
      this.logger.error('Cache interceptor error:', error);
      // Fallback to executing the method without caching
      return next.handle();
    }
  }

  /**
   * Build cache key from template and request parameters
   */
  private buildCacheKey(template: string, className: string, methodName: string, request: any): string {
    let cacheKey = template;

    // Replace placeholders with actual values
    cacheKey = cacheKey.replace('{class}', className);
    cacheKey = cacheKey.replace('{method}', methodName);

    // Replace parameter placeholders
    if (request.params) {
      Object.entries(request.params).forEach(([key, value]) => {
        cacheKey = cacheKey.replace(`{${key}}`, String(value));
      });
    }

    // Replace query parameter placeholders
    if (request.query) {
      Object.entries(request.query).forEach(([key, value]) => {
        cacheKey = cacheKey.replace(`{query.${key}}`, String(value));
      });
    }

    // Replace user ID if available
    if (request.user?.id) {
      cacheKey = cacheKey.replace('{userId}', request.user.id);
    }

    // Add query string hash for complex queries
    if (request.query && Object.keys(request.query).length > 0) {
      const queryHash = this.hashObject(request.query);
      cacheKey = `${cacheKey}:${queryHash}`;
    }

    return cacheKey;
  }

  /**
   * Create a simple hash of an object for cache key generation
   */
  private hashObject(obj: any): string {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Cache invalidation interceptor
 * Automatically invalidates cache based on method execution
 */
@Injectable()
export class CacheInvalidationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CacheInvalidationInterceptor.name);

  constructor(
    private readonly cachingService: CachingService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const handler = context.getHandler();
    const invalidateTags = this.reflector.get<string[]>(CACHE_INVALIDATE_METADATA, handler);

    if (!invalidateTags || invalidateTags.length === 0) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(async () => {
        try {
          const deletedCount = await this.cachingService.invalidateByTags(invalidateTags);
          this.logger.debug(`Invalidated ${deletedCount} cache entries for tags: ${invalidateTags.join(', ')}`);
        } catch (error) {
          this.logger.error('Failed to invalidate cache:', error);
        }
      }),
    );
  }
}