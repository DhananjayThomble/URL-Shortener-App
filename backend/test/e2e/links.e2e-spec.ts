/**
 * Links End-to-End Tests
 * Tests complete link management workflows
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('Links (e2e)', () => {
  let app: INestApplication;
  let module: TestingModule;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clear database before each test
    const dataSource = module.get('DataSource');
    await TestDatabaseUtils.clearDatabase(dataSource);

    // Create and authenticate a test user
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

  describe('Link Creation', () => {
    it('should create a basic link successfully', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('shortCode');
      expect(response.body.originalUrl).toBe(linkData.originalUrl);
      expect(response.body.title).toBe(linkData.title);
      expect(response.body.isActive).toBe(true);
      expect(response.body.shortCode).toMatch(/^[a-zA-Z0-9]{8,10}$/);
    });

    it('should create a link with custom alias', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
        customAlias: 'my-custom-link',
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(response.body.customAlias).toBe(linkData.customAlias);
    });

    it('should reject duplicate custom alias', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
        customAlias: 'duplicate-alias',
      };

      // Create first link
      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      // Try to create second link with same alias
      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(409);
    });

    it('should create a link with expiration date', async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Expiring Link',
        expiresAt: expiresAt.toISOString(),
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(new Date(response.body.expiresAt)).toEqual(expiresAt);
    });

    it('should create a link with device-specific URLs', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Device-Specific Link',
        iosUrl: 'https://apps.apple.com/app/example',
        androidUrl: 'https://play.google.com/store/apps/details?id=com.example',
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(response.body.iosUrl).toBe(linkData.iosUrl);
      expect(response.body.androidUrl).toBe(linkData.androidUrl);
    });

    it('should create a link with UTM parameters', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'UTM Link',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'spring-sale',
        utmTerm: 'discount',
        utmContent: 'header-link',
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(response.body.utmSource).toBe(linkData.utmSource);
      expect(response.body.utmMedium).toBe(linkData.utmMedium);
      expect(response.body.utmCampaign).toBe(linkData.utmCampaign);
      expect(response.body.utmTerm).toBe(linkData.utmTerm);
      expect(response.body.utmContent).toBe(linkData.utmContent);
    });

    it('should reject invalid URL', async () => {
      const linkData = {
        originalUrl: 'not-a-valid-url',
        title: 'Invalid Link',
      };

      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(400);
    });
  });

  describe('Password Protection', () => {
    it('should create a password-protected link', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Protected Link',
        password: 'secret123',
        passwordHint: 'It starts with secret',
      };

      const response = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      expect(response.body.passwordHint).toBe(linkData.passwordHint);
      expect(response.body).not.toHaveProperty('password');
      expect(response.body).not.toHaveProperty('passwordHash');
    });

    it('should verify password for protected link', async () => {
      const password = 'secret123';
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Protected Link',
        password,
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;

      // Verify correct password
      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/verify-password`)
        .send({ password })
        .expect(200);

      // Verify incorrect password
      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/verify-password`)
        .send({ password: 'wrong-password' })
        .expect(401);
    });
  });

  describe('Geo-Targeting', () => {
    it('should create geo-targeting rules for a link', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Geo-Targeted Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;

      const geoRules = [
        { countryCode: 'US', redirectUrl: 'https://example.com/us' },
        { countryCode: 'UK', redirectUrl: 'https://example.com/uk' },
      ];

      const response = await request(app.getHttpServer())
        .post(`/api/links/${linkId}/geo-rules`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ geoRules })
        .expect(201);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].countryCode).toBe('US');
      expect(response.body[1].countryCode).toBe('UK');
    });
  });

  describe('Link Retrieval', () => {
    it('should get user links with pagination', async () => {
      // Create multiple links
      const linkPromises = Array.from({ length: 15 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://example${i}.com`,
            title: `Test Link ${i}`,
          })
      );

      await Promise.all(linkPromises);

      // Get first page
      const response = await request(app.getHttpServer())
        .get('/api/links?page=1&limit=10')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(10);
      expect(response.body.meta.total).toBe(15);
      expect(response.body.meta.page).toBe(1);
      expect(response.body.meta.totalPages).toBe(2);
    });

    it('should filter links by search term', async () => {
      // Create test links
      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://github.com',
          title: 'GitHub Repository',
        });

      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://google.com',
          title: 'Google Search',
        });

      // Search for GitHub
      const response = await request(app.getHttpServer())
        .get('/api/links?search=github')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toContain('GitHub');
    });
  });

  describe('Link Updates', () => {
    it('should update link details', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Original Title',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;

      const updateData = {
        title: 'Updated Title',
        originalUrl: 'https://updated-example.com',
      };

      const response = await request(app.getHttpServer())
        .patch(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.title).toBe(updateData.title);
      expect(response.body.originalUrl).toBe(updateData.originalUrl);
    });

    it('should toggle link active status', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;

      // Deactivate link
      const deactivateResponse = await request(app.getHttpServer())
        .patch(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isActive: false })
        .expect(200);

      expect(deactivateResponse.body.isActive).toBe(false);

      // Reactivate link
      const reactivateResponse = await request(app.getHttpServer())
        .patch(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isActive: true })
        .expect(200);

      expect(reactivateResponse.body.isActive).toBe(true);
    });
  });

  describe('Link Deletion', () => {
    it('should delete a link', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;

      // Delete link
      await request(app.getHttpServer())
        .delete(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Verify link is deleted
      await request(app.getHttpServer())
        .get(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('Link Redirection', () => {
    it('should redirect to original URL', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Test Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;

      // Test redirect (should return 302 with Location header)
      const response = await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(302);

      expect(response.headers.location).toBe(linkData.originalUrl);
    });

    it('should redirect to device-specific URL for mobile', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Device-Specific Link',
        iosUrl: 'https://apps.apple.com/app/example',
        androidUrl: 'https://play.google.com/store/apps/details?id=com.example',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;

      // Test iOS redirect
      const iosResponse = await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)')
        .expect(302);

      expect(iosResponse.headers.location).toBe(linkData.iosUrl);

      // Test Android redirect
      const androidResponse = await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 10; SM-G975F)')
        .expect(302);

      expect(androidResponse.headers.location).toBe(linkData.androidUrl);
    });

    it('should return 404 for non-existent short code', async () => {
      await request(app.getHttpServer())
        .get('/nonexistent')
        .expect(404);
    });

    it('should return 410 for expired link', async () => {
      const expiresAt = new Date(Date.now() - 1000); // 1 second ago
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Expired Link',
        expiresAt: expiresAt.toISOString(),
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;

      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(410);
    });

    it('should return 403 for inactive link', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Inactive Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const linkId = createResponse.body.id;
      const shortCode = createResponse.body.shortCode;

      // Deactivate link
      await request(app.getHttpServer())
        .patch(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ isActive: false })
        .expect(200);

      // Try to access inactive link
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(403);
    });
  });

  describe('Analytics Integration', () => {
    it('should track click events on redirect', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Analytics Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Click the link
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        .expect(302);

      // Wait a moment for analytics to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check analytics
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.totalClicks).toBe(1);
      expect(analyticsResponse.body.uniqueClicks).toBe(1);
    });
  });
});