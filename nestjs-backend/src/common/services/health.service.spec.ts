import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getModelToken } from '@nestjs/mongoose';
import { Repository } from 'typeorm';
import { Model } from 'mongoose';

import { HealthService } from './health.service';
import { CacheService } from './cache.service';
import { User } from '../../modules/users/entities/user.entity';

describe('HealthService', () => {
  let service: HealthService;
  let userRepository: jest.Mocked<Repository<User>>;
  let urlModel: jest.Mocked<Model<any>>;
  let cacheService: jest.Mocked<CacheService>;

  beforeEach(async () => {
    const mockRepository = {
      query: jest.fn(),
    };

    const mockModel = {
      findOne: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      }),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };

    const mockCacheService = {
      healthCheck: jest.fn(),
      getStats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: getModelToken('Url'),
          useValue: mockModel,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    userRepository = module.get(getRepositoryToken(User));
    urlModel = module.get(getModelToken('Url'));
    cacheService = module.get(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkPostgresHealth', () => {
    it('should return healthy status when database is accessible', async () => {
      userRepository.query.mockResolvedValue([{ result: 1 }]);

      const result = await service.checkPostgresHealth();

      expect(result.status).toBe('healthy');
      expect(result.responseTime).toBeGreaterThan(0);
      expect(userRepository.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return unhealthy status when database is not accessible', async () => {
      const error = new Error('Connection failed');
      userRepository.query.mockRejectedValue(error);

      const result = await service.checkPostgresHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection failed');
      expect(result.responseTime).toBeGreaterThan(0);
    });
  });

  describe('checkMongoHealth', () => {
    it('should return healthy status when MongoDB is accessible', async () => {
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);

      const result = await service.checkMongoHealth();

      expect(result.status).toBe('healthy');
      expect(result.responseTime).toBeGreaterThan(0);
      expect(urlModel.findOne).toHaveBeenCalled();
      expect(mockChain.limit).toHaveBeenCalledWith(1);
      expect(mockChain.limit().lean).toHaveBeenCalled();
    });

    it('should return unhealthy status when MongoDB is not accessible', async () => {
      const error = new Error('MongoDB connection failed');
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockRejectedValue(error),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);

      const result = await service.checkMongoHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('MongoDB connection failed');
      expect(result.responseTime).toBeGreaterThan(0);
    });
  });

  describe('checkCacheHealth', () => {
    it('should return healthy status when Redis is accessible', async () => {
      cacheService.healthCheck.mockResolvedValue(true);
      cacheService.getStats.mockResolvedValue({
        memory: '10MB',
        keys: 100,
        hits: 80,
        misses: 20,
      });

      const result = await service.checkCacheHealth();

      expect(result.status).toBe('healthy');
      expect(result.memory).toBe('10MB');
      expect(result.keys).toBe(100);
      expect(result.responseTime).toBeGreaterThan(0);
    });

    it('should return unhealthy status when Redis health check fails', async () => {
      cacheService.healthCheck.mockResolvedValue(false);

      const result = await service.checkCacheHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Redis ping failed');
    });

    it('should return unhealthy status when Redis throws error', async () => {
      const error = new Error('Redis connection error');
      cacheService.healthCheck.mockRejectedValue(error);

      const result = await service.checkCacheHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Redis connection error');
    });
  });

  describe('getHealthStatus', () => {
    it('should return comprehensive health status', async () => {
      // Mock all health checks to be successful
      userRepository.query.mockResolvedValue([{ result: 1 }]);
      
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);
      
      cacheService.healthCheck.mockResolvedValue(true);
      cacheService.getStats.mockResolvedValue({
        memory: '10MB',
        keys: 100,
        hits: 80,
        misses: 20,
      });

      const result = await service.getHealthStatus();

      expect(result.status).toBe('healthy');
      expect(result.services.database.postgres.status).toBe('healthy');
      expect(result.services.database.mongodb.status).toBe('healthy');
      expect(result.services.cache.redis.status).toBe('healthy');
      expect(result.metrics).toBeDefined();
      expect(result.uptime).toBeGreaterThan(0);
      expect(result.timestamp).toBeDefined();
    });

    it('should return unhealthy status when critical service fails', async () => {
      // Mock PostgreSQL to fail
      userRepository.query.mockRejectedValue(new Error('DB Error'));
      
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);
      
      cacheService.healthCheck.mockResolvedValue(true);
      cacheService.getStats.mockResolvedValue({
        memory: '10MB',
        keys: 100,
        hits: 80,
        misses: 20,
      });

      const result = await service.getHealthStatus();

      expect(result.status).toBe('unhealthy');
      expect(result.services.database.postgres.status).toBe('unhealthy');
    });

    it('should return degraded status when non-critical service fails', async () => {
      // Mock cache to fail but databases to succeed
      userRepository.query.mockResolvedValue([{ result: 1 }]);
      
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);
      
      cacheService.healthCheck.mockResolvedValue(false);

      const result = await service.getHealthStatus();

      expect(result.status).toBe('degraded');
      expect(result.services.cache.redis.status).toBe('unhealthy');
    });
  });

  describe('getSimpleHealth', () => {
    it('should return ok status when all services are healthy', async () => {
      userRepository.query.mockResolvedValue([{ result: 1 }]);
      
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);
      
      cacheService.healthCheck.mockResolvedValue(true);

      const result = await service.getSimpleHealth();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });

    it('should return error status when any service fails', async () => {
      userRepository.query.mockRejectedValue(new Error('DB Error'));
      
      const mockChain = {
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({}),
        }),
      };
      urlModel.findOne.mockReturnValue(mockChain);
      
      cacheService.healthCheck.mockResolvedValue(true);

      const result = await service.getSimpleHealth();

      expect(result.status).toBe('error');
    });
  });

  describe('recordRequest', () => {
    it('should record request metrics', () => {
      service.recordRequest(100, false);
      service.recordRequest(200, true);

      const metrics = service['requestMetrics'];
      expect(metrics.total).toBe(2);
      expect(metrics.errors).toBe(1);
      expect(metrics.totalResponseTime).toBe(300);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics', () => {
      service.recordRequest(100, false);
      service.resetMetrics();

      const metrics = service['requestMetrics'];
      expect(metrics.total).toBe(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.totalResponseTime).toBe(0);
    });
  });
});