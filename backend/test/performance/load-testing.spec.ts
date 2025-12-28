/**
 * Load Testing Scenarios
 * Tests system performance under various load conditions
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';
import { performance } from 'perf_hooks';

describe('Load Testing', () => {
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

  describe('Link Creation Load Testing', () => {
    it('should handle concurrent link creation requests', async () => {
      const concurrentRequests = 50;
      const startTime = performance.now();

      const linkPromises = Array.from({ length: concurrentRequests }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://load-test-${i}.com`,
            title: `Load Test Link ${i}`,
            customAlias: `load${i}`,
          })
      );

      const responses = await Promise.allSettled(linkPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Analyze results
      const successful = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 201
      ).length;
      const failed = responses.length - successful;

      console.log(`Link Creation Load Test Results:`);
      console.log(`- Total requests: ${concurrentRequests}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Failed: ${failed}`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average response time: ${(duration / concurrentRequests).toFixed(2)}ms`);
      console.log(`- Requests per second: ${(concurrentRequests / (duration / 1000)).toFixed(2)}`);

      // Performance assertions
      expect(successful).toBeGreaterThan(concurrentRequests * 0.95); // 95% success rate
      expect(duration).toBeLessThan(10000); // Complete within 10 seconds
      expect(duration / concurrentRequests).toBeLessThan(200); // Average response time < 200ms
    });

    it('should maintain performance with bulk link creation', async () => {
      const batchSizes = [10, 25, 50, 100];
      const results = [];

      for (const batchSize of batchSizes) {
        const startTime = performance.now();

        const linkPromises = Array.from({ length: batchSize }, (_, i) =>
          request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: `https://batch-test-${batchSize}-${i}.com`,
              title: `Batch Test Link ${batchSize}-${i}`,
            })
        );

        const responses = await Promise.all(linkPromises);
        const endTime = performance.now();
        const duration = endTime - startTime;

        const successful = responses.filter(r => r.status === 201).length;
        const avgResponseTime = duration / batchSize;
        const throughput = batchSize / (duration / 1000);

        results.push({
          batchSize,
          duration,
          successful,
          avgResponseTime,
          throughput,
        });

        console.log(`Batch ${batchSize}: ${avgResponseTime.toFixed(2)}ms avg, ${throughput.toFixed(2)} req/s`);
      }

      // Verify performance doesn't degrade significantly with larger batches
      const smallBatchAvg = results[0].avgResponseTime;
      const largeBatchAvg = results[results.length - 1].avgResponseTime;
      const degradationRatio = largeBatchAvg / smallBatchAvg;

      expect(degradationRatio).toBeLessThan(3); // No more than 3x degradation
      expect(results.every(r => r.successful === r.batchSize)).toBe(true); // All requests successful
    });
  });

  describe('Link Access Load Testing', () => {
    let testLinks: any[];

    beforeEach(async () => {
      // Create test links
      const linkPromises = Array.from({ length: 20 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://access-test-${i}.com`,
            title: `Access Test Link ${i}`,
          })
      );

      const responses = await Promise.all(linkPromises);
      testLinks = responses.map(r => r.body);
    });

    it('should handle high-volume link access requests', async () => {
      const totalRequests = 1000;
      const concurrentBatches = 10;
      const requestsPerBatch = totalRequests / concurrentBatches;

      const startTime = performance.now();
      const batchPromises = [];

      for (let batch = 0; batch < concurrentBatches; batch++) {
        const batchPromise = Promise.all(
          Array.from({ length: requestsPerBatch }, () => {
            const randomLink = testLinks[Math.floor(Math.random() * testLinks.length)];
            return request(app.getHttpServer())
              .get(`/${randomLink.shortCode}`)
              .set('User-Agent', 'LoadTestAgent/1.0')
              .expect(302);
          })
        );
        batchPromises.push(batchPromise);
      }

      await Promise.all(batchPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Link Access Load Test Results:`);
      console.log(`- Total requests: ${totalRequests}`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average response time: ${(duration / totalRequests).toFixed(2)}ms`);
      console.log(`- Requests per second: ${(totalRequests / (duration / 1000)).toFixed(2)}`);

      // Performance assertions
      expect(duration).toBeLessThan(30000); // Complete within 30 seconds
      expect(duration / totalRequests).toBeLessThan(30); // Average response time < 30ms
      expect(totalRequests / (duration / 1000)).toBeGreaterThan(50); // > 50 RPS
    });
  });

  describe('Analytics Load Testing', () => {
    let testLinks: any[];

    beforeEach(async () => {
      // Create test scenario with analytics data
      const scenario = await testDataManager.createHighTrafficScenario();
      testLinks = scenario.links.slice(0, 10); // Use first 10 links for testing
    });

    it('should handle concurrent analytics queries', async () => {
      const concurrentQueries = 50;
      const startTime = performance.now();

      const queryPromises = Array.from({ length: concurrentQueries }, (_, i) => {
        const randomLink = testLinks[Math.floor(Math.random() * testLinks.length)];
        return request(app.getHttpServer())
          .get(`/api/analytics/links/${randomLink.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
      });

      const responses = await Promise.allSettled(queryPromises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      const successful = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 200
      ).length;

      console.log(`Analytics Query Load Test Results:`);
      console.log(`- Total queries: ${concurrentQueries}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Average response time: ${(duration / concurrentQueries).toFixed(2)}ms`);
      console.log(`- Queries per second: ${(concurrentQueries / (duration / 1000)).toFixed(2)}`);

      expect(successful).toBeGreaterThan(concurrentQueries * 0.95);
      expect(duration / concurrentQueries).toBeLessThan(500); // Average response time < 500ms
    });
  });
});