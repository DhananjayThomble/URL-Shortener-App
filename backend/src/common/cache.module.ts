import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../config/redis.module';
import { CachingService } from './services/caching.service';
import { CacheInterceptor, CacheInvalidationInterceptor } from './interceptors/cache.interceptor';

@Global()
@Module({
  imports: [
    ConfigModule,
    RedisModule,
  ],
  providers: [
    CachingService,
    CacheInterceptor,
    CacheInvalidationInterceptor,
  ],
  exports: [
    CachingService,
    CacheInterceptor,
    CacheInvalidationInterceptor,
  ],
})
export class CacheModule {}