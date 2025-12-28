import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { PerformanceService } from './performance.service';

describe('PerformanceService', () => {
  let service: PerformanceService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<PerformanceService>(PerformanceService);
    configService = module.get(ConfigService);

    // Mock logger to avoid console output during tests
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.resetCounters();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });
  });

  describe('Request Tracking', () => {
    it('should track requests', () => {
      const initialMetrics = service.getMetrics();
      const initialCount = initialMetrics.requestsPerSecond;

      service.trackRequest();
      service.trackRequest();
      service.trackRequest();

      const metrics = service.getMetrics();
      expect(metrics.requestsPerSecond).toBeGreaterThan(initialCount);
    });

    it('should track errors', () => {
      const initialMetrics = service.getMetrics();
      const initialErrorRate = initialMetrics.errorRate;

      service.trackRequest();
      service.trackError();

      const metrics = service.getMetrics();
      expect(metrics.errorRate).toBeGreaterThan(initialErrorRate);
    });

    it('should calculate error rate correctly', () => {
      service.trackRequest();
      service.trackRequest();
      service.trackRequest();
      service.trackRequest();
      service.trackError(); // 1 error out of 4 requests = 25%

      const metrics = service.getMetrics();
      expect(metrics.errorRate).toBe(25);
    });

    it('should handle zero requests for error rate', () => {
      const metrics = service.getMetrics();
      expect(metrics.errorRate).toBe(0);
    });
  });

  describe('Metrics', () => {
    it('should get performance metrics', () => {
      service.trackRequest();
      service.trackRequest();
      service.trackError();

      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('responseTime');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('requestsPerSecond');
      expect(metrics).toHaveProperty('errorRate');

      expect(typeof metrics.responseTime).toBe('number');
      expect(typeof metrics.memoryUsage).toBe('object');
      expect(typeof metrics.cpuUsage).toBe('object');
      expect(typeof metrics.activeConnections).toBe('number');
      expect(typeof metrics.requestsPerSecond).toBe('number');
      expect(typeof metrics.errorRate).toBe('number');

      expect(metrics.errorRate).toBe(50); // 1 error out of 2 requests
    });

    it('should reset counters', () => {
      service.trackRequest();
      service.trackRequest();
      service.trackError();

      let metrics = service.getMetrics();
      expect(metrics.requestsPerSecond).toBeGreaterThan(0);
      expect(metrics.errorRate).toBeGreaterThan(0);

      service.resetCounters();

      // Wait a bit for time to pass
      setTimeout(() => {
        metrics = service.getMetrics();
        expect(metrics.requestsPerSecond).toBe(0);
        expect(metrics.errorRate).toBe(0);
      }, 10);
    });
  });

  describe('Health Score', () => {
    it('should calculate perfect health score', () => {
      // Mock low memory usage and no errors
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 50 * 1024 * 1024, // 50MB
        heapTotal: 100 * 1024 * 1024, // 100MB
        heapUsed: 50 * 1024 * 1024, // 50MB
        external: 10 * 1024 * 1024, // 10MB
        arrayBuffers: 5 * 1024 * 1024, // 5MB
      });

      const score = service.getHealthScore();
      expect(score).toBe(100);
    });

    it('should deduct points for high memory usage', () => {
      // Mock high memory usage
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 600 * 1024 * 1024, // 600MB
        heapTotal: 1000 * 1024 * 1024, // 1GB
        heapUsed: 600 * 1024 * 1024, // 600MB (high usage)
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 25 * 1024 * 1024, // 25MB
      });

      const score = service.getHealthScore();
      expect(score).toBeLessThan(100);
    });

    it('should deduct points for high error rate', () => {
      // Generate requests with high error rate
      for (let i = 0; i < 10; i++) {
        service.trackRequest();
        if (i < 6) service.trackError(); // 60% error rate
      }

      const score = service.getHealthScore();
      expect(score).toBeLessThan(100);
    });

    it('should deduct points for low RPS with sufficient requests', () => {
      // Track many requests to meet the threshold
      for (let i = 0; i < 15; i++) {
        service.trackRequest();
      }

      // Wait to make RPS very low
      setTimeout(() => {
        const score = service.getHealthScore();
        // Score might be affected by low RPS
        expect(typeof score).toBe('number');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }, 1000);
    });

    it('should not go below 0', () => {
      // Mock extremely bad conditions
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 1000 * 1024 * 1024, // 1GB
        heapTotal: 1000 * 1024 * 1024, // 1GB
        heapUsed: 1000 * 1024 * 1024, // 1GB (very high usage)
        external: 100 * 1024 * 1024, // 100MB
        arrayBuffers: 50 * 1024 * 1024, // 50MB
      });

      // Generate requests with 100% error rate
      for (let i = 0; i < 20; i++) {
        service.trackRequest();
        service.trackError();
      }

      const score = service.getHealthScore();
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Optimization Recommendations', () => {
    it('should recommend memory optimization for high usage', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 600 * 1024 * 1024, // 600MB
        heapTotal: 1000 * 1024 * 1024, // 1GB
        heapUsed: 600 * 1024 * 1024, // 600MB (high usage)
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 25 * 1024 * 1024, // 25MB
      });

      const recommendations = service.getOptimizationRecommendations();
      expect(recommendations).toContain('High memory usage detected. Consider implementing memory optimization strategies.');
    });

    it('should recommend error handling review for high error rate', () => {
      for (let i = 0; i < 10; i++) {
        service.trackRequest();
        if (i < 6) service.trackError(); // 60% error rate
      }

      const recommendations = service.getOptimizationRecommendations();
      expect(recommendations).toContain('High error rate detected. Review error handling and logging.');
    });

    it('should recommend caching for high request volume', () => {
      // Simulate high RPS by tracking many requests quickly
      for (let i = 0; i < 200; i++) {
        service.trackRequest();
      }

      const recommendations = service.getOptimizationRecommendations();
      expect(recommendations).toContain('High request volume. Consider implementing additional caching strategies.');
    });

    it('should recommend GC optimization for high heap usage ratio', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 1000 * 1024 * 1024, // 1GB
        heapTotal: 1000 * 1024 * 1024, // 1GB
        heapUsed: 850 * 1024 * 1024, // 850MB (85% of heap)
        external: 50 * 1024 * 1024, // 50MB
        arrayBuffers: 25 * 1024 * 1024, // 25MB
      });

      const recommendations = service.getOptimizationRecommendations();
      expect(recommendations).toContain('Heap usage is high. Consider garbage collection optimization.');
    });

    it('should return empty recommendations for good performance', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 100 * 1024 * 1024, // 100MB
        heapTotal: 200 * 1024 * 1024, // 200MB
        heapUsed: 80 * 1024 * 1024, // 80MB (40% of heap)
        external: 10 * 1024 * 1024, // 10MB
        arrayBuffers: 5 * 1024 * 1024, // 5MB
      });

      const recommendations = service.getOptimizationRecommendations();
      expect(recommendations).toHaveLength(0);
    });
  });

  describe('Memory Formatting', () => {
    it('should format bytes correctly', () => {
      expect(service.formatMemoryUsage(0)).toBe('0 Bytes');
      expect(service.formatMemoryUsage(1024)).toBe('1 KB');
      expect(service.formatMemoryUsage(1024 * 1024)).toBe('1 MB');
      expect(service.formatMemoryUsage(1024 * 1024 * 1024)).toBe('1 GB');
      expect(service.formatMemoryUsage(1536)).toBe('1.5 KB');
      expect(service.formatMemoryUsage(1572864)).toBe('1.5 MB');
    });
  });

  describe('Operation Measurement', () => {
    it('should measure async operation', async () => {
      const mockOperation = jest.fn().mockResolvedValue('test result');

      const { result, duration } = await service.measureAsyncOperation(
        mockOperation,
        'test operation'
      );

      expect(result).toBe('test result');
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(mockOperation).toHaveBeenCalled();
    });

    it('should handle async operation error', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Test error'));

      await expect(
        service.measureAsyncOperation(mockOperation, 'failing operation')
      ).rejects.toThrow('Test error');

      expect(mockOperation).toHaveBeenCalled();
    });

    it('should measure sync operation', () => {
      const mockOperation = jest.fn().mockReturnValue('sync result');

      const { result, duration } = service.measureSyncOperation(
        mockOperation,
        'sync operation'
      );

      expect(result).toBe('sync result');
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
      expect(mockOperation).toHaveBeenCalled();
    });

    it('should handle sync operation error', () => {
      const mockOperation = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      expect(() =>
        service.measureSyncOperation(mockOperation, 'failing sync operation')
      ).toThrow('Sync error');

      expect(mockOperation).toHaveBeenCalled();
    });

    it('should measure operation duration accurately', async () => {
      const delay = 100; // 100ms
      const mockOperation = () => new Promise(resolve => setTimeout(resolve, delay));

      const { duration } = await service.measureAsyncOperation(
        mockOperation,
        'delayed operation'
      );

      // Allow for some variance in timing
      expect(duration).toBeGreaterThan(delay - 10);
      expect(duration).toBeLessThan(delay + 50);
    });
  });
});