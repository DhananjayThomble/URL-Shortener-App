import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { CacheService } from './cache.service';

// Mock Redis
jest.mock('ioredis');
const MockedRedis = Redis as jest.MockedClass<typeof Redis>;

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: jest.Mocked<Redis>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create mock Redis instance
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      flushall: jest.fn(),
      mget: jest.fn(),
      pipeline: jest.fn(),
      keys: jest.fn(),
      info: jest.fn(),
      ping: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    } as any;

    // Mock pipeline
    const mockPipeline = {
      set: jest.fn().mockReturnThis(),
      setex: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedis.pipeline.mockReturnValue(mockPipeline as any);

    // Mock Redis constructor
    MockedRedis.mockImplementation(() => mockRedis);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              const config = {
                REDIS_URL: 'redis://localhost:6379',
                REDIS_HOST: 'localhost',
                REDIS_PORT: '6379',
                REDIS_PASSWORD: undefined,
              };
              return config[key] || defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
    configService = module.get(ConfigService);

    // Initialize the service
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.clearAllMocks();
  });

  describe('Basic Operations', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should get value from cache', async () => {
      const testValue = { data: 'test' };
      mockRedis.get.mockResolvedValue(JSON.stringify(testValue));

      const result = await service.get('test-key');

      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
      expect(result).toEqual(testValue);
    });

    it('should return null for non-existent key', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await service.get('non-existent');

      expect(result).toBeNull();
    });

    it('should set value in cache without TTL', async () => {
      const testValue = { data: 'test' };
      mockRedis.set.mockResolvedValue('OK');

      await service.set('test-key', testValue);

      expect(mockRedis.set).toHaveBeenCalledWith('test-key', JSON.stringify(testValue));
    });

    it('should set value in cache with TTL', async () => {
      const testValue = { data: 'test' };
      const ttl = 3600;
      mockRedis.setex.mockResolvedValue('OK');

      await service.set('test-key', testValue, ttl);

      expect(mockRedis.setex).toHaveBeenCalledWith('test-key', ttl, JSON.stringify(testValue));
    });

    it('should delete value from cache', async () => {
      mockRedis.del.mockResolvedValue(1);

      await service.del('test-key');

      expect(mockRedis.del).toHaveBeenCalledWith('test-key');
    });

    it('should check if key exists', async () => {
      mockRedis.exists.mockResolvedValue(1);

      const result = await service.exists('test-key');

      expect(mockRedis.exists).toHaveBeenCalledWith('test-key');
      expect(result).toBe(true);
    });

    it('should increment value', async () => {
      mockRedis.incr.mockResolvedValue(5);

      const result = await service.increment('counter-key');

      expect(mockRedis.incr).toHaveBeenCalledWith('counter-key');
      expect(result).toBe(5);
    });

    it('should set expiration on key', async () => {
      mockRedis.expire.mockResolvedValue(1);

      await service.expire('test-key', 3600);

      expect(mockRedis.expire).toHaveBeenCalledWith('test-key', 3600);
    });
  });

  describe('Advanced Operations', () => {
    it('should get or set value using factory function', async () => {
      const testValue = { data: 'factory-test' };
      const factory = jest.fn().mockResolvedValue(testValue);
      
      // First call - cache miss
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      const result = await service.getOrSet('test-key', factory, 3600);

      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
      expect(factory).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalledWith('test-key', 3600, JSON.stringify(testValue));
      expect(result).toEqual(testValue);
    });

    it('should return cached value without calling factory', async () => {
      const cachedValue = { data: 'cached' };
      const factory = jest.fn();
      
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedValue));

      const result = await service.getOrSet('test-key', factory);

      expect(mockRedis.get).toHaveBeenCalledWith('test-key');
      expect(factory).not.toHaveBeenCalled();
      expect(result).toEqual(cachedValue);
    });

    it('should get multiple values', async () => {
      const values = ['{"data":"value1"}', '{"data":"value2"}', null];
      mockRedis.mget.mockResolvedValue(values);

      const result = await service.mget(['key1', 'key2', 'key3']);

      expect(mockRedis.mget).toHaveBeenCalledWith('key1', 'key2', 'key3');
      expect(result).toEqual([
        { data: 'value1' },
        { data: 'value2' },
        null,
      ]);
    });

    it('should set multiple values', async () => {
      const keyValuePairs = [
        { key: 'key1', value: { data: 'value1' }, ttl: 3600 },
        { key: 'key2', value: { data: 'value2' } },
      ];

      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      await service.mset(keyValuePairs);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.setex).toHaveBeenCalledWith('key1', 3600, JSON.stringify({ data: 'value1' }));
      expect(mockPipeline.set).toHaveBeenCalledWith('key2', JSON.stringify({ data: 'value2' }));
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should invalidate keys by pattern', async () => {
      const keys = ['user:123:session', 'user:123:profile'];
      mockRedis.keys.mockResolvedValue(keys);
      mockRedis.del.mockResolvedValue(2);

      await service.invalidatePattern('user:123:*');

      expect(mockRedis.keys).toHaveBeenCalledWith('user:123:*');
      expect(mockRedis.del).toHaveBeenCalledWith(...keys);
    });
  });

  describe('Specialized Cache Methods', () => {
    it('should cache URL resolution', async () => {
      mockRedis.setex.mockResolvedValue('OK');

      await service.cacheUrlResolution('abc123', 'https://example.com');

      expect(mockRedis.setex).toHaveBeenCalledWith('url:abc123', 3600, '"https://example.com"');
    });

    it('should get cached URL resolution', async () => {
      mockRedis.get.mockResolvedValue('"https://example.com"');

      const result = await service.getCachedUrlResolution('abc123');

      expect(mockRedis.get).toHaveBeenCalledWith('url:abc123');
      expect(result).toBe('https://example.com');
    });

    it('should cache user session', async () => {
      const sessionData = { userId: '123', role: 'user' };
      mockRedis.setex.mockResolvedValue('OK');

      await service.cacheUserSession('123', sessionData);

      expect(mockRedis.setex).toHaveBeenCalledWith('session:123', 900, JSON.stringify(sessionData));
    });

    it('should invalidate user cache', async () => {
      const keys = ['user:123:profile', 'session:123:data'];
      mockRedis.keys
        .mockResolvedValueOnce(['user:123:profile'])
        .mockResolvedValueOnce(['session:123:data'])
        .mockResolvedValueOnce(['popular:123:urls'])
        .mockResolvedValueOnce(['count:urls:123']);
      mockRedis.del.mockResolvedValue(1);

      await service.invalidateUserCache('123');

      expect(mockRedis.keys).toHaveBeenCalledWith('user:123*');
      expect(mockRedis.keys).toHaveBeenCalledWith('session:123*');
      expect(mockRedis.keys).toHaveBeenCalledWith('popular:123*');
      expect(mockRedis.keys).toHaveBeenCalledWith('count:*:123*');
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate URL cache key', () => {
      const key = service.generateUrlCacheKey('abc123');
      expect(key).toBe('url:abc123');
    });

    it('should generate user cache key', () => {
      const key = service.generateUserCacheKey('user123');
      expect(key).toBe('user:user123');
    });

    it('should generate analytics cache key', () => {
      const key = service.generateAnalyticsCacheKey('url123', 'daily');
      expect(key).toBe('analytics:url123:daily');
    });

    it('should generate metadata cache key', () => {
      const key = service.generateMetadataCacheKey('https://example.com');
      expect(key).toMatch(/^metadata:[a-f0-9]{32}$/);
    });

    it('should generate rate limit key', () => {
      const key = service.generateRateLimitKey('192.168.1.1', 'create-url');
      expect(key).toBe('ratelimit:create-url:192.168.1.1');
    });
  });

  describe('Statistics and Health', () => {
    it('should get cache statistics', async () => {
      const mockInfo = 'used_memory_human:10.5M\r\nother_stat:value';
      const mockKeyspace = 'db0:keys=1000,expires=500';
      const mockStats = 'keyspace_hits:5000\r\nkeyspace_misses:1000';
      
      mockRedis.info
        .mockResolvedValueOnce(mockInfo)
        .mockResolvedValueOnce(mockKeyspace)
        .mockResolvedValueOnce(mockStats);

      const stats = await service.getStats();

      expect(stats).toEqual({
        memory: '10.5M',
        keys: 1000,
        hits: 5000,
        misses: 1000,
      });
    });

    it('should perform health check', async () => {
      mockRedis.ping.mockResolvedValue('PONG');

      const result = await service.healthCheck();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle health check failure', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection failed'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle get errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.get('test-key');

      expect(result).toBeNull();
    });

    it('should handle set errors gracefully', async () => {
      mockRedis.setex.mockRejectedValue(new Error('Redis error'));

      await expect(service.set('test-key', 'value', 3600)).resolves.not.toThrow();
    });

    it('should handle increment errors gracefully', async () => {
      mockRedis.incr.mockRejectedValue(new Error('Redis error'));

      const result = await service.increment('counter');

      expect(result).toBe(0);
    });
  });

  describe('Cache Warming', () => {
    it('should warm URL cache', async () => {
      const urls = [
        { shortCode: 'abc123', originalUrl: 'https://example.com' },
        { shortCode: 'def456', originalUrl: 'https://test.com' },
      ];

      const mockPipeline = {
        setex: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      await service.warmUrlCache(urls);

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(mockPipeline.setex).toHaveBeenCalledWith('url:abc123', 3600, '"https://example.com"');
      expect(mockPipeline.setex).toHaveBeenCalledWith('url:def456', 3600, '"https://test.com"');
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });
});