import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './controllers/health.controller';
import { MetricsController } from './controllers/metrics.controller';
import { HealthCheckService } from '../../config/health-check.service';
import { MetricsService } from './services/metrics.service';
import { LoggingService } from './services/logging.service';
import { TracingService } from './services/tracing.service';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { TracingInterceptor } from './interceptors/tracing.interceptor';
import { DatabaseModule } from '../../config/database.module';
import { RedisModule } from '../../config/redis.module';

@Global()
@Module({
  imports: [
    TerminusModule,
    DatabaseModule,
    RedisModule,
  ],
  controllers: [
    HealthController,
    MetricsController,
  ],
  providers: [
    HealthCheckService,
    MetricsService,
    LoggingService,
    TracingService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TracingInterceptor,
    },
  ],
  exports: [
    HealthCheckService,
    MetricsService,
    LoggingService,
    TracingService,
  ],
})
export class MonitoringModule {}