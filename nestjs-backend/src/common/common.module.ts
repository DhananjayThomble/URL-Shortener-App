import { Module, Global } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';

import { LoggerService } from './services/logger.service';
import { EnhancedLoggerService } from './services/enhanced-logger.service';
import { CacheService } from './services/cache.service';
import { CacheManagerService } from './services/cache-manager.service';
import { PerformanceService } from './services/performance.service';
import { HealthService } from './services/health.service';
import { MetricsService } from './services/metrics.service';
import { GracefulShutdownService } from './services/graceful-shutdown.service';

import { CacheController } from './controllers/cache.controller';
import { MonitoringController } from './controllers/monitoring.controller';

import { RequestTrackingInterceptor } from './interceptors/request-tracking.interceptor';
import { TracingMiddleware } from './middleware/tracing.middleware';

// Import entities and schemas for health checks
import { User } from '../modules/users/entities/user.entity';
import { Url, UrlSchema } from '../modules/urls/schemas/url.schema';

@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([User]),
    MongooseModule.forFeature([{ name: Url.name, schema: UrlSchema }]),
  ],
  controllers: [CacheController, MonitoringController],
  providers: [
    LoggerService,
    EnhancedLoggerService,
    CacheService,
    CacheManagerService,
    PerformanceService,
    HealthService,
    MetricsService,
    RequestTrackingInterceptor,
    TracingMiddleware,
    GracefulShutdownService,
  ],
  exports: [
    LoggerService,
    EnhancedLoggerService,
    CacheService,
    CacheManagerService,
    PerformanceService,
    HealthService,
    MetricsService,
    RequestTrackingInterceptor,
    TracingMiddleware,
    GracefulShutdownService,
  ],
})
export class CommonModule {}