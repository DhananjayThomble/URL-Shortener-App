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
import { EmailService } from './services/email.service';
import { GracefulShutdownService } from './services/graceful-shutdown.service';
import { QueryOptimizationService } from './services/query-optimization.service';
import { HttpCachingService } from './services/http-caching.service';
import { PerformanceMonitoringService } from './services/performance-monitoring.service';
import { IntegrationVerificationService } from './services/integration-verification.service';
import { ProductionConfigService } from '../config/production-config.service';

import { CacheController } from './controllers/cache.controller';
import { MonitoringController } from './controllers/monitoring.controller';
import { PerformanceController } from './controllers/performance.controller';
import { IntegrationController } from './controllers/integration.controller';

import { RequestTrackingInterceptor } from './interceptors/request-tracking.interceptor';
import { HttpCacheInterceptor } from './interceptors/http-cache.interceptor';
import { PerformanceMonitoringInterceptor } from './interceptors/performance-monitoring.interceptor';
import { TracingMiddleware } from './middleware/tracing.middleware';
import { StaticCacheMiddleware } from './middleware/static-cache.middleware';

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
  controllers: [CacheController, MonitoringController, PerformanceController, IntegrationController],
  providers: [
    LoggerService,
    EnhancedLoggerService,
    CacheService,
    CacheManagerService,
    PerformanceService,
    HealthService,
    MetricsService,
    EmailService,
    RequestTrackingInterceptor,
    HttpCacheInterceptor,
    PerformanceMonitoringInterceptor,
    TracingMiddleware,
    StaticCacheMiddleware,
    GracefulShutdownService,
    QueryOptimizationService,
    HttpCachingService,
    PerformanceMonitoringService,
    IntegrationVerificationService,
    ProductionConfigService,
  ],
  exports: [
    LoggerService,
    EnhancedLoggerService,
    CacheService,
    CacheManagerService,
    PerformanceService,
    HealthService,
    MetricsService,
    EmailService,
    RequestTrackingInterceptor,
    HttpCacheInterceptor,
    PerformanceMonitoringInterceptor,
    TracingMiddleware,
    StaticCacheMiddleware,
    GracefulShutdownService,
    QueryOptimizationService,
    HttpCachingService,
    PerformanceMonitoringService,
    IntegrationVerificationService,
    ProductionConfigService,
  ],
})
export class CommonModule {}