import { Test, TestingModule } from '@nestjs/testing';
import { MonitoringModule } from './monitoring.module';
import { MetricsService } from './services/metrics.service';
import { LoggingService } from './services/logging.service';
import { TracingService } from './services/tracing.service';
import { HealthCheckService } from '../../config/health-check.service';

describe('MonitoringModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [MonitoringModule],
    }).compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide MetricsService', () => {
    const metricsService = module.get<MetricsService>(MetricsService);
    expect(metricsService).toBeDefined();
  });

  it('should provide LoggingService', () => {
    const loggingService = module.get<LoggingService>(LoggingService);
    expect(loggingService).toBeDefined();
  });

  it('should provide TracingService', () => {
    const tracingService = module.get<TracingService>(TracingService);
    expect(tracingService).toBeDefined();
  });

  afterEach(async () => {
    await module.close();
  });
});