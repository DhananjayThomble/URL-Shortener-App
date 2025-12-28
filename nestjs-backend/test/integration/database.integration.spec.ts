/**
 * Database Integration Tests
 * Tests database connections and basic operations
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { DatabaseModule } from '../../src/config/database.module';
import { RedisModule } from '../../src/config/redis.module';
import Redis from 'ioredis';

describe('Database Integration', () => {
  let module: TestingModule;
  let postgresDataSource: DataSource;
  let redisClient: Redis;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        RedisModule,
        MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/test'),
      ],
    }).compile();

    postgresDataSource = module.get<DataSource>(DataSource);
    redisClient = module.get<Redis>('REDIS_CLIENT');
  });

  afterAll(async () => {
    if (postgresDataSource) {
      await postgresDataSource.destroy();
    }
    if (redisClient) {
      redisClient.disconnect();
    }
    await module.close();
  });

  describe('PostgreSQL Connection', () => {
    it('should connect to PostgreSQL successfully', async () => {
      expect(postgresDataSource).toBeDefined();
      expect(postgresDataSource.isInitialized).toBe(true);
    });

    it('should execute basic queries', async () => {
      const result = await postgresDataSource.query('SELECT 1 as test');
      expect(result).toEqual([{ test: 1 }]);
    });

    it('should handle transactions', async () => {
      const queryRunner = postgresDataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        await queryRunner.query('CREATE TEMPORARY TABLE test_transaction (id INTEGER)');
        await queryRunner.query('INSERT INTO test_transaction (id) VALUES (1)');
        const result = await queryRunner.query('SELECT * FROM test_transaction');
        
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      } finally {
        await queryRunner.release();
      }
    });
  });

  describe('Redis Connection', () => {
    it('should connect to Redis successfully', async () => {
      expect(redisClient).toBeDefined();
      expect(redisClient.status).toBe('ready');
    });

    it('should set and get values', async () => {
      const key = 'test:integration';
      const value = 'test-value';

      await redisClient.set(key, value);
      const retrieved = await redisClient.get(key);

      expect(retrieved).toBe(value);
      
      // Cleanup
      await redisClient.del(key);
    });

    it('should handle expiration', async () => {
      const key = 'test:expiration';
      const value = 'expires-soon';

      await redisClient.set(key, value, 'EX', 1); // 1 second expiration
      
      const immediate = await redisClient.get(key);
      expect(immediate).toBe(value);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const expired = await redisClient.get(key);
      expect(expired).toBeNull();
    });
  });

  describe('Connection Pooling', () => {
    it('should handle multiple concurrent connections', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        postgresDataSource.query('SELECT $1 as connection_test', [i])
      );

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result[0].connection_test).toBe(index);
      });
    });

    it('should handle Redis connection pooling', async () => {
      const promises = Array.from({ length: 10 }, async (_, i) => {
        const key = `test:pool:${i}`;
        await redisClient.set(key, `value-${i}`);
        return redisClient.get(key);
      });

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      results.forEach((result, index) => {
        expect(result).toBe(`value-${index}`);
      });

      // Cleanup
      const cleanupPromises = Array.from({ length: 10 }, (_, i) =>
        redisClient.del(`test:pool:${i}`)
      );
      await Promise.all(cleanupPromises);
    });
  });
});