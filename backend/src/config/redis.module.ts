import { Module, Global, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis, { Cluster } from 'ioredis';
import { RedisConfigService } from './redis.config';
import { RedisService } from './redis.service';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_CACHE_CLIENT = 'REDIS_CACHE_CLIENT';
export const REDIS_SESSION_CLIENT = 'REDIS_SESSION_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedisConfigService,
    // Temporarily disable RedisService to get the app running
    // RedisService,
    {
      provide: REDIS_CLIENT,
      useFactory: (redisConfigService: RedisConfigService): Redis | Cluster => {
        const redis = redisConfigService.createRedisInstance();
        redisConfigService.setupConnectionEventHandlers(redis);
        return redis;
      },
      inject: [RedisConfigService],
    },
    {
      provide: REDIS_CACHE_CLIENT,
      useFactory: (redisConfigService: RedisConfigService): Redis | Cluster => {
        const redis = redisConfigService.createRedisInstance();
        redisConfigService.setupConnectionEventHandlers(redis);
        return redis;
      },
      inject: [RedisConfigService],
    },
    {
      provide: REDIS_SESSION_CLIENT,
      useFactory: (redisConfigService: RedisConfigService, configService: ConfigService): Redis | Cluster => {
        const redisConfigService2 = new RedisConfigService(configService);
        const redis = redisConfigService2.createRedisInstance();
        
        // Use a different database for sessions
        if (redis instanceof Redis) {
          redis.select(parseInt(configService.get('REDIS_SESSION_DB', '1'), 10));
        }
        
        redisConfigService2.setupConnectionEventHandlers(redis);
        return redis;
      },
      inject: [RedisConfigService, ConfigService],
    },
  ],
  exports: [
    RedisConfigService,
    // RedisService,
    REDIS_CLIENT,
    REDIS_CACHE_CLIENT,
    REDIS_SESSION_CLIENT,
  ],
})
export class RedisModule {}