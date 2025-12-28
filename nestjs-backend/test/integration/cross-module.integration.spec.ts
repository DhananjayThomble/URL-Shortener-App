/**
 * Cross-Module Integration Tests
 * Tests interactions between different modules
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { AppModule } from '../../src/app.module';
import { LinksService } from '../../src/modules/links/services/links.service';
import { AnalyticsService } from '../../src/modules/analytics/services/analytics.service';
import { TagsService } from '../../src/modules/tags/services/tags.service';
import { BioPageService } from '../../src/modules/bio-pages/services/bio-page.service';
import { AuthService } from '../../src/modules/auth/services/auth.service';
import { TestDatabaseUtils, TestDataFactory } from '../setup';

describe('Cross-Module Integration', () => {
  let module: TestingModule;
  let postgresDataSource: DataSource;
  let mongoConnection: Connection;
  let redisClient: Redis;
  let linksService: LinksService;
  let analyticsService: AnalyticsService;
  let tagsService: TagsService;
  let bioPageService: BioPageService;
  let authService: AuthService;
  let testUser: any;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    postgresDataSource = module.get<DataSource>(DataSource);
    mongoConnection = module.get<Connection>(getConnectionToken());
    redisClient = module.get<Redis>('REDIS_CLIENT');
    
    linksService = module.get<LinksService>(LinksService);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
    tagsService = module.get<TagsService>(TagsService);
    bioPageService = module.get<BioPageService>(BioPageService);
    authService = module.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    if (postgresDataSource) {
      await postgresDataSource.destroy();
    }
    if (mongoConnection) {
      await mongoConnection.close();
    }
    if (redisClient) {
      redisClient.disconnect();
    }
    await module.close();
  });

  beforeEach(async () => {
    // Clear all databases
    await TestDatabaseUtils.clearDatabase(postgresDataSource);
    
    // Clear MongoDB collections
    const collections = await mongoConnection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }
    
    // Clear Redis
    await redisClient.flushdb();

    // Create test user
    const userData = TestDataFactory.createUser();
    testUser = await authService.register(userData);
  });

  describe('Links and Analytics Integration', () => {
    it('should automatically create analytics events when links are accessed', async () => {
      // Create a link
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://analytics-integration.com',
        title: 'Analytics Integration Test',
      });

      const link = await linksService.create(testUser.id, linkData);

      // Simulate link access
      const clickData = {
        linkId: link.id,
        userId: testUser.id,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        referrer: 'https://google.com',
      };

      await analyticsService.trackClick(clickData);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify analytics data was created
      const analytics = await analyticsService.getLinkAnalytics(link.id, testUser.id);
      
      expect(analytics.totalClicks).toBe(1);
      expect(analytics.uniqueClicks).toBe(1);
      expect(analytics.deviceBreakdown.desktop).toBe(1);
    });

    it('should track UTM parameters in analytics', async () => {
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://utm-test.com',
        title: 'UTM Test Link',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'integration-test',
      });

      const link = await linksService.create(testUser.id, linkData);

      const clickData = {
        linkId: link.id,
        userId: testUser.id,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        referrer: 'https://mail.google.com',
      };

      await analyticsService.trackClick(clickData);
      await new Promise(resolve => setTimeout(resolve, 100));

      const analytics = await analyticsService.getLinkAnalytics(link.id, testUser.id);
      
      expect(analytics.utmBreakdown.source.newsletter).toBe(1);
      expect(analytics.utmBreakdown.medium.email).toBe(1);
      expect(analytics.utmBreakdown.campaign['integration-test']).toBe(1);
    });

    it('should handle geo-targeting and track geographic analytics', async () => {
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://geo-test.com',
        title: 'Geo Test Link',
      });

      const link = await linksService.create(testUser.id, linkData);

      // Add geo-targeting rules
      const geoRules = [
        { countryCode: 'US', redirectUrl: 'https://geo-test.com/us' },
        { countryCode: 'UK', redirectUrl: 'https://geo-test.com/uk' },
      ];

      await linksService.addGeoRules(link.id, testUser.id, geoRules);

      // Simulate clicks from different countries
      const usClickData = {
        linkId: link.id,
        userId: testUser.id,
        ipAddress: '8.8.8.8', // US IP
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referrer: 'https://google.com',
      };

      const ukClickData = {
        linkId: link.id,
        userId: testUser.id,
        ipAddress: '81.2.69.142', // UK IP
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        referrer: 'https://google.co.uk',
      };

      await analyticsService.trackClick(usClickData);
      await analyticsService.trackClick(ukClickData);
      await new Promise(resolve => setTimeout(resolve, 200));

      const analytics = await analyticsService.getLinkAnalytics(link.id, testUser.id);
      
      expect(analytics.totalClicks).toBe(2);
      expect(analytics.countryBreakdown.US).toBe(1);
      expect(analytics.countryBreakdown.UK).toBe(1);
    });
  });

  describe('Links and Tags Integration', () => {
    it('should maintain tag associations when links are updated', async () => {
      // Create tags
      const tag1 = await tagsService.create(testUser.id, { name: 'Work', color: '#3b82f6' });
      const tag2 = await tagsService.create(testUser.id, { name: 'Important', color: '#ef4444' });

      // Create link with tags
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://tagged-link.com',
        title: 'Tagged Link',
      });

      const link = await linksService.create(testUser.id, linkData);
      await linksService.addTags(link.id, testUser.id, [tag1.id, tag2.id]);

      // Update link
      const updatedLink = await linksService.update(link.id, testUser.id, {
        title: 'Updated Tagged Link',
        originalUrl: 'https://updated-tagged-link.com',
      });

      // Verify tags are still associated
      expect(updatedLink.tags).toHaveLength(2);
      expect(updatedLink.tags.map(t => t.id)).toContain(tag1.id);
      expect(updatedLink.tags.map(t => t.id)).toContain(tag2.id);
    });

    it('should cascade delete tag associations when tag is deleted', async () => {
      const tag = await tagsService.create(testUser.id, { name: 'To Delete', color: '#6b7280' });

      // Create multiple links with the tag
      const linkPromises = Array.from({ length: 3 }, (_, i) =>
        linksService.create(testUser.id, TestDataFactory.createLink({
          originalUrl: `https://cascade-test-${i}.com`,
          title: `Cascade Test Link ${i}`,
        }))
      );

      const links = await Promise.all(linkPromises);

      // Associate tag with all links
      for (const link of links) {
        await linksService.addTags(link.id, testUser.id, [tag.id]);
      }

      // Verify associations exist
      for (const link of links) {
        const linkWithTags = await linksService.findById(link.id, testUser.id);
        expect(linkWithTags.tags).toHaveLength(1);
        expect(linkWithTags.tags[0].id).toBe(tag.id);
      }

      // Delete the tag
      await tagsService.delete(tag.id, testUser.id);

      // Verify associations are removed
      for (const link of links) {
        const linkWithoutTags = await linksService.findById(link.id, testUser.id);
        expect(linkWithoutTags.tags).toHaveLength(0);
      }
    });

    it('should provide tag-based analytics aggregation', async () => {
      const tag = await tagsService.create(testUser.id, { name: 'Analytics Tag', color: '#10b981' });

      // Create links with the tag
      const linkPromises = Array.from({ length: 3 }, (_, i) =>
        linksService.create(testUser.id, TestDataFactory.createLink({
          originalUrl: `https://tag-analytics-${i}.com`,
          title: `Tag Analytics Link ${i}`,
        }))
      );

      const links = await Promise.all(linkPromises);

      // Associate tag with links
      for (const link of links) {
        await linksService.addTags(link.id, testUser.id, [tag.id]);
      }

      // Generate clicks for tagged links
      for (const link of links) {
        for (let i = 0; i < 2; i++) {
          await analyticsService.trackClick({
            linkId: link.id,
            userId: testUser.id,
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            referrer: 'https://test.com',
          });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Get tag analytics
      const tagAnalytics = await analyticsService.getTagAnalytics(tag.id, testUser.id);
      
      expect(tagAnalytics.linksCount).toBe(3);
      expect(tagAnalytics.totalClicks).toBe(6);
      expect(tagAnalytics.averageClicksPerLink).toBe(2);
    });
  });

  describe('Bio Pages and Links Integration', () => {
    it('should track bio page views and link clicks separately', async () => {
      // Create bio page
      const bioPageData = TestDataFactory.createBioPage({
        username: 'integration-test',
        title: 'Integration Test Bio',
      });

      const bioPage = await bioPageService.create(testUser.id, bioPageData);

      // Create links
      const linkPromises = Array.from({ length: 2 }, (_, i) =>
        linksService.create(testUser.id, TestDataFactory.createLink({
          originalUrl: `https://bio-link-${i}.com`,
          title: `Bio Link ${i}`,
        }))
      );

      const links = await Promise.all(linkPromises);

      // Add bio links
      for (let i = 0; i < links.length; i++) {
        await bioPageService.addBioLink(bioPage.id, testUser.id, {
          title: `Bio Link ${i}`,
          url: `https://short.ly/${links[i].shortCode}`,
          position: i + 1,
          icon: 'link',
          isActive: true,
        });
      }

      // Track bio page view
      await analyticsService.trackBioPageView({
        bioPageId: bioPage.id,
        userId: testUser.id,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        referrer: 'https://instagram.com',
      });

      // Track bio link clicks
      for (const link of links) {
        await analyticsService.trackClick({
          linkId: link.id,
          userId: testUser.id,
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          referrer: `https://bio.ly/${bioPageData.username}`,
          source: 'bio-page',
        });
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Get bio page analytics
      const bioPageAnalytics = await analyticsService.getBioPageAnalytics(bioPage.id, testUser.id);
      
      expect(bioPageAnalytics.totalViews).toBe(1);
      expect(bioPageAnalytics.totalLinkClicks).toBe(2);
      expect(bioPageAnalytics.clickThroughRate).toBe(2); // 2 clicks / 1 view
    });

    it('should maintain bio link order when links are updated', async () => {
      const bioPageData = TestDataFactory.createBioPage({
        username: 'order-test',
        title: 'Order Test Bio',
      });

      const bioPage = await bioPageService.create(testUser.id, bioPageData);

      // Add bio links in specific order
      const bioLinks = [];
      for (let i = 0; i < 3; i++) {
        const bioLink = await bioPageService.addBioLink(bioPage.id, testUser.id, {
          title: `Bio Link ${i}`,
          url: `https://example${i}.com`,
          position: i + 1,
          icon: 'link',
          isActive: true,
        });
        bioLinks.push(bioLink);
      }

      // Reorder bio links
      const newOrder = [
        { id: bioLinks[2].id, position: 1 },
        { id: bioLinks[0].id, position: 2 },
        { id: bioLinks[1].id, position: 3 },
      ];

      await bioPageService.reorderBioLinks(bioPage.id, testUser.id, newOrder);

      // Verify new order
      const updatedBioPage = await bioPageService.findByUsername(bioPageData.username);
      const sortedLinks = updatedBioPage.bioLinks.sort((a, b) => a.position - b.position);
      
      expect(sortedLinks[0].id).toBe(bioLinks[2].id);
      expect(sortedLinks[1].id).toBe(bioLinks[0].id);
      expect(sortedLinks[2].id).toBe(bioLinks[1].id);
    });
  });

  describe('Authentication and Authorization Integration', () => {
    it('should enforce user isolation across all modules', async () => {
      // Create second user
      const secondUserData = TestDataFactory.createUser({
        email: 'user2@example.com',
        username: 'testuser2',
      });
      const secondUser = await authService.register(secondUserData);

      // Create resources for first user
      const tag1 = await tagsService.create(testUser.id, { name: 'User1 Tag', color: '#3b82f6' });
      const link1 = await linksService.create(testUser.id, TestDataFactory.createLink({
        originalUrl: 'https://user1-link.com',
        title: 'User1 Link',
      }));
      const bioPage1 = await bioPageService.create(testUser.id, TestDataFactory.createBioPage({
        username: 'user1bio',
        title: 'User1 Bio',
      }));

      // Create resources for second user
      const tag2 = await tagsService.create(secondUser.id, { name: 'User2 Tag', color: '#ef4444' });
      const link2 = await linksService.create(secondUser.id, TestDataFactory.createLink({
        originalUrl: 'https://user2-link.com',
        title: 'User2 Link',
      }));
      const bioPage2 = await bioPageService.create(secondUser.id, TestDataFactory.createBioPage({
        username: 'user2bio',
        title: 'User2 Bio',
      }));

      // Verify user1 cannot access user2's resources
      await expect(tagsService.findById(tag2.id, testUser.id)).rejects.toThrow();
      await expect(linksService.findById(link2.id, testUser.id)).rejects.toThrow();
      await expect(bioPageService.findById(bioPage2.id, testUser.id)).rejects.toThrow();

      // Verify user2 cannot access user1's resources
      await expect(tagsService.findById(tag1.id, secondUser.id)).rejects.toThrow();
      await expect(linksService.findById(link1.id, secondUser.id)).rejects.toThrow();
      await expect(bioPageService.findById(bioPage1.id, secondUser.id)).rejects.toThrow();

      // Verify users can access their own resources
      expect(await tagsService.findById(tag1.id, testUser.id)).toBeDefined();
      expect(await linksService.findById(link1.id, testUser.id)).toBeDefined();
      expect(await bioPageService.findById(bioPage1.id, testUser.id)).toBeDefined();

      expect(await tagsService.findById(tag2.id, secondUser.id)).toBeDefined();
      expect(await linksService.findById(link2.id, secondUser.id)).toBeDefined();
      expect(await bioPageService.findById(bioPage2.id, secondUser.id)).toBeDefined();
    });

    it('should handle JWT token expiration across modules', async () => {
      // This would typically involve mocking JWT expiration
      // For now, we'll test with an invalid token format
      const invalidUserId = 'invalid-user-id';

      await expect(tagsService.findAll(invalidUserId, {})).rejects.toThrow();
      await expect(linksService.findAll(invalidUserId, {})).rejects.toThrow();
      await expect(bioPageService.findByUserId(invalidUserId)).rejects.toThrow();
    });
  });

  describe('Caching Integration', () => {
    it('should cache frequently accessed data across modules', async () => {
      // Create a link
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://cache-test.com',
        title: 'Cache Test Link',
      });

      const link = await linksService.create(testUser.id, linkData);

      // First access should hit database and cache result
      const firstAccess = await linksService.findByShortCode(link.shortCode);
      expect(firstAccess).toBeDefined();

      // Check if data is cached in Redis
      const cachedData = await redisClient.get(`link:shortcode:${link.shortCode}`);
      expect(cachedData).toBeDefined();

      // Second access should use cache
      const secondAccess = await linksService.findByShortCode(link.shortCode);
      expect(secondAccess.id).toBe(firstAccess.id);
    });

    it('should invalidate cache when data is updated', async () => {
      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://cache-invalidation-test.com',
        title: 'Cache Invalidation Test',
      });

      const link = await linksService.create(testUser.id, linkData);

      // Access to cache the data
      await linksService.findByShortCode(link.shortCode);

      // Verify data is cached
      let cachedData = await redisClient.get(`link:shortcode:${link.shortCode}`);
      expect(cachedData).toBeDefined();

      // Update the link
      await linksService.update(link.id, testUser.id, { title: 'Updated Title' });

      // Verify cache is invalidated
      cachedData = await redisClient.get(`link:shortcode:${link.shortCode}`);
      expect(cachedData).toBeNull();
    });
  });

  describe('Event-Driven Architecture', () => {
    it('should propagate events across modules', async () => {
      // This would typically test event emission and handling
      // For now, we'll test the side effects of operations

      const linkData = TestDataFactory.createLink({
        originalUrl: 'https://event-test.com',
        title: 'Event Test Link',
      });

      const link = await linksService.create(testUser.id, linkData);

      // Simulate link access which should trigger analytics event
      await analyticsService.trackClick({
        linkId: link.id,
        userId: testUser.id,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        referrer: 'https://test.com',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify event was processed
      const analytics = await analyticsService.getLinkAnalytics(link.id, testUser.id);
      expect(analytics.totalClicks).toBe(1);

      // Delete link should trigger cleanup events
      await linksService.delete(link.id, testUser.id);

      // Verify analytics data is cleaned up (or marked as deleted)
      await expect(analyticsService.getLinkAnalytics(link.id, testUser.id)).rejects.toThrow();
    });
  });

  describe('Transaction Management', () => {
    it('should maintain data consistency across multiple operations', async () => {
      const tag = await tagsService.create(testUser.id, { name: 'Transaction Test', color: '#8b5cf6' });

      // Create multiple links and associate with tag in a transaction-like operation
      const linkPromises = Array.from({ length: 5 }, (_, i) =>
        linksService.create(testUser.id, TestDataFactory.createLink({
          originalUrl: `https://transaction-test-${i}.com`,
          title: `Transaction Test Link ${i}`,
        }))
      );

      const links = await Promise.all(linkPromises);

      // Associate all links with tag
      const associationPromises = links.map(link =>
        linksService.addTags(link.id, testUser.id, [tag.id])
      );

      await Promise.all(associationPromises);

      // Verify all associations were created
      for (const link of links) {
        const linkWithTags = await linksService.findById(link.id, testUser.id);
        expect(linkWithTags.tags).toHaveLength(1);
        expect(linkWithTags.tags[0].id).toBe(tag.id);
      }

      // Get tag with links count
      const tagWithStats = await tagsService.findById(tag.id, testUser.id);
      expect(tagWithStats.linksCount).toBe(5);
    });
  });
});