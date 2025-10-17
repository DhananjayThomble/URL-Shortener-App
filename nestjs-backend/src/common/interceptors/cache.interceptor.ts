import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

import { CacheService } from '../services/cache.service';

export const CACHE_KEY_METADATA = 'cache_key';
export const CACHE_TTL_METADATA = 'cache_ttl';

export const CacheKey = (key: string) => 
  (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(CACHE_KEY_METADATA, key, descriptor.value);
  };

export const CacheTTL = (ttl: number) => 
  (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(CACHE_TTL_METADATA, ttl, descriptor.value);
  };

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private cacheService: CacheService,
    private reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const cacheKey = this.reflector.get<string>(CACHE_KEY_METADATA, context.getHandler());
    const cacheTTL = this.reflector.get<number>(CACHE_TTL_METADATA, context.getHandler());

    if (!cacheKey) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const finalCacheKey = this.buildCacheKey(cacheKey, request);

    // Try to get from cache
    const cachedResult = await this.cacheService.get(finalCacheKey);
    if (cachedResult !== null) {
      return of(cachedResult);
    }

    // Execute the handler and cache the result
    return next.handle().pipe(
      tap(async (result) => {
        if (result !== undefined && result !== null) {
          await this.cacheService.set(finalCacheKey, result, cacheTTL);
        }
      }),
    );
  }

  private buildCacheKey(template: string, request: any): string {
    let key = template;
    
    // Replace placeholders with actual values
    key = key.replace(':userId', request.user?.id || 'anonymous');
    key = key.replace(':id', request.params?.id || '');
    key = key.replace(':shortCode', request.params?.shortCode || '');
    
    // Add query parameters if present
    const queryString = new URLSearchParams(request.query).toString();
    if (queryString) {
      key += `:${queryString}`;
    }

    return key;
  }
}