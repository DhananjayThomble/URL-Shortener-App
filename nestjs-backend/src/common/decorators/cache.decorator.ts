import { SetMetadata, applyDecorators } from '@nestjs/common';
import { CacheOptions } from '../services/caching.service';

export const CACHE_KEY_METADATA = 'cache:key';
export const CACHE_OPTIONS_METADATA = 'cache:options';
export const CACHE_INVALIDATE_METADATA = 'cache:invalidate';

/**
 * Cache decorator for methods
 * Automatically caches method results based on parameters
 */
export function Cache(keyOrOptions?: string | CacheOptions, options?: CacheOptions) {
  let cacheKey: string | undefined;
  let cacheOptions: CacheOptions = {};

  if (typeof keyOrOptions === 'string') {
    cacheKey = keyOrOptions;
    cacheOptions = options || {};
  } else if (keyOrOptions) {
    cacheOptions = keyOrOptions;
  }

  return applyDecorators(
    SetMetadata(CACHE_KEY_METADATA, cacheKey),
    SetMetadata(CACHE_OPTIONS_METADATA, cacheOptions),
  );
}

/**
 * Cache invalidation decorator
 * Invalidates cache when method is called
 */
export function CacheInvalidate(tags: string[] | string) {
  const tagsArray = Array.isArray(tags) ? tags : [tags];
  return SetMetadata(CACHE_INVALIDATE_METADATA, tagsArray);
}

/**
 * Predefined cache configurations for common use cases
 */
export const CacheConfigs = {
  /**
   * Short-term cache for frequently accessed data
   */
  SHORT_TERM: { ttl: 300, tags: ['short-term'] }, // 5 minutes

  /**
   * Medium-term cache for moderately changing data
   */
  MEDIUM_TERM: { ttl: 1800, tags: ['medium-term'] }, // 30 minutes

  /**
   * Long-term cache for rarely changing data
   */
  LONG_TERM: { ttl: 86400, tags: ['long-term'] }, // 24 hours

  /**
   * URL resolution cache
   */
  URL_RESOLUTION: { ttl: 3600, tags: ['url', 'resolution'] }, // 1 hour

  /**
   * User data cache
   */
  USER_DATA: { ttl: 900, tags: ['user', 'profile'] }, // 15 minutes

  /**
   * Analytics cache
   */
  ANALYTICS: { ttl: 300, tags: ['analytics', 'stats'] }, // 5 minutes

  /**
   * Metadata cache
   */
  METADATA: { ttl: 86400, tags: ['metadata'] }, // 24 hours

  /**
   * Popular URLs cache
   */
  POPULAR_URLS: { ttl: 1800, tags: ['popular', 'trending'] }, // 30 minutes

  /**
   * Geo-location cache
   */
  GEO_LOCATION: { ttl: 86400, tags: ['geo', 'location'] }, // 24 hours
};

/**
 * Cache key builders for consistent key generation
 */
export class CacheKeyBuilder {
  /**
   * Build cache key for URL resolution
   */
  static urlResolution(shortCode: string): string {
    return `url:resolution:${shortCode}`;
  }

  /**
   * Build cache key for user data
   */
  static userData(userId: string): string {
    return `user:data:${userId}`;
  }

  /**
   * Build cache key for user links
   */
  static userLinks(userId: string, page?: number, limit?: number): string {
    const pagination = page && limit ? `:${page}:${limit}` : '';
    return `user:links:${userId}${pagination}`;
  }

  /**
   * Build cache key for analytics
   */
  static analytics(linkId: string, period: string, startDate?: string, endDate?: string): string {
    const dateRange = startDate && endDate ? `:${startDate}:${endDate}` : '';
    return `analytics:${linkId}:${period}${dateRange}`;
  }

  /**
   * Build cache key for popular URLs
   */
  static popularUrls(period: string, limit?: number): string {
    const limitSuffix = limit ? `:${limit}` : '';
    return `popular:urls:${period}${limitSuffix}`;
  }

  /**
   * Build cache key for geo-location
   */
  static geoLocation(ip: string): string {
    return `geo:location:${ip}`;
  }

  /**
   * Build cache key for bio page
   */
  static bioPage(username: string): string {
    return `bio:page:${username}`;
  }

  /**
   * Build cache key for tags
   */
  static userTags(userId: string): string {
    return `user:tags:${userId}`;
  }

  /**
   * Build cache key for link tags
   */
  static linkTags(linkId: string): string {
    return `link:tags:${linkId}`;
  }

  /**
   * Build cache key for filtered links
   */
  static filteredLinks(userId: string, filters: Record<string, any>): string {
    const filterString = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join(':');
    return `user:links:filtered:${userId}:${filterString}`;
  }
}