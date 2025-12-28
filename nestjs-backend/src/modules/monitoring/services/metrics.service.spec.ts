import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should record HTTP requests', () => {
    expect(() => {
      service.recordHttpRequest('GET', '/health', 200, 100);
    }).not.toThrow();
  });

  it('should record URL creation', () => {
    expect(() => {
      service.recordUrlCreation('user123', true);
    }).not.toThrow();
  });

  it('should record URL clicks', () => {
    expect(() => {
      service.recordUrlClick('url123', 'mobile', 'US');
    }).not.toThrow();
  });

  it('should update active users', () => {
    expect(() => {
      service.updateActiveUsers(100);
    }).not.toThrow();
  });

  it('should record errors', () => {
    expect(() => {
      service.recordError('ValidationError', 'auth', 'medium');
    }).not.toThrow();
  });

  it('should get metrics', async () => {
    const metrics = await service.getMetrics();
    expect(typeof metrics).toBe('string');
    expect(metrics.length).toBeGreaterThan(0);
  });

  it('should get metrics in JSON format', async () => {
    const metricsJson = await service.getMetricsJson();
    expect(metricsJson).toHaveProperty('timestamp');
    expect(metricsJson).toHaveProperty('metrics');
    expect(Array.isArray(metricsJson.metrics)).toBe(true);
  });

  it('should get business metrics', async () => {
    const businessMetrics = await service.getBusinessMetrics();
    expect(businessMetrics).toHaveProperty('timestamp');
    expect(businessMetrics).toHaveProperty('metrics');
    expect(businessMetrics.metrics).toHaveProperty('urls');
    expect(businessMetrics.metrics).toHaveProperty('users');
    expect(businessMetrics.metrics).toHaveProperty('system');
  });

  it('should perform health check', async () => {
    const health = await service.healthCheck();
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('metricsCount');
    expect(health.status).toBe('healthy');
    expect(typeof health.metricsCount).toBe('number');
  });

  afterEach(() => {
    // Reset metrics for clean tests
    service.resetMetrics();
  });
});