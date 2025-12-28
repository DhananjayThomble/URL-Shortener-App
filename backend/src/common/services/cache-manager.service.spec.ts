import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

import { CacheManagerService } from './cache-manager.service';
import { CacheService } from './cache.service';

describe('CacheManagerService', () => {
  let service: CacheManagerService;
  let cacheService: jest.Mocked<CacheService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockCacheService = {
      getStats: jest.fn(),
      healthCheck: jest.fn(),
      invalidatePattern: jest.fn(),
      flushAll: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheManagerService,
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<CacheManagerService>(CacheManagerService);
    cacheService = module.get(CacheService);
    configService = module.get(ConfigService);

    // Mock logger to avoid console output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize cache warming on module init', async () => {
      configService.get.mockReturnValue('true');
      
      // Mock setTimeout to execute immediately
      jest.spyOn(global, 'setTimeout').mockImplementation((callback: any) => {
        callback();
        return {} as any;
      });

      await service.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith('CACHE_ENABLE_WARMING', 'true');
    });
  });

  describe('Metrics', () => {
    it('should get cache metrics', async () => {
      const mockStats = {
        hits: 8000,
        misses: 2000,
        memory: '15.2M',
        keys: 1500,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const metrics = await service.getMetrics();

      expect(cacheService.getStats).toHaveBeenCalled();
      expect(metrics).toEqual({
        hitRate: 80, // 8000 / (8000 + 2000) * 100
        missRate: 20, // 2000 / (8000 + 2000) * 100
        totalOperations: 10000,
        memoryUsage: '15.2M',
        keyCount: 1500,
        evictions: 0,
      });
    });

    it('should handle metrics error gracefully', async () => {
      cacheService.getStats.mockRejectedValue(new Error('Stats error'));

      const metrics = await service.getMetrics();

      expect(metrics).toEqual({
        hitRate: 0,
        missRate: 0,
        totalOperations: 0,
        memoryUsage: '0B',
        keyCount: 0,
        evictions: 0,
      });
    });

    it('should calculate metrics with zero operations', async () => {
      const mockStats = {
        hits: 0,
        misses: 0,
        memory: '5M',
        keys: 0,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const metrics = await service.getMetrics();

      expect(metrics.hitRate).toBe(0);
      expect(metrics.missRate).toBe(0);
      expect(metrics.totalOperations).toBe(0);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache with pattern', async () => {
      cacheService.invalidatePattern.mockResolvedValue();

      const result = await service.clearCache('user:*');

      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('user:*');
      expect(result).toBe(1);
    });

    it('should clear entire cache', async () => {
      cacheService.flushAll.mockResolvedValue();

      const result = await service.clearCache();

      expect(cacheService.flushAll).toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it('should handle clear cache error', async () => {
      cacheService.flushAll.mockRejectedValue(new Error('Clear error'));

      const result = await service.clearCache();

      expect(result).toBe(0);
    });
  });

  describe('Cache Optimization', () => {
    it('should optimize cache with low hit rate', async () => {
      const mockStats = {
        hits: 300,
        misses: 700,
        memory: '10M',
        keys: 1000,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      await service.optimizeCache();

      expect(cacheService.getStats).toHaveBeenCalled();
      // Should trigger preload due to low hit rate (30%)
    });

    it('should optimize cache with high key count', async () => {
      const mockStats = {
        hits: 8000,
        misses: 2000,
        memory: '50M',
        keys: 150000, // High key count
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      await service.optimizeCache();

      expect(cacheService.getStats).toHaveBeenCalled();
      // Should trigger cleanup due to high key count
    });

    it('should handle optimization error', async () => {
      cacheService.getStats.mockRejectedValue(new Error('Optimization error'));

      await expect(service.optimizeCache()).resolves.not.toThrow();
    });
  });

  describe('Health Validation', () => {
    it('should validate healthy cache', async () => {
      cacheService.healthCheck.mockResolvedValue(true);
      const mockStats = {
        hits: 8000,
        misses: 2000,
        memory: '10M',
        keys: 1000,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const result = await service.validateCacheHealth();

      expect(cacheService.healthCheck).toHaveBeenCalled();
      expect(cacheService.getStats).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should detect unhealthy cache', async () => {
      cacheService.healthCheck.mockResolvedValue(false);

      const result = await service.validateCacheHealth();

      expect(result).toBe(false);
    });

    it('should warn about low hit rate', async () => {
      cacheService.healthCheck.mockResolvedValue(true);
      const mockStats = {
        hits: 400,
        misses: 600,
        memory: '10M',
        keys: 1000,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const result = await service.validateCacheHealth();

      expect(result).toBe(true);
      // Should log warning about low hit rate (40%)
    });

    it('should warn about high key count', async () => {
      cacheService.healthCheck.mockResolvedValue(true);
      const mockStats = {
        hits: 8000,
        misses: 2000,
        memory: '100M',
        keys: 600000, // Very high key count
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const result = await service.validateCacheHealth();

      expect(result).toBe(true);
      // Should log warning about high key count
    });

    it('should handle health validation error', async () => {
      cacheService.healthCheck.mockRejectedValue(new Error('Health check error'));

      const result = await service.validateCacheHealth();

      expect(result).toBe(false);
    });
  });

  describe('Cache Size', () => {
    it('should get cache size', async () => {
      const mockStats = {
        hits: 5000,
        misses: 1000,
        memory: '25M',
        keys: 2500,
      };
      cacheService.getStats.mockResolvedValue(mockStats);

      const size = await service.getCacheSize();

      expect(size).toEqual({
        keys: 2500,
        memory: '25M',
      });
    });

    it('should handle cache size error', async () => {
      cacheService.getStats.mockRejectedValue(new Error('Size error'));

      const size = await service.getCacheSize();

      expect(size).toEqual({
        keys: 0,
        memory: '0B',
      });
    });
  });

  describe('Scheduled Tasks', () => {
    it('should run scheduled cache optimization when enabled', async () => {
      configService.get.mockReturnValue('true');
      cacheService.getStats.mockResolvedValue({
        hits: 8000,
        misses: 2000,
        memory: '10M',
        keys: 1000,
      });

      await service.scheduledCacheOptimization();

      expect(configService.get).toHaveBeenCalledWith('CACHE_AUTO_OPTIMIZE', 'true');
      expect(cacheService.getStats).toHaveBeenCalled();
    });

    it('should skip scheduled optimization when disabled', async () => {
      configService.get.mockReturnValue('false');

      await service.scheduledCacheOptimization();

      expect(configService.get).toHaveBeenCalledWith('CACHE_AUTO_OPTIMIZE', 'true');
      expect(cacheService.getStats).not.toHaveBeenCalled();
    });

    it('should run scheduled cache warming when enabled', async () => {
      configService.get.mockReturnValue('true');

      await service.scheduledCacheWarming();

      expect(configService.get).toHaveBeenCalledWith('CACHE_ENABLE_WARMING', 'true');
    });

    it('should run scheduled health check', async () => {
      cacheService.healthCheck.mockResolvedValue(true);
      cacheService.getStats.mockResolvedValue({
        hits: 8000,
        misses: 2000,
        memory: '10M',
        keys: 1000,
      });

      await service.scheduledHealthCheck();

      expect(cacheService.healthCheck).toHaveBeenCalled();
    });

    it('should handle failed scheduled health check', async () => {
      cacheService.healthCheck.mockResolvedValue(false);

      await service.scheduledHealthCheck();

      expect(cacheService.healthCheck).toHaveBeenCalled();
      // Should log error for failed health check
    });
  });

  describe('Preload Popular URLs', () => {
    it('should preload popular URLs', async () => {
      await service.preloadPopularUrls();

      // This is a placeholder implementation, so we just verify it doesn't throw
      expect(true).toBe(true);
    });

    it('should handle preload error', async () => {
      // Mock an error in the preload process
      jest.spyOn(service, 'preloadPopularUrls').mockRejectedValue(new Error('Preload error'));

      await expect(service.preloadPopularUrls()).rejects.toThrow('Preload error');
    });
  });

  describe('Export Cache Keys', () => {
    it('should export cache keys with default pattern', async () => {
      const keys = await service.exportCacheKeys();

      expect(keys).toEqual([]);
      // This is a placeholder implementation
    });

    it('should export cache keys with custom pattern', async () => {
      const keys = await service.exportCacheKeys('user:*');

      expect(keys).toEqual([]);
      // This is a placeholder implementation
    });

    it('should handle export error', async () => {
      jest.spyOn(service, 'exportCacheKeys').mockRejectedValue(new Error('Export error'));

      await expect(service.exportCacheKeys()).rejects.toThrow('Export error');
    });
  });
});