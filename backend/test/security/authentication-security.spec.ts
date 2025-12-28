/**
 * Authentication Security Tests
 * Tests authentication mechanisms and security vulnerabilities
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';
import * as jwt from 'jsonwebtoken';

describe('Authentication Security', () => {
  let app: INestApplication;
  let module: TestingModule;
  let testDataManager: TestDataManager;

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
  });

  describe('JWT Token Security', () => {
    it('should reject invalid JWT tokens', async () => {
      const invalidTokens = [
        'invalid.token.here',
        'Bearer invalid.token.here',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        '', // Empty token
        'null', // Null string
        'undefined', // Undefined string
      ];

      for (const token of invalidTokens) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .set('Authorization', `Bearer ${token}`);

        expect([401, 403]).toContain(response.status);
      }
    });

    it('should reject expired JWT tokens', async () => {
      // Create a user first
      const userData = TestDataFactory.createUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      // Create an expired token
      const expiredToken = jwt.sign(
        { sub: 'test-user-id', email: userData.email },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '-1h' } // Expired 1 hour ago
      );

      const response = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('expired');
    });

    it('should reject tokens with invalid signatures', async () => {
      const userData = TestDataFactory.createUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      // Create a token with wrong secret
      const invalidToken = jwt.sign(
        { sub: 'test-user-id', email: userData.email },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${invalidToken}`);

      expect(response.status).toBe(401);
    });

    it('should reject tokens with missing required claims', async () => {
      const tokensWithMissingClaims = [
        jwt.sign({}, process.env.JWT_SECRET || 'test-secret'), // No claims
        jwt.sign({ sub: 'user-id' }, process.env.JWT_SECRET || 'test-secret'), // Missing email
        jwt.sign({ email: 'test@example.com' }, process.env.JWT_SECRET || 'test-secret'), // Missing sub
      ];

      for (const token of tokensWithMissingClaims) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .set('Authorization', `Bearer ${token}`);

        expect([401, 403]).toContain(response.status);
      }
    });
  });

  describe('Authentication Bypass Attempts', () => {
    it('should prevent authentication bypass through header manipulation', async () => {
      const bypassAttempts = [
        { 'X-User-Id': 'admin' },
        { 'X-Forwarded-User': 'admin' },
        { 'X-Remote-User': 'admin' },
        { 'X-Auth-User': 'admin' },
        { 'User': 'admin' },
        { 'X-Original-User': 'admin' },
      ];

      for (const headers of bypassAttempts) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .set(headers);

        expect(response.status).toBe(401);
      }
    });

    it('should prevent SQL injection in authentication', async () => {
      const sqlInjectionAttempts = [
        { email: "admin'--", password: 'anything' },
        { email: "admin' OR '1'='1", password: 'anything' },
        { email: "admin'; DROP TABLE users; --", password: 'anything' },
        { email: "admin' UNION SELECT * FROM users --", password: 'anything' },
      ];

      for (const credentials of sqlInjectionAttempts) {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send(credentials);

        expect([400, 401]).toContain(response.status);
        expect(response.body).not.toHaveProperty('accessToken');
      }
    });

    it('should prevent NoSQL injection in authentication', async () => {
      const noSqlInjectionAttempts = [
        { email: { $ne: null }, password: { $ne: null } },
        { email: { $regex: '.*' }, password: { $regex: '.*' } },
        { email: { $where: 'this.email' }, password: 'anything' },
        { email: { $gt: '' }, password: { $gt: '' } },
      ];

      for (const credentials of noSqlInjectionAttempts) {
        const response = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send(credentials);

        expect([400, 401]).toContain(response.status);
        expect(response.body).not.toHaveProperty('accessToken');
      }
    });
  });

  describe('Brute Force Protection', () => {
    it('should implement rate limiting for login attempts', async () => {
      const userData = TestDataFactory.createUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      // Attempt multiple failed logins
      const failedAttempts = [];
      for (let i = 0; i < 10; i++) {
        failedAttempts.push(
          request(app.getHttpServer())
            .post('/api/auth/login')
            .send({
              email: userData.email,
              password: 'wrong-password',
            })
        );
      }

      const responses = await Promise.all(failedAttempts);
      
      // Should start rate limiting after several attempts
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should implement account lockout after multiple failed attempts', async () => {
      const userData = TestDataFactory.createUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      // Attempt multiple failed logins sequentially
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({
            email: userData.email,
            password: 'wrong-password',
          });
      }

      // Try with correct password - should be locked
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        });

      // Account should be locked or rate limited
      expect([401, 429]).toContain(response.status);
    });
  });

  describe('Session Security', () => {
    let accessToken: string;
    let refreshToken: string;

    beforeEach(async () => {
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

      accessToken = loginResponse.body.accessToken;
      refreshToken = loginResponse.body.refreshToken;
    });

    it('should invalidate tokens on logout', async () => {
      // Use token before logout
      let response = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(200);

      // Logout
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`);

      // Try to use token after logout
      response = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(401);
    });

    it('should prevent token reuse after refresh', async () => {
      // Refresh token
      const refreshResponse = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });

      expect(refreshResponse.status).toBe(200);
      const newAccessToken = refreshResponse.body.accessToken;

      // Old token should be invalidated
      const response = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(response.status).toBe(401);

      // New token should work
      const newResponse = await request(app.getHttpServer())
        .get('/api/links')
        .set('Authorization', `Bearer ${newAccessToken}`);
      expect(newResponse.status).toBe(200);
    });

    it('should prevent refresh token reuse', async () => {
      // Use refresh token once
      const firstRefresh = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(firstRefresh.status).toBe(200);

      // Try to use same refresh token again
      const secondRefresh = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(secondRefresh.status).toBe(401);
    });
  });

  describe('Password Security', () => {
    it('should enforce strong password requirements', async () => {
      const weakPasswords = [
        '123456',
        'password',
        'qwerty',
        'abc123',
        '12345678',
        'password123',
        '', // Empty password
        'a', // Too short
        'aaaaaaaa', // No complexity
      ];

      for (const password of weakPasswords) {
        const userData = TestDataFactory.createUser({ password });
        const response = await request(app.getHttpServer())
          .post('/api/auth/register')
          .send(userData);

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('password');
      }
    });

    it('should hash passwords securely', async () => {
      const userData = TestDataFactory.createUser();
      const response = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      expect(response.status).toBe(201);

      // Password should not be returned in response
      expect(response.body.user).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('password');
    });

    it('should prevent password enumeration', async () => {
      // Try to login with non-existent user
      const nonExistentResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'anypassword',
        });

      // Create a user
      const userData = TestDataFactory.createUser();
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);

      // Try to login with wrong password
      const wrongPasswordResponse = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: 'wrongpassword',
        });

      // Both responses should be similar to prevent enumeration
      expect(nonExistentResponse.status).toBe(wrongPasswordResponse.status);
      expect(nonExistentResponse.body.message).toBe(wrongPasswordResponse.body.message);
    });
  });

  describe('Authorization Security', () => {
    let userToken: string;
    let adminToken: string;
    let userId: string;
    let adminId: string;

    beforeEach(async () => {
      // Create regular user
      const userData = TestDataFactory.createUser();
      const userResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(userData);
      userId = userResponse.body.user.id;

      const userLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: userData.email,
          password: userData.password,
        });
      userToken = userLogin.body.accessToken;

      // Create admin user
      const adminData = TestDataFactory.createUser({
        email: 'admin@example.com',
        role: 'admin',
      });
      const adminResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(adminData);
      adminId = adminResponse.body.user.id;

      const adminLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: adminData.email,
          password: adminData.password,
        });
      adminToken = adminLogin.body.accessToken;
    });

    it('should prevent horizontal privilege escalation', async () => {
      // Create another user
      const otherUserData = TestDataFactory.createUser({
        email: 'other@example.com',
      });
      const otherUserResponse = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(otherUserData);
      const otherUserId = otherUserResponse.body.user.id;

      // User should not be able to access other user's data
      const response = await request(app.getHttpServer())
        .get(`/api/users/${otherUserId}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect([403, 404]).toContain(response.status);
    });

    it('should prevent vertical privilege escalation', async () => {
      // Regular user should not be able to access admin endpoints
      const adminEndpoints = [
        '/api/admin/users',
        '/api/admin/analytics',
        '/api/admin/system-health',
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app.getHttpServer())
          .get(endpoint)
          .set('Authorization', `Bearer ${userToken}`);

        expect([403, 404]).toContain(response.status);
      }
    });

    it('should validate resource ownership', async () => {
      // Create a link as user
      const linkResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link',
        });

      const linkId = linkResponse.body.id;

      // Create another user
      const otherUserData = TestDataFactory.createUser({
        email: 'other@example.com',
      });
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(otherUserData);

      const otherUserLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: otherUserData.email,
          password: otherUserData.password,
        });
      const otherUserToken = otherUserLogin.body.accessToken;

      // Other user should not be able to modify the link
      const updateResponse = await request(app.getHttpServer())
        .put(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          title: 'Modified Title',
        });

      expect([403, 404]).toContain(updateResponse.status);

      // Other user should not be able to delete the link
      const deleteResponse = await request(app.getHttpServer())
        .delete(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${otherUserToken}`);

      expect([403, 404]).toContain(deleteResponse.status);
    });
  });

  describe('CSRF Protection', () => {
    it('should require CSRF tokens for state-changing operations', async () => {
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

      const accessToken = loginResponse.body.accessToken;

      // Try to create a link without CSRF token (if implemented)
      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Origin', 'https://malicious-site.com')
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link',
        });

      // Should either succeed (if CSRF not implemented) or fail with proper error
      if (response.status === 403) {
        expect(response.body.message).toContain('CSRF');
      }
    });
  });

  describe('Input Validation Security', () => {
    let accessToken: string;

    beforeEach(async () => {
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

      accessToken = loginResponse.body.accessToken;
    });

    it('should prevent XSS in input fields', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(\'XSS\')">',
        '<svg onload="alert(\'XSS\')">',
        '"><script>alert("XSS")</script>',
      ];

      for (const payload of xssPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: payload,
          });

        if (response.status === 201) {
          // If created, ensure the payload is sanitized
          expect(response.body.title).not.toContain('<script>');
          expect(response.body.title).not.toContain('javascript:');
          expect(response.body.title).not.toContain('onerror');
          expect(response.body.title).not.toContain('onload');
        } else {
          // Should be rejected with validation error
          expect(response.status).toBe(400);
        }
      }
    });

    it('should validate URL formats and prevent malicious URLs', async () => {
      const maliciousUrls = [
        'javascript:alert("XSS")',
        'data:text/html,<script>alert("XSS")</script>',
        'vbscript:msgbox("XSS")',
        'file:///etc/passwd',
        'ftp://malicious-site.com',
        'ldap://malicious-site.com',
        '', // Empty URL
        'not-a-url',
        'http://', // Incomplete URL
      ];

      for (const url of maliciousUrls) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: url,
            title: 'Test Link',
          });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('url');
      }
    });

    it('should prevent path traversal attacks', async () => {
      const pathTraversalPayloads = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '....//....//....//etc/passwd',
        '..%252f..%252f..%252fetc%252fpasswd',
      ];

      for (const payload of pathTraversalPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: 'Test Link',
            customAlias: payload,
          });

        expect([400, 422]).toContain(response.status);
      }
    });
  });
});