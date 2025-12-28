/**
 * Performance Benchmarking Tests
 * Establishes performance baselines and monitors regressions
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';
import { performance } from 'perf_hooks';

describe('Performance Benchmarks', () => {
  let app: INestApplication;
  let module: TestingModule;
  let testDataManager: TestDataManager;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    const dataSource = module.get('DataSource');
    const mongoConnection = module.get('MongoConnection');
    const redisClient = module.get('REDIS_CLIENT');
    
    testDataManager = new TestDataManager(dataSource, mongoConnection, redisClient);
  });

  afterAll(async () => {
    if (testDataManager) {
      await testDataManager.cleanup();
    }
    await app.close();
  });

  beforeEach(async () => {
    await testDataManager.cleanup();

    // Create test user
    const userData = TestDataFactory.createUser();
    const registerResponse = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(userData);

    userId = registerResponse.body.user.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: userData.email,
        password: userData.password,
      });

    accessToken = loginResponse.body.accessToken;
  });

  describe('API Endpoint Benchmarks', () => {
    it('should benchmark link creation performance', async () => {
      const iterations = 100;
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      let successful = 0;
      const promises = Array.from({ length: iterations }, async (_, i) => {
        try {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: `https://benchmark-${i}.com`,
              title: `Benchmark Link ${i}`,
            });
          
          if (response.status === 201) {
            successful++;
          }
          return response;
        } catch (error) {
          return null;
        }
      });

      await Promise.allSettled(promises);
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000);
      const successRate = (successful / iterations) * 100;

      console.log(`\\nLink Creation Benchmark Results:`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} req/s`);
      console.log(`- Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`- Avg Response Time: ${(duration / iterations).toFixed(2)}ms`);
      console.log(`- Memory Delta: ${((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024).toFixed(2)}MB`);

      // Performance assertions (baseline expectations)
      expect(throughput).toBeGreaterThan(50); // At least 50 req/s
      expect(successRate).toBeGreaterThan(95); // 95% success rate
      expect(duration / iterations).toBeLessThan(100); // Avg response time < 100ms
    });

    it('should benchmark link access performance', async () => {
      // Setup: Create test links
      const setupLinks = 10;
      const linkPromises = Array.from({ length: setupLinks }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://access-benchmark-${i}.com`,
            title: `Access Benchmark Link ${i}`,
          })
      );

      const linkResponses = await Promise.all(linkPromises);
      const testLinks = linkResponses.map(r => r.body);

      // Benchmark: Access links
      const iterations = 500;
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      let successful = 0;
      const accessPromises = Array.from({ length: iterations }, async () => {
        try {
          const randomLink = testLinks[Math.floor(Math.random() * testLinks.length)];
          const response = await request(app.getHttpServer())
            .get(`/${randomLink.shortCode}`)
            .set('User-Agent', 'BenchmarkAgent/1.0');
          
          if (response.status === 302) {
            successful++;
          }
          return response;
        } catch (error) {
          return null;
        }
      });

      await Promise.allSettled(accessPromises);
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000);
      const successRate = (successful / iterations) * 100;

      console.log(`\\nLink Access Benchmark Results:`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} req/s`);
      console.log(`- Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`- Avg Response Time: ${(duration / iterations).toFixed(2)}ms`);

      // Performance assertions
      expect(throughput).toBeGreaterThan(200); // At least 200 req/s for link access
      expect(successRate).toBeGreaterThan(98); // 98% success rate
      expect(duration / iterations).toBeLessThan(20); // Avg response time < 20ms
    });

    it('should benchmark analytics query performance', async () => {
      // Setup: Create scenario with analytics data
      const scenario = await testDataManager.createCompleteScenario();
      const testLinks = scenario.links.slice(0, 5);

      // Benchmark: Analytics queries
      const iterations = 50;
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      let successful = 0;
      const queryPromises = Array.from({ length: iterations }, async (_, i) => {
        try {
          const queryType = i % 4;
          let response;
          
          switch (queryType) {
            case 0:
              // Link analytics
              const randomLink = testLinks[Math.floor(Math.random() * testLinks.length)];
              response = await request(app.getHttpServer())
                .get(`/api/analytics/links/${randomLink.id}`)
                .set('Authorization', `Bearer ${accessToken}`);
              break;
            case 1:
              // Dashboard analytics
              response = await request(app.getHttpServer())
                .get('/api/analytics/dashboard')
                .set('Authorization', `Bearer ${accessToken}`);
              break;
            case 2:
              // UTM breakdown
              response = await request(app.getHttpServer())
                .get('/api/analytics/utm-breakdown')
                .set('Authorization', `Bearer ${accessToken}`);
              break;
            case 3:
              // Geographic breakdown
              response = await request(app.getHttpServer())
                .get('/api/analytics/geographic-breakdown')
                .set('Authorization', `Bearer ${accessToken}`);
              break;
          }
          
          if (response && response.status === 200) {
            successful++;
          }
          return response;
        } catch (error) {
          return null;
        }
      });

      await Promise.allSettled(queryPromises);
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000);
      const successRate = (successful / iterations) * 100;

      console.log(`\\nAnalytics Query Benchmark Results:`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} req/s`);
      console.log(`- Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`- Avg Response Time: ${(duration / iterations).toFixed(2)}ms`);

      // Performance assertions (analytics queries are more complex)
      expect(throughput).toBeGreaterThan(10); // At least 10 req/s
      expect(successRate).toBeGreaterThan(95); // 95% success rate
      expect(duration / iterations).toBeLessThan(500); // Avg response time < 500ms
    });
  });

  describe('Database Operation Benchmarks', () => {
    it('should benchmark database write operations', async () => {
      const iterations = 200;
      
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      
      let successful = 0;
      const writePromises = Array.from({ length: iterations }, async (_, i) => {
        try {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: `https://db-write-benchmark-${i}.com`,
              title: `DB Write Benchmark ${i}`,
              utmSource: 'benchmark',
              utmMedium: 'test',
              utmCampaign: 'db-performance',
            });
          
          if (response.status === 201) {
            successful++;
          }
          return response;
        } catch (error) {
          return null;
        }
      });

      await Promise.allSettled(writePromises);
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000);
      const successRate = (successful / iterations) * 100;

      console.log(`\\nDatabase Write Benchmark Results:`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} writes/s`);
      console.log(`- Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`- Avg Write Time: ${(duration / iterations).toFixed(2)}ms`);

      expect(throughput).toBeGreaterThan(30); // At least 30 writes/s
      expect(successRate).toBeGreaterThan(95);
    });

    it('should benchmark database read operations', async () => {
      // Setup: Create test data
      const setupSize = 100;
      const setupPromises = Array.from({ length: setupSize }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://db-read-setup-${i}.com`,
            title: `DB Read Setup ${i}`,
          })
      );

      await Promise.all(setupPromises);

      // Benchmark: Read operations
      const iterations = 300;
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      
      let successful = 0;
      const readPromises = Array.from({ length: iterations }, async (_, i) => {
        try {
          const page = Math.floor(i / 20) + 1; // Different pages
          const response = await request(app.getHttpServer())
            .get(`/api/links?page=${page}&limit=20&sortBy=createdAt&sortOrder=desc`)
            .set('Authorization', `Bearer ${accessToken}`);
          
          if (response.status === 200) {
            successful++;
          }
          return response;
        } catch (error) {
          return null;
        }
      });

      await Promise.allSettled(readPromises);
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;
      const throughput = iterations / (duration / 1000);
      const successRate = (successful / iterations) * 100;

      console.log(`\\nDatabase Read Benchmark Results:`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} reads/s`);
      console.log(`- Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`- Avg Read Time: ${(duration / iterations).toFixed(2)}ms`);

      expect(throughput).toBeGreaterThan(100); // At least 100 reads/s
      expect(successRate).toBeGreaterThan(98);
    });
  });
});