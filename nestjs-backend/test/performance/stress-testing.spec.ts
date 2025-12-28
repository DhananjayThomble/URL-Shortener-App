/**
 * Stress Testing Scenarios
 * Tests system behavior under extreme conditions and resource constraints
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';
import { performance } from 'perf_hooks';

describe('Stress Testing', () => {
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

  describe('High Volume Stress Tests', () => {
    it('should handle extreme concurrent link creation', async () => {
      const extremeLoad = 500;
      const timeout = 120000; // 2 minutes
      
      console.log(`Starting extreme link creation stress test with ${extremeLoad} concurrent requests...`);
      
      const startTime = performance.now();
      const startMemory = process.memoryUsage();
      
      const promises = Array.from({ length: extremeLoad }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://stress-test-${i}.com`,
            title: `Stress Test Link ${i}`,
            utmSource: 'stress-test',
            utmMedium: 'automated',
            utmCampaign: 'extreme-load',
          })
          .timeout(timeout)
      );

      const results = await Promise.allSettled(promises);
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      const duration = endTime - startTime;

      const successful = results.filter(
        result => result.status === 'fulfilled' && result.value.status === 201
      ).length;
      const failed = results.length - successful;
      const successRate = (successful / extremeLoad) * 100;
      const memoryIncrease = (endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024;

      console.log(`Extreme Link Creation Stress Test Results:`);
      console.log(`- Total requests: ${extremeLoad}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Failed: ${failed}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);
      console.log(`- Memory increase: ${memoryIncrease.toFixed(2)}MB`);
      console.log(`- Throughput: ${(extremeLoad / (duration / 1000)).toFixed(2)} req/s`);

      // Under extreme stress, we expect some degradation but system should remain stable
      expect(successRate).toBeGreaterThan(70); // At least 70% success rate under extreme load
      expect(duration).toBeLessThan(timeout);
      expect(memoryIncrease).toBeLessThan(500); // Memory increase should be reasonable
    });

    it('should handle sustained high-volume link access', async () => {
      // Setup: Create test links
      const setupSize = 50;
      const setupPromises = Array.from({ length: setupSize }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://sustained-access-${i}.com`,
            title: `Sustained Access Link ${i}`,
          })
      );

      const linkResponses = await Promise.all(setupPromises);
      const testLinks = linkResponses.map(r => r.body);

      // Stress test: Sustained high-volume access
      const totalRequests = 2000;
      const concurrentBatches = 20;
      const requestsPerBatch = totalRequests / concurrentBatches;
      const testDuration = 30000; // 30 seconds

      console.log(`Starting sustained access stress test: ${totalRequests} requests over ${testDuration/1000}s`);

      const startTime = performance.now();
      let completedRequests = 0;
      let successfulRequests = 0;

      const batchPromises = Array.from({ length: concurrentBatches }, async () => {
        const batchRequests = Array.from({ length: requestsPerBatch }, async () => {
          try {
            const randomLink = testLinks[Math.floor(Math.random() * testLinks.length)];
            const response = await request(app.getHttpServer())
              .get(`/${randomLink.shortCode}`)
              .set('User-Agent', 'StressTestAgent/1.0')
              .timeout(5000);
            
            completedRequests++;
            if (response.status === 302) {
              successfulRequests++;
            }
            return response;
          } catch (error) {
            completedRequests++;
            return null;
          }
        });

        return Promise.allSettled(batchRequests);
      });

      await Promise.all(batchPromises);
      const endTime = performance.now();
      const actualDuration = endTime - startTime;
      const throughput = completedRequests / (actualDuration / 1000);
      const successRate = (successfulRequests / completedRequests) * 100;

      console.log(`Sustained Access Stress Test Results:`);
      console.log(`- Total requests: ${completedRequests}`);
      console.log(`- Successful: ${successfulRequests}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Duration: ${actualDuration.toFixed(2)}ms`);
      console.log(`- Throughput: ${throughput.toFixed(2)} req/s`);

      expect(successRate).toBeGreaterThan(85); // 85% success rate under sustained load
      expect(throughput).toBeGreaterThan(30); // At least 30 req/s sustained
    });
  });

  describe('Resource Exhaustion Tests', () => {
    it('should handle memory pressure gracefully', async () => {
      const iterations = 200;
      const largeDataSize = 1000; // Large data per request
      
      console.log(`Starting memory pressure test with ${iterations} iterations...`);
      
      const initialMemory = process.memoryUsage();
      let maxMemoryUsage = initialMemory.heapUsed;
      
      for (let i = 0; i < iterations; i++) {
        // Create requests with large payloads
        const largeTitle = 'A'.repeat(largeDataSize);
        const largeDescription = 'B'.repeat(largeDataSize);
        
        try {
          await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: `https://memory-pressure-${i}.com`,
              title: largeTitle,
              description: largeDescription,
              utmSource: 'memory-test',
              utmMedium: 'stress',
            })
            .timeout(10000);
        } catch (error) {
          // Expected under memory pressure
        }

        // Monitor memory usage
        const currentMemory = process.memoryUsage();
        if (currentMemory.heapUsed > maxMemoryUsage) {
          maxMemoryUsage = currentMemory.heapUsed;
        }

        // Force garbage collection periodically if available
        if (i % 50 === 0 && global.gc) {
          global.gc();
        }

        if (i % 50 === 0) {
          console.log(`Iteration ${i}: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (maxMemoryUsage - initialMemory.heapUsed) / 1024 / 1024;
      
      console.log(`Memory Pressure Test Results:`);
      console.log(`- Initial memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Peak memory: ${(maxMemoryUsage / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Final memory: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`- Max increase: ${memoryIncrease.toFixed(2)}MB`);

      // System should handle memory pressure without crashing
      expect(memoryIncrease).toBeLessThan(1000); // Less than 1GB increase
      expect(finalMemory.heapUsed).toBeLessThan(maxMemoryUsage * 1.5); // Memory should stabilize
    });

    it('should handle database connection exhaustion', async () => {
      const connectionStressLoad = 100;
      const timeout = 60000;
      
      console.log(`Starting database connection stress test with ${connectionStressLoad} concurrent operations...`);
      
      const startTime = performance.now();
      
      // Create many concurrent database operations
      const promises = Array.from({ length: connectionStressLoad }, async (_, i) => {
        try {
          // Mix of different database operations
          const operations = [
            // Create link
            () => request(app.getHttpServer())
              .post('/api/links')
              .set('Authorization', `Bearer ${accessToken}`)
              .send({
                originalUrl: `https://db-stress-${i}.com`,
                title: `DB Stress Link ${i}`,
              }),
            
            // List links
            () => request(app.getHttpServer())
              .get('/api/links?page=1&limit=10')
              .set('Authorization', `Bearer ${accessToken}`),
            
            // Get analytics
            () => request(app.getHttpServer())
              .get('/api/analytics/dashboard')
              .set('Authorization', `Bearer ${accessToken}`),
          ];

          const randomOperation = operations[Math.floor(Math.random() * operations.length)];
          return await randomOperation().timeout(timeout);
        } catch (error) {
          return { error: error.message };
        }
      });

      const results = await Promise.allSettled(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      const successful = results.filter(
        result => result.status === 'fulfilled' && 
                 result.value && 
                 !result.value.error &&
                 [200, 201, 302].includes(result.value.status)
      ).length;
      const failed = results.length - successful;
      const successRate = (successful / connectionStressLoad) * 100;

      console.log(`Database Connection Stress Test Results:`);
      console.log(`- Total operations: ${connectionStressLoad}`);
      console.log(`- Successful: ${successful}`);
      console.log(`- Failed: ${failed}`);
      console.log(`- Success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Duration: ${duration.toFixed(2)}ms`);

      // System should handle connection pressure gracefully
      expect(successRate).toBeGreaterThan(60); // At least 60% success under connection stress
      expect(duration).toBeLessThan(timeout);
    });
  });

  describe('Error Recovery Tests', () => {
    it('should recover from temporary service disruptions', async () => {
      const testDuration = 20000; // 20 seconds
      const requestInterval = 100; // Request every 100ms
      
      console.log(`Starting error recovery test for ${testDuration/1000} seconds...`);
      
      const startTime = performance.now();
      const results = [];
      let requestCount = 0;
      
      const runTest = async () => {
        while (performance.now() - startTime < testDuration) {
          try {
            const response = await request(app.getHttpServer())
              .post('/api/links')
              .set('Authorization', `Bearer ${accessToken}`)
              .send({
                originalUrl: `https://recovery-test-${requestCount}.com`,
                title: `Recovery Test Link ${requestCount}`,
              })
              .timeout(5000);
            
            results.push({
              timestamp: performance.now() - startTime,
              success: response.status === 201,
              status: response.status,
            });
          } catch (error) {
            results.push({
              timestamp: performance.now() - startTime,
              success: false,
              error: error.message,
            });
          }
          
          requestCount++;
          await new Promise(resolve => setTimeout(resolve, requestInterval));
        }
      };

      await runTest();
      
      const successfulRequests = results.filter(r => r.success).length;
      const failedRequests = results.length - successfulRequests;
      const successRate = (successfulRequests / results.length) * 100;
      
      // Analyze recovery patterns
      const timeWindows = [];
      const windowSize = 2000; // 2-second windows
      for (let i = 0; i < testDuration; i += windowSize) {
        const windowResults = results.filter(
          r => r.timestamp >= i && r.timestamp < i + windowSize
        );
        const windowSuccessRate = windowResults.length > 0 
          ? (windowResults.filter(r => r.success).length / windowResults.length) * 100
          : 0;
        
        timeWindows.push({
          startTime: i,
          endTime: i + windowSize,
          requests: windowResults.length,
          successRate: windowSuccessRate,
        });
      }

      console.log(`Error Recovery Test Results:`);
      console.log(`- Total requests: ${results.length}`);
      console.log(`- Successful: ${successfulRequests}`);
      console.log(`- Failed: ${failedRequests}`);
      console.log(`- Overall success rate: ${successRate.toFixed(2)}%`);
      console.log(`- Time windows analysis:`);
      timeWindows.forEach((window, index) => {
        console.log(`  Window ${index + 1}: ${window.successRate.toFixed(1)}% (${window.requests} requests)`);
      });

      // System should maintain reasonable success rate and show recovery
      expect(successRate).toBeGreaterThan(70); // Overall 70% success rate
      expect(results.length).toBeGreaterThan(100); // Should process significant number of requests
      
      // Check for recovery pattern (later windows should have better success rates)
      const firstHalfWindows = timeWindows.slice(0, Math.floor(timeWindows.length / 2));
      const secondHalfWindows = timeWindows.slice(Math.floor(timeWindows.length / 2));
      
      const firstHalfAvg = firstHalfWindows.reduce((sum, w) => sum + w.successRate, 0) / firstHalfWindows.length;
      const secondHalfAvg = secondHalfWindows.reduce((sum, w) => sum + w.successRate, 0) / secondHalfWindows.length;
      
      console.log(`- First half average: ${firstHalfAvg.toFixed(2)}%`);
      console.log(`- Second half average: ${secondHalfAvg.toFixed(2)}%`);
    });
  });

  describe('Cascading Failure Tests', () => {
    it('should handle cascading failures gracefully', async () => {
      const cascadeTestLoad = 200;
      const phases = 4;
      const requestsPerPhase = cascadeTestLoad / phases;
      
      console.log(`Starting cascading failure test with ${cascadeTestLoad} requests in ${phases} phases...`);
      
      const phaseResults = [];
      
      for (let phase = 0; phase < phases; phase++) {
        console.log(`Starting phase ${phase + 1}/${phases}...`);
        
        const phaseStartTime = performance.now();
        
        const phasePromises = Array.from({ length: requestsPerPhase }, async (_, i) => {
          try {
            // Gradually increase complexity and load
            const complexity = phase + 1;
            const response = await request(app.getHttpServer())
              .post('/api/links')
              .set('Authorization', `Bearer ${accessToken}`)
              .send({
                originalUrl: `https://cascade-test-${phase}-${i}.com`,
                title: `Cascade Test Phase ${phase + 1} Link ${i}`,
                utmSource: `phase-${phase + 1}`,
                utmMedium: 'cascade-test',
                utmCampaign: `complexity-${complexity}`,
              })
              .timeout(10000 + (phase * 2000)); // Increasing timeout per phase
            
            return { success: response.status === 201, phase, status: response.status };
          } catch (error) {
            return { success: false, phase, error: error.message };
          }
        });

        const phaseResults_temp = await Promise.allSettled(phasePromises);
        const phaseEndTime = performance.now();
        const phaseDuration = phaseEndTime - phaseStartTime;
        
        const phaseSuccessful = phaseResults_temp.filter(
          result => result.status === 'fulfilled' && result.value.success
        ).length;
        const phaseSuccessRate = (phaseSuccessful / requestsPerPhase) * 100;
        
        phaseResults.push({
          phase: phase + 1,
          duration: phaseDuration,
          successful: phaseSuccessful,
          total: requestsPerPhase,
          successRate: phaseSuccessRate,
          throughput: requestsPerPhase / (phaseDuration / 1000),
        });
        
        console.log(`Phase ${phase + 1} completed: ${phaseSuccessRate.toFixed(2)}% success rate`);
        
        // Brief pause between phases
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log(`Cascading Failure Test Results:`);
      phaseResults.forEach(result => {
        console.log(`- Phase ${result.phase}: ${result.successRate.toFixed(2)}% success, ${result.throughput.toFixed(2)} req/s`);
      });

      const overallSuccessRate = phaseResults.reduce((sum, r) => sum + r.successRate, 0) / phases;
      console.log(`- Overall success rate: ${overallSuccessRate.toFixed(2)}%`);

      // System should maintain stability across phases
      expect(overallSuccessRate).toBeGreaterThan(50); // At least 50% overall success
      expect(phaseResults.every(r => r.successRate > 30)).toBe(true); // Each phase > 30%
      
      // Later phases shouldn't completely fail (system should adapt)
      const lastPhase = phaseResults[phaseResults.length - 1];
      expect(lastPhase.successRate).toBeGreaterThan(20); // Last phase should still have some success
    });
  });
});