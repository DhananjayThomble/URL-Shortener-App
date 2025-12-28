/**
 * System Integration End-to-End Tests
 * Tests complete user journeys across multiple modules
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('System Integration (e2e)', () => {
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

  describe('Complete User Journey: Content Creator Workflow', () => {
    it('should support full content creator workflow', async () => {
      // Step 1: Create bio page
      const bioPageData = {
        username: 'creator123',
        title: 'Content Creator',
        bio: 'Welcome to my content hub!',
        theme: 'modern',
        backgroundColor: '#1f2937',
        textColor: '#ffffff',
        buttonStyle: 'rounded',
        isPublic: true,
      };

      const bioPageResponse = await request(app.getHttpServer())
        .post('/api/bio-pages')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(bioPageData)
        .expect(201);

      const bioPageId = bioPageResponse.body.id;

      // Step 2: Create tags for organization
      const tagPromises = [
        { name: 'YouTube', color: '#ef4444' },
        { name: 'Blog', color: '#3b82f6' },
        { name: 'Social Media', color: '#10b981' },
        { name: 'Sponsored', color: '#f59e0b' },
      ].map(tagData =>
        request(app.getHttpServer())
          .post('/api/tags')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(tagData)
      );

      const tagResponses = await Promise.all(tagPromises);
      const tagIds = tagResponses.map(response => response.body.id);
      const [youtubeTagId, blogTagId, socialTagId, sponsoredTagId] = tagIds;

      // Step 3: Create various types of links
      const linkCreationPromises = [
        // YouTube video with UTM tracking
        {
          originalUrl: 'https://youtube.com/watch?v=example1',
          title: 'My Latest Video',
          customAlias: 'latest-video',
          utmSource: 'bio-page',
          utmMedium: 'social',
          utmCampaign: 'video-promotion',
          tagIds: [youtubeTagId],
        },
        // Blog post with device-specific URLs
        {
          originalUrl: 'https://myblog.com/post/awesome-content',
          title: 'Awesome Blog Post',
          customAlias: 'awesome-post',
          iosUrl: 'https://myblog.com/mobile/post/awesome-content',
          androidUrl: 'https://myblog.com/mobile/post/awesome-content',
          tagIds: [blogTagId],
        },
        // Sponsored content with password protection
        {
          originalUrl: 'https://sponsor.com/exclusive-deal',
          title: 'Exclusive Sponsor Deal',
          password: 'exclusive123',
          passwordHint: 'The word exclusive + 123',
          utmSource: 'bio-page',
          utmMedium: 'sponsored',
          utmCampaign: 'q1-deals',
          tagIds: [sponsoredTagId],
        },
        // Social media with geo-targeting
        {
          originalUrl: 'https://instagram.com/myprofile',
          title: 'Follow me on Instagram',
          customAlias: 'instagram',
          tagIds: [socialTagId],
        },
      ];

      const linkResponses = await Promise.all(
        linkCreationPromises.map(linkData =>
          request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send(linkData)
            .expect(201)
        )
      );

      // Step 4: Add geo-targeting to Instagram link
      const instagramLink = linkResponses[3];
      const geoRules = [
        { countryCode: 'US', redirectUrl: 'https://instagram.com/myprofile?hl=en' },
        { countryCode: 'ES', redirectUrl: 'https://instagram.com/myprofile?hl=es' },
        { countryCode: 'FR', redirectUrl: 'https://instagram.com/myprofile?hl=fr' },
      ];

      await request(app.getHttpServer())
        .post(`/api/links/${instagramLink.body.id}/geo-rules`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ geoRules })
        .expect(201);

      // Step 5: Add bio links to bio page
      const bioLinkPromises = linkResponses.map((linkResponse, index) =>
        request(app.getHttpServer())
          .post(`/api/bio-pages/${bioPageId}/links`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            title: linkResponse.body.title,
            url: `${app.getHttpServer().address()}/${linkResponse.body.shortCode}`,
            icon: ['youtube', 'blog', 'star', 'instagram'][index],
            position: index + 1,
            isActive: true,
          })
      );

      await Promise.all(bioLinkPromises);

      // Step 6: Simulate user interactions
      // Access bio page
      const bioPageViewResponse = await request(app.getHttpServer())
        .get(`/bio/${bioPageData.username}`)
        .expect(200);

      expect(bioPageViewResponse.body.username).toBe(bioPageData.username);
      expect(bioPageViewResponse.body.bioLinks).toHaveLength(4);

      // Click various links with different user agents and locations
      const clickScenarios = [
        // Desktop user from US clicking YouTube link
        {
          shortCode: linkResponses[0].body.shortCode,
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ip: '8.8.8.8', // US IP
          referrer: `${app.getHttpServer().address()}/bio/${bioPageData.username}`,
        },
        // Mobile user from Spain clicking Instagram link
        {
          shortCode: linkResponses[3].body.shortCode,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          ip: '88.26.123.45', // Spanish IP
          referrer: 'https://twitter.com',
        },
        // Android user clicking blog post
        {
          shortCode: linkResponses[1].body.shortCode,
          userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G975F)',
          ip: '203.0.113.1', // Generic IP
          referrer: 'https://google.com',
        },
      ];

      for (const scenario of clickScenarios) {
        await request(app.getHttpServer())
          .get(`/${scenario.shortCode}`)
          .set('User-Agent', scenario.userAgent)
          .set('X-Forwarded-For', scenario.ip)
          .set('Referer', scenario.referrer)
          .expect(302);
      }

      // Step 7: Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 8: Verify comprehensive analytics
      const dashboardResponse = await request(app.getHttpServer())
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(dashboardResponse.body.totalLinks).toBe(4);
      expect(dashboardResponse.body.totalClicks).toBe(3);
      expect(dashboardResponse.body.bioPageViews).toBe(1);

      // Check device breakdown
      expect(dashboardResponse.body.deviceBreakdown.desktop).toBe(1);
      expect(dashboardResponse.body.deviceBreakdown.mobile).toBe(2);

      // Check geographic distribution
      expect(dashboardResponse.body.countryBreakdown).toHaveProperty('US');
      expect(dashboardResponse.body.countryBreakdown).toHaveProperty('ES');

      // Step 9: Export all data
      const exportResponse = await request(app.getHttpServer())
        .post('/api/bulk/export')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          format: 'csv',
          includeAnalytics: true,
          includeBioPages: true,
          includeTags: true,
        })
        .expect(202);

      const exportJobId = exportResponse.body.jobId;

      // Wait for export completion
      let exportStatus = 'queued';
      let attempts = 0;
      while (exportStatus !== 'completed' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${exportJobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        exportStatus = statusResponse.body.status;
        attempts++;
      }

      expect(exportStatus).toBe('completed');

      // Download and verify export
      const downloadResponse = await request(app.getHttpServer())
        .get(`/api/bulk/jobs/${exportJobId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const csvContent = downloadResponse.text;
      expect(csvContent).toContain('latest-video');
      expect(csvContent).toContain('awesome-post');
      expect(csvContent).toContain('instagram');
      expect(csvContent).toContain('YouTube,Blog,Social Media,Sponsored');
    });
  });

  describe('Complete User Journey: Marketing Campaign', () => {
    it('should support comprehensive marketing campaign workflow', async () => {
      // Step 1: Create campaign tags
      const campaignTagResponse = await request(app.getHttpServer())
        .post('/api/tags')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'Spring Campaign 2024', color: '#10b981' })
        .expect(201);

      const campaignTagId = campaignTagResponse.body.id;

      // Step 2: Create multiple campaign links with different targeting
      const campaignLinks = [
        {
          originalUrl: 'https://store.com/spring-sale',
          title: 'Spring Sale - Email Campaign',
          customAlias: 'spring-email',
          utmSource: 'newsletter',
          utmMedium: 'email',
          utmCampaign: 'spring-2024',
          utmContent: 'header-cta',
          metaPixelId: 'meta123456',
          googleAnalyticsId: 'GA-123456789',
        },
        {
          originalUrl: 'https://store.com/spring-sale',
          title: 'Spring Sale - Social Media',
          customAlias: 'spring-social',
          utmSource: 'facebook',
          utmMedium: 'social',
          utmCampaign: 'spring-2024',
          utmContent: 'post-link',
          metaPixelId: 'meta123456',
        },
        {
          originalUrl: 'https://store.com/spring-sale',
          title: 'Spring Sale - Influencer',
          customAlias: 'spring-influencer',
          utmSource: 'influencer',
          utmMedium: 'partnership',
          utmCampaign: 'spring-2024',
          utmContent: 'bio-link',
          password: 'influence2024',
          passwordHint: 'influence + current year',
        },
      ];

      const linkResponses = await Promise.all(
        campaignLinks.map(linkData =>
          request(app.getHttpServer())
            .post('/api/links')
            .set('Authorization', `Bearer ${accessToken}`)
            .send({ ...linkData, tagIds: [campaignTagId] })
            .expect(201)
        )
      );

      // Step 3: Add geo-targeting for international campaign
      const geoTargetingRules = [
        { countryCode: 'US', redirectUrl: 'https://store.com/spring-sale?region=us' },
        { countryCode: 'CA', redirectUrl: 'https://store.com/spring-sale?region=ca' },
        { countryCode: 'UK', redirectUrl: 'https://store.com/spring-sale?region=uk' },
        { countryCode: 'DE', redirectUrl: 'https://store.com/spring-sale?region=de' },
      ];

      for (const linkResponse of linkResponses) {
        await request(app.getHttpServer())
          .post(`/api/links/${linkResponse.body.id}/geo-rules`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ geoRules: geoTargetingRules })
          .expect(201);
      }

      // Step 4: Simulate campaign traffic from different sources
      const trafficSimulation = [
        // Email campaign clicks
        ...Array.from({ length: 50 }, (_, i) => ({
          shortCode: linkResponses[0].body.shortCode,
          userAgent: i % 2 === 0 
            ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          ip: ['8.8.8.8', '1.1.1.1', '208.67.222.222'][i % 3],
          referrer: 'https://mail.google.com',
          needsPassword: false,
        })),
        // Social media clicks
        ...Array.from({ length: 30 }, (_, i) => ({
          shortCode: linkResponses[1].body.shortCode,
          userAgent: i % 3 === 0 
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
            : i % 3 === 1
            ? 'Mozilla/5.0 (Linux; Android 10; SM-G975F)'
            : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ip: ['88.26.123.45', '81.2.69.142', '46.19.37.108'][i % 3], // EU IPs
          referrer: 'https://facebook.com',
          needsPassword: false,
        })),
        // Influencer clicks (password protected)
        ...Array.from({ length: 20 }, (_, i) => ({
          shortCode: linkResponses[2].body.shortCode,
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          ip: ['142.250.191.14', '172.217.12.14'][i % 2], // US IPs
          referrer: 'https://instagram.com',
          needsPassword: true,
        })),
      ];

      // Execute traffic simulation
      for (const traffic of trafficSimulation) {
        if (traffic.needsPassword) {
          // First verify password
          const linkId = linkResponses[2].body.id;
          await request(app.getHttpServer())
            .post(`/api/links/${linkId}/verify-password`)
            .send({ password: 'influence2024' })
            .expect(200);
        }

        await request(app.getHttpServer())
          .get(`/${traffic.shortCode}`)
          .set('User-Agent', traffic.userAgent)
          .set('X-Forwarded-For', traffic.ip)
          .set('Referer', traffic.referrer)
          .expect(302);
      }

      // Step 5: Wait for analytics processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 6: Analyze campaign performance
      const campaignAnalyticsResponse = await request(app.getHttpServer())
        .get(`/api/tags/${campaignTagId}/analytics`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(campaignAnalyticsResponse.body.totalClicks).toBe(100);
      expect(campaignAnalyticsResponse.body.linksCount).toBe(3);

      // Check UTM source breakdown
      const utmAnalyticsResponse = await request(app.getHttpServer())
        .get('/api/analytics/utm-breakdown')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(utmAnalyticsResponse.body.sources).toHaveProperty('newsletter');
      expect(utmAnalyticsResponse.body.sources).toHaveProperty('facebook');
      expect(utmAnalyticsResponse.body.sources).toHaveProperty('influencer');
      expect(utmAnalyticsResponse.body.campaigns['spring-2024']).toBe(100);

      // Check geographic performance
      const geoAnalyticsResponse = await request(app.getHttpServer())
        .get('/api/analytics/geographic-breakdown')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(geoAnalyticsResponse.body.countries).toHaveProperty('US');
      expect(geoAnalyticsResponse.body.countries).toHaveProperty('ES');
      expect(geoAnalyticsResponse.body.countries).toHaveProperty('UK');

      // Step 7: Generate campaign report
      const reportResponse = await request(app.getHttpServer())
        .post('/api/analytics/reports/campaign')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          tagIds: [campaignTagId],
          dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          dateTo: new Date().toISOString(),
          includeUTM: true,
          includeGeo: true,
          includeDevice: true,
        })
        .expect(202);

      const reportJobId = reportResponse.body.jobId;

      // Wait for report generation
      let reportStatus = 'queued';
      let attempts = 0;
      while (reportStatus !== 'completed' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const statusResponse = await request(app.getHttpServer())
          .get(`/api/bulk/jobs/${reportJobId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        reportStatus = statusResponse.body.status;
        attempts++;
      }

      expect(reportStatus).toBe('completed');

      // Download campaign report
      const reportDownloadResponse = await request(app.getHttpServer())
        .get(`/api/bulk/jobs/${reportJobId}/download`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const reportContent = reportDownloadResponse.text;
      expect(reportContent).toContain('Spring Campaign 2024');
      expect(reportContent).toContain('newsletter,facebook,influencer');
      expect(reportContent).toContain('spring-2024');
    });
  });

  describe('System Health and Monitoring Integration', () => {
    it('should provide comprehensive system health status', async () => {
      // Check overall system health
      const healthResponse = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(healthResponse.body.status).toBe('ok');
      expect(healthResponse.body.info).toHaveProperty('database');
      expect(healthResponse.body.info).toHaveProperty('redis');
      expect(healthResponse.body.info).toHaveProperty('mongodb');

      // Check detailed health information
      const detailedHealthResponse = await request(app.getHttpServer())
        .get('/health/detailed')
        .expect(200);

      expect(detailedHealthResponse.body).toHaveProperty('uptime');
      expect(detailedHealthResponse.body).toHaveProperty('memory');
      expect(detailedHealthResponse.body).toHaveProperty('connections');
    });

    it('should expose metrics for monitoring', async () => {
      // Generate some activity for metrics
      await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://metrics-test.com',
          title: 'Metrics Test Link',
        })
        .expect(201);

      // Check Prometheus metrics
      const metricsResponse = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(metricsResponse.text).toContain('http_requests_total');
      expect(metricsResponse.text).toContain('http_request_duration_seconds');
      expect(metricsResponse.text).toContain('database_connections_active');
    });

    it('should handle graceful shutdown', async () => {
      // This test would typically be more complex in a real scenario
      // For now, we'll test the shutdown endpoint
      const shutdownResponse = await request(app.getHttpServer())
        .post('/admin/shutdown')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ graceful: true })
        .expect(202);

      expect(shutdownResponse.body.message).toContain('shutdown initiated');
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle database connection failures gracefully', async () => {
      // This would typically involve mocking database failures
      // For now, we'll test error response format
      const response = await request(app.getHttpServer())
        .get('/api/links/invalid-uuid')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(400);

      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('timestamp');
      expect(response.body.error).toHaveProperty('requestId');
    });

    it('should handle rate limiting correctly', async () => {
      // Make many rapid requests to trigger rate limiting
      const rapidRequests = Array.from({ length: 100 }, () =>
        request(app.getHttpServer())
          .get('/api/links')
          .set('Authorization', `Bearer ${accessToken}`)
      );

      const responses = await Promise.allSettled(rapidRequests);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(
        result => result.status === 'fulfilled' && result.value.status === 429
      );

      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should maintain data consistency during concurrent operations', async () => {
      // Create a link
      const linkResponse = await request(app.getHttpServer())
        .post('/api/links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          originalUrl: 'https://concurrent-test.com',
          title: 'Concurrent Test Link',
        })
        .expect(201);

      const linkId = linkResponse.body.id;

      // Perform concurrent updates
      const concurrentUpdates = Array.from({ length: 10 }, (_, i) =>
        request(app.getHttpServer())
          .patch(`/api/links/${linkId}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ title: `Updated Title ${i}` })
      );

      const updateResponses = await Promise.allSettled(concurrentUpdates);
      
      // All updates should either succeed or fail gracefully
      const successfulUpdates = updateResponses.filter(
        result => result.status === 'fulfilled' && result.value.status === 200
      );

      expect(successfulUpdates.length).toBeGreaterThan(0);

      // Verify final state is consistent
      const finalStateResponse = await request(app.getHttpServer())
        .get(`/api/links/${linkId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(finalStateResponse.body.title).toMatch(/^Updated Title \d+$/);
    });
  });
});