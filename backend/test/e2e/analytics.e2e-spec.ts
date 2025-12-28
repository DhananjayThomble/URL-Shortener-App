/**
 * Analytics End-to-End Tests
 * Tests complete analytics workflows and cross-module integration
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('Analytics (e2e)', () => {
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

  describe('Click Tracking Integration', () => {
    it('should track comprehensive analytics data on link click', async () => {
      // Create a link with UTM parameters and tracking pixels
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Analytics Test Link',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'spring-sale',
        metaPixelId: 'meta123',
        googleAnalyticsId: 'ga456',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Click the link with specific user agent and referrer
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
        .set('Referer', 'https://google.com')
        .expect(302);

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify analytics data was captured
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.totalClicks).toBe(1);
      expect(analyticsResponse.body.uniqueClicks).toBe(1);
      expect(analyticsResponse.body.deviceBreakdown.desktop).toBe(1);
      expect(analyticsResponse.body.browserBreakdown.Chrome).toBe(1);
      expect(analyticsResponse.body.referrerBreakdown['google.com']).toBe(1);
    });

    it('should track device-specific routing analytics', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Device Routing Link',
        iosUrl: 'https://apps.apple.com/app/example',
        androidUrl: 'https://play.google.com/store/apps/details?id=com.example',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Click from iOS device
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15')
        .expect(302);

      // Click from Android device
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36')
        .expect(302);

      // Click from desktop
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        .expect(302);

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify device breakdown
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.totalClicks).toBe(3);
      expect(analyticsResponse.body.deviceBreakdown.mobile).toBe(2);
      expect(analyticsResponse.body.deviceBreakdown.desktop).toBe(1);
    });

    it('should track geo-targeting analytics', async () => {
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
      const shortCode = createResponse.body.shortCode;

      // Add geo-targeting rules
      const geoRules = [
        { countryCode: 'US', redirectUrl: 'https://example.com/us' },
        { countryCode: 'UK', redirectUrl: 'https://example.com/uk' },
      ];

      await request(app.getHttpServer())
        .post(`/api/links/${linkId}/geo-rules`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ geoRules })
        .expect(201);

      // Simulate clicks from different locations
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('X-Forwarded-For', '8.8.8.8') // US IP
        .expect(302);

      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .set('X-Forwarded-For', '81.2.69.142') // UK IP
        .expect(302);

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify geographic breakdown
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.totalClicks).toBe(2);
      expect(analyticsResponse.body.countryBreakdown).toHaveProperty('US');
      expect(analyticsResponse.body.countryBreakdown).toHaveProperty('UK');
    });
  });

  describe('Analytics Aggregation', () => {
    it('should provide time-based analytics aggregation', async () => {
      // Create a link
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Time Analytics Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Generate multiple clicks
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get(`/${shortCode}`)
          .set('User-Agent', `TestAgent-${i}`)
          .expect(302);
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get daily analytics
      const today = new Date().toISOString().split('T')[0];
      const dailyResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}?period=day&date=${today}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(dailyResponse.body.totalClicks).toBe(5);
      expect(dailyResponse.body.period).toBe('day');
    });

    it('should provide user-level analytics dashboard', async () => {
      // Create multiple links
      const links = [];
      for (let i = 0; i < 3; i++) {
        const linkData = {
          originalUrl: `https://example${i}.com`,
          title: `Dashboard Link ${i}`,
        };

        const createResponse = await request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(linkData)
          .expect(201);

        links.push(createResponse.body);
      }

      // Generate clicks for each link
      for (const link of links) {
        for (let i = 0; i < 2; i++) {
          await request(app.getHttpServer())
            .get(`/${link.shortCode}`)
            .expect(302);
        }
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get dashboard analytics
      const dashboardResponse = await request(app.getHttpServer())
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(dashboardResponse.body.totalLinks).toBe(3);
      expect(dashboardResponse.body.totalClicks).toBe(6);
      expect(dashboardResponse.body.topLinks).toHaveLength(3);
    });
  });

  describe('Real-time Analytics', () => {
    it('should provide real-time click tracking', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Real-time Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Get initial real-time stats
      const initialResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}/realtime`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(initialResponse.body.activeUsers).toBe(0);
      expect(initialResponse.body.clicksLastHour).toBe(0);

      // Generate a click
      await request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(302);

      // Wait briefly for real-time processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Get updated real-time stats
      const updatedResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}/realtime`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(updatedResponse.body.clicksLastHour).toBe(1);
    });
  });

  describe('Analytics Export', () => {
    it('should export analytics data in CSV format', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Export Test Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Generate some clicks
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())
          .get(`/${shortCode}`)
          .set('User-Agent', `TestAgent-${i}`)
          .expect(302);
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Export analytics data
      const exportResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}/export?format=csv`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(exportResponse.headers['content-type']).toContain('text/csv');
      expect(exportResponse.text).toContain('timestamp,browser,device,country');
    });
  });

  describe('Cross-Module Analytics Integration', () => {
    it('should track bio page link clicks', async () => {
      // Create a bio page
      const bioPageData = {
        username: 'analyticstest',
        title: 'Analytics Test Bio',
        bio: 'Testing analytics integration',
      };

      const bioPageResponse = await request(app.getHttpServer())
        .post('/api/bio-pages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(bioPageData)
        .expect(201);

      const bioPageId = bioPageResponse.body.id;

      // Add bio links
      const bioLinkData = {
        title: 'Test Bio Link',
        url: 'https://example.com',
        position: 1,
      };

      const bioLinkResponse = await request(app.getHttpServer())
        .post(`/api/bio-pages/${bioPageId}/links`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(bioLinkData)
        .expect(201);

      // Access bio page
      await request(app.getHttpServer())
        .get(`/bio/${bioPageData.username}`)
        .expect(200);

      // Click bio link
      await request(app.getHttpServer())
        .get(`/bio/${bioPageData.username}/link/${bioLinkResponse.body.id}`)
        .expect(302);

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify bio page analytics
      const bioAnalyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/bio-pages/${bioPageId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(bioAnalyticsResponse.body.totalViews).toBe(1);
      expect(bioAnalyticsResponse.body.totalLinkClicks).toBe(1);
    });

    it('should track tag-based analytics', async () => {
      // Create a tag
      const tagData = {
        name: 'Analytics Tag',
        color: '#3b82f6',
      };

      const tagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(tagData)
        .expect(201);

      const tagId = tagResponse.body.id;

      // Create links with the tag
      const linkPromises = Array.from({ length: 3 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            originalUrl: `https://example${i}.com`,
            title: `Tagged Link ${i}`,
            tagIds: [tagId],
          })
      );

      const linkResponses = await Promise.all(linkPromises);

      // Generate clicks for tagged links
      for (const linkResponse of linkResponses) {
        await request(app.getHttpServer())
          .get(`/${linkResponse.body.shortCode}`)
          .expect(302);
      }

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get tag-based analytics
      const tagAnalyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/tags/${tagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(tagAnalyticsResponse.body.totalClicks).toBe(3);
      expect(tagAnalyticsResponse.body.linksCount).toBe(3);
    });
  });

  describe('Analytics Performance', () => {
    it('should handle high-volume analytics processing', async () => {
      const linkData = {
        originalUrl: 'https://example.com',
        title: 'Performance Test Link',
      };

      const createResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(linkData)
        .expect(201);

      const shortCode = createResponse.body.shortCode;
      const linkId = createResponse.body.id;

      // Generate many concurrent clicks
      const clickPromises = Array.from({ length: 50 }, (_, i) =>
        request(app.getHttpServer())
          .get(`/${shortCode}`)
          .set('User-Agent', `LoadTestAgent-${i}`)
          .expect(302)
      );

      await Promise.all(clickPromises);

      // Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify all clicks were tracked
      const analyticsResponse = await request(app.getHttpServer())
        .get(`/api/analytics/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(analyticsResponse.body.totalClicks).toBe(50);
    });
  });
});