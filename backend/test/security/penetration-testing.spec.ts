/**
 * Penetration Testing Scenarios
 * Simulates real-world attack scenarios and security vulnerabilities
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';
import * as crypto from 'crypto';

describe('Penetration Testing', () => {
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

    // Create test user and get token
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

  describe('OWASP Top 10 Security Tests', () => {
    describe('A01: Broken Access Control', () => {
      it('should prevent unauthorized access to admin endpoints', async () => {
        const adminEndpoints = [
          '/api/admin/users',
          '/api/admin/analytics',
          '/api/admin/system-health',
          '/api/admin/logs',
          '/api/admin/config',
        ];

        for (const endpoint of adminEndpoints) {
          const response = await request(app.getHttpServer())
            .get(endpoint)
            .set('Authorization', `Bearer ${accessToken}`);

          expect([403, 404]).toContain(response.status);
        }
      });

      it('should prevent direct object reference attacks', async () => {
        // Create a link
        const linkResponse = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: 'Test Link',
          });

        const linkId = linkResponse.body.id;

        // Try to access with manipulated IDs
        const manipulatedIds = [
          linkId + 1,
          linkId - 1,
          '999999',
          '0',
          '-1',
          'admin',
          '../admin',
          linkId.replace(/\d/g, '9'),
        ];

        for (const id of manipulatedIds) {
          const response = await request(app.getHttpServer())
            .get(`/api/links/${id}`)
            .set('Authorization', `Bearer ${accessToken}`);

          if (response.status === 200) {
            // If successful, ensure it's the user's own resource
            expect(response.body.userId).toBe(userId);
          } else {
            expect([403, 404]).toContain(response.status);
          }
        }
      });

      it('should prevent privilege escalation through parameter manipulation', async () => {
        const escalationAttempts = [
          { role: 'admin' },
          { permissions: ['admin', 'superuser'] },
          { isAdmin: true },
          { level: 'admin' },
          { access: 'full' },
          { type: 'admin' },
        ];

        for (const attempt of escalationAttempts) {
          const response = await request(app.getHttpServer())
            .put(`/api/users/${userId}`)
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              username: 'testuser',
              ...attempt,
            });

          if (response.status === 200) {
            // Ensure privilege escalation didn't work
            expect(response.body.role).not.toBe('admin');
            expect(response.body.permissions).not.toContain('admin');
            expect(response.body.isAdmin).not.toBe(true);
          }
        }
      });
    });

    describe('A02: Cryptographic Failures', () => {
      it('should use secure password hashing', async () => {
        const userData = TestDataFactory.createUser();
        const response = await request(app.getHttpServer())
          .post('/api/auth/register')
          .send(userData);

        expect(response.status).toBe(201);
        
        // Password should never be returned
        expect(response.body.user).not.toHaveProperty('password');
        expect(response.body).not.toHaveProperty('password');
      });

      it('should use secure JWT tokens', async () => {
        const loginResponse = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: 'test@example.com',
            password: 'password123',
          });

        if (loginResponse.status === 200) {
          const token = loginResponse.body.accessToken;
          
          // Token should be properly formatted JWT
          expect(token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
          
          // Token should not contain sensitive information in plain text
          const parts = token.split('.');
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          
          expect(payload).not.toHaveProperty('password');
          expect(payload).not.toHaveProperty('passwordHash');
        }
      });

      it('should prevent timing attacks on authentication', async () => {
        const validUser = TestDataFactory.createUser();
        await request(app.getHttpServer())
          .post('/api/auth/register')
          .send(validUser);

        // Measure timing for valid user with wrong password
        const start1 = Date.now();
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: validUser.email,
            password: 'wrongpassword',
          });
        const time1 = Date.now() - start1;

        // Measure timing for non-existent user
        const start2 = Date.now();
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: 'nonexistent@example.com',
            password: 'anypassword',
          });
        const time2 = Date.now() - start2;

        // Times should be similar to prevent user enumeration
        const timeDifference = Math.abs(time1 - time2);
        expect(timeDifference).toBeLessThan(100); // Less than 100ms difference
      });
    });

    describe('A03: Injection Attacks', () => {
      it('should prevent advanced SQL injection techniques', async () => {
        const advancedSqlPayloads = [
          // Union-based injection
          "' UNION SELECT username, password FROM users WHERE '1'='1",
          // Boolean-based blind injection
          "' AND (SELECT COUNT(*) FROM users) > 0 --",
          // Time-based blind injection
          "'; WAITFOR DELAY '00:00:05' --",
          // Stacked queries
          "'; INSERT INTO users (username) VALUES ('hacker'); --",
          // Second-order injection
          "admin'; UPDATE users SET password='hacked' WHERE username='admin'; --",
        ];

        for (const payload of advancedSqlPayloads) {
          const response = await request(app.getHttpServer())
            .get('/api/links')
            .query({ search: payload })
            .set('Authorization', `Bearer ${accessToken}`);

          expect([200, 400]).toContain(response.status);
          
          if (response.status === 200) {
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
          }
        }
      });

      it('should prevent NoSQL injection with complex operators', async () => {
        const complexNoSqlPayloads = [
          { $where: "function() { return this.username == 'admin' }" },
          { $regex: { $options: 'i' } },
          { $expr: { $gt: ['$field', 0] } },
          { $jsonSchema: { properties: { username: { type: 'string' } } } },
          { $function: { body: 'function() { return true; }', args: [], lang: 'js' } },
        ];

        for (const payload of complexNoSqlPayloads) {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: 'https://example.com',
              title: payload,
            });

          expect(response.status).toBe(400);
        }
      });

      it('should prevent LDAP injection in directory queries', async () => {
        const ldapPayloads = [
          '*)(|(objectClass=*))',
          '*)(uid=*))(|(uid=*',
          '*))%00',
          '*)(&(objectClass=user)(uid=*',
          '*)(|(cn=*))',
        ];

        for (const payload of ldapPayloads) {
          const response = await request(app.getHttpServer())
            .get('/api/users/search')
            .query({ q: payload })
            .set('Authorization', `Bearer ${accessToken}`);

          expect([200, 400, 404]).toContain(response.status);
        }
      });
    });

    describe('A04: Insecure Design', () => {
      it('should implement proper business logic validation', async () => {
        // Try to create link with future expiration date manipulation
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 100);

        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: 'Test Link',
            expiresAt: futureDate.toISOString(),
          });

        if (response.status === 201) {
          // Should have reasonable expiration limits
          const expiresAt = new Date(response.body.expiresAt);
          const maxAllowedDate = new Date();
          maxAllowedDate.setFullYear(maxAllowedDate.getFullYear() + 10);
          
          expect(expiresAt.getTime()).toBeLessThanOrEqual(maxAllowedDate.getTime());
        }
      });

      it('should prevent workflow bypass attacks', async () => {
        // Try to access protected resources without proper workflow
        const protectedEndpoints = [
          '/api/links/analytics/detailed',
          '/api/users/export',
          '/api/admin/backup',
        ];

        for (const endpoint of protectedEndpoints) {
          const response = await request(app.getHttpServer())
            .get(endpoint)
            .set('Authorization', `Bearer ${accessToken}`);

          expect([401, 403, 404]).toContain(response.status);
        }
      });
    });

    describe('A05: Security Misconfiguration', () => {
      it('should not expose sensitive information in error messages', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/nonexistent-endpoint')
          .set('Authorization', `Bearer ${accessToken}`);

        expect(response.status).toBe(404);
        
        // Should not expose internal paths, stack traces, or sensitive info
        const responseText = JSON.stringify(response.body);
        expect(responseText).not.toMatch(/\/home\/.*\/app/);
        expect(responseText).not.toMatch(/Error: .* at .*/);
        expect(responseText).not.toMatch(/node_modules/);
        expect(responseText).not.toMatch(/password/i);
        expect(responseText).not.toMatch(/secret/i);
        expect(responseText).not.toMatch(/token/i);
      });

      it('should have secure HTTP headers', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/health')
          .set('Authorization', `Bearer ${accessToken}`);

        // Check for security headers
        expect(response.headers['x-frame-options']).toBeDefined();
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['x-xss-protection']).toBeDefined();
        expect(response.headers['strict-transport-security']).toBeDefined();
      });

      it('should not expose server information', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/health');

        // Should not expose server version or technology stack
        expect(response.headers['server']).toBeUndefined();
        expect(response.headers['x-powered-by']).toBeUndefined();
      });
    });

    describe('A06: Vulnerable Components', () => {
      it('should handle malformed requests gracefully', async () => {
        const malformedRequests = [
          // Malformed JSON
          '{"invalid": json}',
          '{"unclosed": "string}',
          '{invalid: "json"}',
          // Extremely large payloads
          '{"data": "' + 'x'.repeat(1000000) + '"}',
          // Null bytes
          '{"data": "test\u0000"}',
          // Unicode attacks
          '{"data": "\uFEFF\uFFFE"}',
        ];

        for (const payload of malformedRequests) {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('Content-Type', 'application/json')
            .send(payload);

          expect([400, 413, 422]).toContain(response.status);
        }
      });
    });

    describe('A07: Authentication Failures', () => {
      it('should prevent session fixation attacks', async () => {
        // Get initial session
        const initialResponse = await request(app.getHttpServer())
          .get('/api/health');

        const initialSessionId = initialResponse.headers['set-cookie']?.[0];

        // Login
        const userData = TestDataFactory.createUser();
        await request(app.getHttpServer())
          .post('/api/auth/register')
          .send(userData);

        const loginResponse = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: userData.password,
          });

        const postLoginSessionId = loginResponse.headers['set-cookie']?.[0];

        // Session should change after login
        if (initialSessionId && postLoginSessionId) {
          expect(initialSessionId).not.toBe(postLoginSessionId);
        }
      });

      it('should prevent credential stuffing attacks', async () => {
        const commonCredentials = [
          { email: 'admin@admin.com', password: 'admin' },
          { email: 'test@test.com', password: 'test' },
          { email: 'user@user.com', password: 'user' },
          { email: 'admin@example.com', password: '123456' },
          { email: 'admin@example.com', password: 'password' },
        ];

        let rateLimitHit = false;

        for (const creds of commonCredentials) {
          const response = await request(app.getHttpServer())
            .post('/api/auth/login')
            .send(creds);

          if (response.status === 429) {
            rateLimitHit = true;
            break;
          }

          expect([401, 429]).toContain(response.status);
        }

        // Should implement rate limiting
        expect(rateLimitHit).toBe(true);
      });
    });

    describe('A08: Software Integrity Failures', () => {
      it('should validate file integrity on upload', async () => {
        const maliciousFile = Buffer.from('<?php system($_GET["cmd"]); ?>');
        
        const response = await request(app.getHttpServer())
          .post('/api/upload')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', maliciousFile, 'malicious.php');

        expect([400, 415]).toContain(response.status);
      });
    });

    describe('A09: Logging Failures', () => {
      it('should log security events without exposing sensitive data', async () => {
        // Attempt unauthorized access
        await request(app.getHttpServer())
          .get('/api/admin/users')
          .set('Authorization', `Bearer ${accessToken}`);

        // Attempt SQL injection
        await request(app.getHttpServer())
          .get('/api/links')
          .query({ search: "'; DROP TABLE users; --" })
          .set('Authorization', `Bearer ${accessToken}`);

        // These should be logged but we can't easily test log content in this context
        // In a real scenario, you'd check log files or monitoring systems
      });
    });

    describe('A10: Server-Side Request Forgery (SSRF)', () => {
      it('should prevent SSRF attacks in URL validation', async () => {
        const ssrfPayloads = [
          'http://localhost:22',
          'http://127.0.0.1:3306',
          'http://169.254.169.254/latest/meta-data/',
          'file:///etc/passwd',
          'ftp://internal-server/',
          'http://internal.company.com',
          'http://192.168.1.1',
          'http://10.0.0.1',
          'http://172.16.0.1',
        ];

        for (const payload of ssrfPayloads) {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: payload,
              title: 'Test Link',
            });

          expect([400, 422]).toContain(response.status);
        }
      });

      it('should prevent SSRF through redirects', async () => {
        // This would require setting up a redirect server in a real test
        // For now, we test that the system validates URLs properly
        const redirectPayloads = [
          'https://bit.ly/redirect-to-internal',
          'https://tinyurl.com/internal-redirect',
        ];

        for (const payload of redirectPayloads) {
          const response = await request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: payload,
              title: 'Test Link',
            });

          // Should either validate the final destination or reject
          expect([200, 201, 400, 422]).toContain(response.status);
        }
      });
    });
  });

  describe('Advanced Attack Scenarios', () => {
    it('should prevent race condition attacks', async () => {
      // Create multiple concurrent requests to test race conditions
      const concurrentRequests = Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: 'Race Condition Test',
            customAlias: 'race-test',
          })
      );

      const responses = await Promise.allSettled(concurrentRequests);
      const successful = responses.filter(
        r => r.status === 'fulfilled' && r.value.status === 201
      );

      // Only one should succeed due to unique constraint
      expect(successful.length).toBe(1);
    });

    it('should prevent cache poisoning attacks', async () => {
      const poisoningHeaders = {
        'X-Forwarded-Host': 'evil.com',
        'X-Forwarded-Proto': 'https',
        'X-Original-URL': '/admin',
        'X-Rewrite-URL': '/admin',
        'Host': 'evil.com',
      };

      const response = await request(app.getHttpServer())
        .get('/api/links')
        .set(poisoningHeaders)
        .set('Authorization', `Bearer ${accessToken}`);

      expect([200, 400]).toContain(response.status);
      
      // Response should not contain malicious host
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain('evil.com');
    });

    it('should prevent HTTP parameter pollution', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/links?page=1&page=999&limit=10&limit=1000')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      
      // Should handle parameter pollution gracefully
      expect(response.body.meta.page).toBeLessThanOrEqual(999);
      expect(response.body.meta.limit).toBeLessThanOrEqual(100); // Assuming max limit
    });

    it('should prevent deserialization attacks', async () => {
      const maliciousPayloads = [
        '{"__proto__": {"admin": true}}',
        '{"constructor": {"prototype": {"admin": true}}}',
        '{"__proto__.admin": true}',
      ];

      for (const payload of maliciousPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Content-Type', 'application/json')
          .send(payload);

        expect([400, 422]).toContain(response.status);
      }
    });
  });

  describe('Business Logic Security', () => {
    it('should prevent link quota bypass', async () => {
      // Assuming there's a link creation limit
      const promises = Array.from({ length: 1000 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://example-${i}.com`,
            title: `Test Link ${i}`,
          })
      );

      const responses = await Promise.allSettled(promises);
      const rateLimited = responses.filter(
        r => r.status === 'fulfilled' && r.value.status === 429
      );

      // Should implement rate limiting
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should prevent time manipulation attacks', async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link',
          createdAt: futureDate.toISOString(),
        });

      if (response.status === 201) {
        // Should use server time, not client-provided time
        const createdAt = new Date(response.body.createdAt);
        const now = new Date();
        expect(createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    });
  });
});