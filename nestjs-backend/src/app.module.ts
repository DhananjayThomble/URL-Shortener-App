import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './config/database.module';
import { EnvironmentModule } from './config/environment.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { UrlsModule } from './modules/urls/urls.module';
import { AdminModule } from './modules/admin/admin.module';
import { BioPagesModule } from './modules/bio-pages/bio-pages.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BulkOperationsModule } from './modules/bulk-operations/bulk-operations.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { CommonModule } from './common/common.module';
import { CacheModule } from './common/cache.module';
import { MigrationModule } from './migration/migration.module';
import { SecurityMiddleware } from './common/middleware/security.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { StaticCacheMiddleware } from './common/middleware/static-cache.middleware';
import { HttpCacheInterceptor } from './common/interceptors/http-cache.interceptor';
import { PerformanceMonitoringInterceptor } from './common/interceptors/performance-monitoring.interceptor';

@Module({
  imports: [
    // Environment configuration with validation (must be first)
    EnvironmentModule,
    
    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [EnvironmentModule],
      useFactory: async (configService: ConfigService) => {
        const globalConfig = configService.get('rateLimit.global', { ttl: 60000, max: 100 });
        return [
          {
            ttl: globalConfig.ttl,
            limit: globalConfig.max,
          },
        ];
      },
      inject: [ConfigService],
    }),

    // Bull Queue configuration
    BullModule.forRootAsync({
      imports: [EnvironmentModule],
      useFactory: async (configService: ConfigService) => {
        const redisConfig = configService.get('database.redis');
        return {
          redis: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            db: 2, // Use separate DB for queues
          },
          defaultJobOptions: {
            removeOnComplete: 10,
            removeOnFail: 10,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };
      },
      inject: [ConfigService],
    }),

    // Database connections
    DatabaseModule,

    // Monitoring and observability (must be imported early for global interceptors)
    MonitoringModule,

    // Feature modules
    CommonModule,
    CacheModule,
    AuthModule,
    UsersModule,
    UrlsModule,
    AdminModule,
    BioPagesModule,
    AnalyticsModule,
    BulkOperationsModule,
    MigrationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PerformanceMonitoringInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware, SecurityMiddleware, StaticCacheMiddleware)
      .forRoutes('*');
  }
}