/**
 * Test Data Management Utilities
 * Provides comprehensive test data creation and management
 */

import { DataSource } from 'typeorm';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { TestDataFactory } from '../setup';

export interface TestScenario {
  users: any[];
  links: any[];
  tags: any[];
  bioPages: any[];
  analytics: any[];
}

export class TestDataManager {
  constructor(
    private readonly postgresDataSource: DataSource,
    private readonly mongoConnection: Connection,
    private readonly redisClient: Redis,
  ) {}

  /**
   * Create a complete test scenario with users, links, tags, and analytics
   */
  async createCompleteScenario(): Promise<TestScenario> {
    const scenario: TestScenario = {
      users: [],
      links: [],
      tags: [],
      bioPages: [],
      analytics: [],
    };

    // Create test users
    const userRepository = this.postgresDataSource.getRepository('User');
    
    const userData1 = TestDataFactory.createUser({
      email: 'creator@example.com',
      username: 'creator',
      fullName: 'Content Creator',
    });
    
    const userData2 = TestDataFactory.createUser({
      email: 'marketer@example.com',
      username: 'marketer',
      fullName: 'Digital Marketer',
    });

    const user1 = await userRepository.save(userData1);
    const user2 = await userRepository.save(userData2);
    
    scenario.users.push(user1, user2);

    // Create tags for each user
    const tagRepository = this.postgresDataSource.getRepository('Tag');
    
    const user1Tags = [
      { name: 'YouTube', color: '#ef4444', userId: user1.id },
      { name: 'Blog', color: '#3b82f6', userId: user1.id },
      { name: 'Social Media', color: '#10b981', userId: user1.id },
    ];

    const user2Tags = [
      { name: 'Campaign A', color: '#f59e0b', userId: user2.id },
      { name: 'Campaign B', color: '#8b5cf6', userId: user2.id },
      { name: 'Sponsored', color: '#ef4444', userId: user2.id },
    ];

    const createdTags = await tagRepository.save([...user1Tags, ...user2Tags]);
    scenario.tags.push(...createdTags);

    // Create links for each user
    const linkRepository = this.postgresDataSource.getRepository('Link');
    
    const user1Links = [
      {
        originalUrl: 'https://youtube.com/watch?v=example1',
        title: 'My Latest Video',
        shortCode: 'vid001',
        customAlias: 'latest-video',
        userId: user1.id,
        utmSource: 'bio-page',
        utmMedium: 'social',
        utmCampaign: 'video-promo',
        isActive: true,
      },
      {
        originalUrl: 'https://myblog.com/awesome-post',
        title: 'Awesome Blog Post',
        shortCode: 'blog01',
        customAlias: 'awesome-post',
        userId: user1.id,
        iosUrl: 'https://myblog.com/mobile/awesome-post',
        androidUrl: 'https://myblog.com/mobile/awesome-post',
        isActive: true,
      },
      {
        originalUrl: 'https://instagram.com/creator',
        title: 'Follow me on Instagram',
        shortCode: 'insta1',
        customAlias: 'instagram',
        userId: user1.id,
        isActive: true,
      },
    ];

    const user2Links = [
      {
        originalUrl: 'https://store.com/spring-sale',
        title: 'Spring Sale Campaign',
        shortCode: 'spring',
        customAlias: 'spring-sale',
        userId: user2.id,
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'spring-2024',
        metaPixelId: 'meta123456',
        googleAnalyticsId: 'GA-123456789',
        isActive: true,
      },
      {
        originalUrl: 'https://store.com/summer-deals',
        title: 'Summer Deals',
        shortCode: 'summer',
        userId: user2.id,
        utmSource: 'social',
        utmMedium: 'facebook',
        utmCampaign: 'summer-2024',
        passwordHash: '$2b$10$hashedpassword', // Would be properly hashed
        passwordHint: 'Season + deals',
        isActive: true,
      },
    ];

    const createdLinks = await linkRepository.save([...user1Links, ...user2Links]);
    scenario.links.push(...createdLinks);

    // Create link-tag associations
    const linkTagRepository = this.postgresDataSource.getRepository('LinkTag');
    
    const linkTagAssociations = [
      // User 1 associations
      { linkId: createdLinks[0].id, tagId: createdTags[0].id }, // YouTube video -> YouTube tag
      { linkId: createdLinks[1].id, tagId: createdTags[1].id }, // Blog post -> Blog tag
      { linkId: createdLinks[2].id, tagId: createdTags[2].id }, // Instagram -> Social Media tag
      
      // User 2 associations
      { linkId: createdLinks[3].id, tagId: createdTags[3].id }, // Spring sale -> Campaign A
      { linkId: createdLinks[4].id, tagId: createdTags[4].id }, // Summer deals -> Campaign B
      { linkId: createdLinks[4].id, tagId: createdTags[5].id }, // Summer deals -> Sponsored
    ];

    await linkTagRepository.save(linkTagAssociations);

    // Create bio pages
    const bioPageRepository = this.postgresDataSource.getRepository('BioPage');
    
    const bioPageData1 = {
      username: 'creator123',
      title: 'Content Creator Hub',
      bio: 'Welcome to my content hub! Find all my latest videos, blog posts, and social media here.',
      theme: 'modern',
      backgroundColor: '#1f2937',
      textColor: '#ffffff',
      buttonStyle: 'rounded',
      isPublic: true,
      userId: user1.id,
    };

    const bioPageData2 = {
      username: 'marketer-pro',
      title: 'Digital Marketing Expert',
      bio: 'Discover the latest marketing campaigns and exclusive deals.',
      theme: 'professional',
      backgroundColor: '#ffffff',
      textColor: '#1f2937',
      buttonStyle: 'square',
      isPublic: true,
      userId: user2.id,
    };

    const createdBioPages = await bioPageRepository.save([bioPageData1, bioPageData2]);
    scenario.bioPages.push(...createdBioPages);

    // Create bio links
    const bioLinkRepository = this.postgresDataSource.getRepository('BioLink');
    
    const bioLinksData = [
      // User 1 bio links
      {
        title: 'Latest Video',
        url: `https://short.ly/${createdLinks[0].shortCode}`,
        icon: 'youtube',
        position: 1,
        isActive: true,
        bioPageId: createdBioPages[0].id,
      },
      {
        title: 'Blog Post',
        url: `https://short.ly/${createdLinks[1].shortCode}`,
        icon: 'blog',
        position: 2,
        isActive: true,
        bioPageId: createdBioPages[0].id,
      },
      {
        title: 'Instagram',
        url: `https://short.ly/${createdLinks[2].shortCode}`,
        icon: 'instagram',
        position: 3,
        isActive: true,
        bioPageId: createdBioPages[0].id,
      },
      
      // User 2 bio links
      {
        title: 'Spring Sale',
        url: `https://short.ly/${createdLinks[3].shortCode}`,
        icon: 'shopping',
        position: 1,
        isActive: true,
        bioPageId: createdBioPages[1].id,
      },
      {
        title: 'Summer Deals (VIP)',
        url: `https://short.ly/${createdLinks[4].shortCode}`,
        icon: 'star',
        position: 2,
        isActive: true,
        bioPageId: createdBioPages[1].id,
      },
    ];

    await bioLinkRepository.save(bioLinksData);

    // Create geo-targeting rules
    const geoRuleRepository = this.postgresDataSource.getRepository('GeoRule');
    
    const geoRulesData = [
      // Instagram link geo-targeting
      { linkId: createdLinks[2].id, countryCode: 'US', redirectUrl: 'https://instagram.com/creator?hl=en' },
      { linkId: createdLinks[2].id, countryCode: 'ES', redirectUrl: 'https://instagram.com/creator?hl=es' },
      { linkId: createdLinks[2].id, countryCode: 'FR', redirectUrl: 'https://instagram.com/creator?hl=fr' },
      
      // Spring sale geo-targeting
      { linkId: createdLinks[3].id, countryCode: 'US', redirectUrl: 'https://store.com/spring-sale?region=us' },
      { linkId: createdLinks[3].id, countryCode: 'CA', redirectUrl: 'https://store.com/spring-sale?region=ca' },
      { linkId: createdLinks[3].id, countryCode: 'UK', redirectUrl: 'https://store.com/spring-sale?region=uk' },
    ];

    await geoRuleRepository.save(geoRulesData);

    // Create analytics data in MongoDB
    const clicksCollection = this.mongoConnection.collection('clicks');
    
    const analyticsData = [
      // User 1 analytics
      {
        linkId: createdLinks[0].id,
        userId: user1.id,
        clickedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        ipHash: 'hash1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        browser: 'Chrome',
        device: 'desktop',
        os: 'Windows',
        country: 'US',
        city: 'New York',
        referrer: 'https://bio.ly/creator123',
        utmSource: 'bio-page',
        utmMedium: 'social',
        utmCampaign: 'video-promo',
        isBot: false,
        sessionId: 'session1',
      },
      {
        linkId: createdLinks[1].id,
        userId: user1.id,
        clickedAt: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
        ipHash: 'hash2',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        browser: 'Safari',
        device: 'mobile',
        os: 'iOS',
        country: 'CA',
        city: 'Toronto',
        referrer: 'https://twitter.com',
        isBot: false,
        sessionId: 'session2',
      },
      {
        linkId: createdLinks[2].id,
        userId: user1.id,
        clickedAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6 hours ago
        ipHash: 'hash3',
        userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G975F)',
        browser: 'Chrome',
        device: 'mobile',
        os: 'Android',
        country: 'ES',
        city: 'Madrid',
        referrer: 'https://instagram.com',
        isBot: false,
        sessionId: 'session3',
      },
      
      // User 2 analytics
      {
        linkId: createdLinks[3].id,
        userId: user2.id,
        clickedAt: new Date(Date.now() - 18 * 60 * 60 * 1000), // 18 hours ago
        ipHash: 'hash4',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        browser: 'Safari',
        device: 'desktop',
        os: 'macOS',
        country: 'US',
        city: 'San Francisco',
        referrer: 'https://mail.google.com',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'spring-2024',
        isBot: false,
        sessionId: 'session4',
      },
      {
        linkId: createdLinks[3].id,
        userId: user2.id,
        clickedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        ipHash: 'hash5',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        browser: 'Edge',
        device: 'desktop',
        os: 'Windows',
        country: 'UK',
        city: 'London',
        referrer: 'https://facebook.com',
        utmSource: 'social',
        utmMedium: 'facebook',
        utmCampaign: 'spring-2024',
        isBot: false,
        sessionId: 'session5',
      },
    ];

    await clicksCollection.insertMany(analyticsData);
    scenario.analytics.push(...analyticsData);

    // Create aggregated analytics data
    const aggregationsCollection = this.mongoConnection.collection('analytics_aggregations');
    
    const aggregationData = [
      {
        linkId: createdLinks[0].id,
        userId: user1.id,
        date: new Date(Date.now() - 24 * 60 * 60 * 1000),
        period: 'day',
        totalClicks: 1,
        uniqueClicks: 1,
        deviceBreakdown: { desktop: 1, mobile: 0, tablet: 0 },
        countryBreakdown: { US: 1 },
        browserBreakdown: { Chrome: 1 },
        referrerBreakdown: { 'bio.ly': 1 },
      },
      {
        linkId: createdLinks[3].id,
        userId: user2.id,
        date: new Date(Date.now() - 24 * 60 * 60 * 1000),
        period: 'day',
        totalClicks: 2,
        uniqueClicks: 2,
        deviceBreakdown: { desktop: 2, mobile: 0, tablet: 0 },
        countryBreakdown: { US: 1, UK: 1 },
        browserBreakdown: { Safari: 1, Edge: 1 },
        referrerBreakdown: { 'mail.google.com': 1, 'facebook.com': 1 },
      },
    ];

    await aggregationsCollection.insertMany(aggregationData);

    // Create bio page view analytics
    const bioViewsCollection = this.mongoConnection.collection('bio_page_views');
    
    const bioViewsData = [
      {
        bioPageId: createdBioPages[0].id,
        userId: user1.id,
        viewedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        ipHash: 'hash6',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        browser: 'Safari',
        device: 'mobile',
        os: 'iOS',
        country: 'US',
        city: 'Los Angeles',
        referrer: 'https://instagram.com',
        sessionId: 'session6',
      },
      {
        bioPageId: createdBioPages[1].id,
        userId: user2.id,
        viewedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        ipHash: 'hash7',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        browser: 'Chrome',
        device: 'desktop',
        os: 'Windows',
        country: 'CA',
        city: 'Vancouver',
        referrer: 'https://linkedin.com',
        sessionId: 'session7',
      },
    ];

    await bioViewsCollection.insertMany(bioViewsData);

    return scenario;
  }

  /**
   * Create a high-traffic scenario for performance testing
   */
  async createHighTrafficScenario(): Promise<TestScenario> {
    const scenario: TestScenario = {
      users: [],
      links: [],
      tags: [],
      bioPages: [],
      analytics: [],
    };

    // Create a single user with many links
    const userRepository = this.postgresDataSource.getRepository('User');
    const userData = TestDataFactory.createUser({
      email: 'hightraffic@example.com',
      username: 'hightraffic',
      fullName: 'High Traffic User',
    });

    const user = await userRepository.save(userData);
    scenario.users.push(user);

    // Create many links
    const linkRepository = this.postgresDataSource.getRepository('Link');
    const linksData = Array.from({ length: 100 }, (_, i) => ({
      originalUrl: `https://example${i}.com`,
      title: `Link ${i}`,
      shortCode: `link${i.toString().padStart(3, '0')}`,
      userId: user.id,
      isActive: true,
    }));

    const createdLinks = await linkRepository.save(linksData);
    scenario.links.push(...createdLinks);

    // Create massive analytics data
    const clicksCollection = this.mongoConnection.collection('clicks');
    const analyticsData = [];

    for (const link of createdLinks) {
      // Generate 50-200 clicks per link
      const clickCount = Math.floor(Math.random() * 150) + 50;
      
      for (let i = 0; i < clickCount; i++) {
        const clickTime = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000); // Last 30 days
        
        analyticsData.push({
          linkId: link.id,
          userId: user.id,
          clickedAt: clickTime,
          ipHash: `hash${Math.floor(Math.random() * 10000)}`,
          userAgent: [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
            'Mozilla/5.0 (Linux; Android 10; SM-G975F)',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          ][Math.floor(Math.random() * 4)],
          browser: ['Chrome', 'Safari', 'Firefox', 'Edge'][Math.floor(Math.random() * 4)],
          device: ['desktop', 'mobile', 'tablet'][Math.floor(Math.random() * 3)],
          os: ['Windows', 'iOS', 'Android', 'macOS'][Math.floor(Math.random() * 4)],
          country: ['US', 'UK', 'CA', 'DE', 'FR', 'ES', 'IT', 'JP'][Math.floor(Math.random() * 8)],
          city: ['New York', 'London', 'Toronto', 'Berlin', 'Paris', 'Madrid', 'Rome', 'Tokyo'][Math.floor(Math.random() * 8)],
          referrer: ['https://google.com', 'https://facebook.com', 'https://twitter.com', 'direct'][Math.floor(Math.random() * 4)],
          isBot: Math.random() < 0.05, // 5% bot traffic
          sessionId: `session${Math.floor(Math.random() * 1000)}`,
        });
      }
    }

    // Insert in batches to avoid memory issues
    const batchSize = 1000;
    for (let i = 0; i < analyticsData.length; i += batchSize) {
      const batch = analyticsData.slice(i, i + batchSize);
      await clicksCollection.insertMany(batch);
    }

    scenario.analytics.push(...analyticsData);

    return scenario;
  }

  /**
   * Create a scenario for testing edge cases and error conditions
   */
  async createEdgeCaseScenario(): Promise<TestScenario> {
    const scenario: TestScenario = {
      users: [],
      links: [],
      tags: [],
      bioPages: [],
      analytics: [],
    };

    // Create user
    const userRepository = this.postgresDataSource.getRepository('User');
    const userData = TestDataFactory.createUser({
      email: 'edgecase@example.com',
      username: 'edgecase',
      fullName: 'Edge Case User',
    });

    const user = await userRepository.save(userData);
    scenario.users.push(user);

    // Create links with edge case data
    const linkRepository = this.postgresDataSource.getRepository('Link');
    const edgeCaseLinks = [
      // Very long URL
      {
        originalUrl: 'https://example.com/' + 'a'.repeat(2000),
        title: 'Very Long URL',
        shortCode: 'long01',
        userId: user.id,
        isActive: true,
      },
      // URL with special characters
      {
        originalUrl: 'https://example.com/path?param=value&special=!@#$%^&*()_+{}|:"<>?[]\\;\',./',
        title: 'Special Characters URL',
        shortCode: 'spec01',
        userId: user.id,
        isActive: true,
      },
      // Expired link
      {
        originalUrl: 'https://expired.com',
        title: 'Expired Link',
        shortCode: 'exp001',
        userId: user.id,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Expired yesterday
        isActive: true,
      },
      // Inactive link
      {
        originalUrl: 'https://inactive.com',
        title: 'Inactive Link',
        shortCode: 'inact1',
        userId: user.id,
        isActive: false,
      },
      // Link with all UTM parameters
      {
        originalUrl: 'https://utm-complete.com',
        title: 'Complete UTM Link',
        shortCode: 'utm001',
        userId: user.id,
        utmSource: 'test-source',
        utmMedium: 'test-medium',
        utmCampaign: 'test-campaign',
        utmTerm: 'test-term',
        utmContent: 'test-content',
        isActive: true,
      },
    ];

    const createdLinks = await linkRepository.save(edgeCaseLinks);
    scenario.links.push(...createdLinks);

    // Create tags with edge case names
    const tagRepository = this.postgresDataSource.getRepository('Tag');
    const edgeCaseTags = [
      { name: 'A'.repeat(50), color: '#ff0000', userId: user.id }, // Max length name
      { name: '🚀🎯💡', color: '#00ff00', userId: user.id }, // Emoji name
      { name: 'Special!@#$%', color: '#0000ff', userId: user.id }, // Special characters
      { name: '中文标签', color: '#ffff00', userId: user.id }, // Unicode characters
    ];

    const createdTags = await tagRepository.save(edgeCaseTags);
    scenario.tags.push(...createdTags);

    // Create bio page with edge case data
    const bioPageRepository = this.postgresDataSource.getRepository('BioPage');
    const bioPageData = {
      username: 'edge-case-bio-page-with-very-long-username',
      title: 'Edge Case Bio Page with Very Long Title That Tests Maximum Length Limits',
      bio: 'This is a very long bio description that tests the maximum length limits of the bio field. '.repeat(10),
      theme: 'custom',
      backgroundColor: '#123456',
      textColor: '#fedcba',
      buttonStyle: 'custom',
      isPublic: true,
      userId: user.id,
    };

    const createdBioPage = await bioPageRepository.save(bioPageData);
    scenario.bioPages.push(createdBioPage);

    // Create analytics with edge case data
    const clicksCollection = this.mongoConnection.collection('clicks');
    const edgeCaseAnalytics = [
      // Click with very long user agent
      {
        linkId: createdLinks[0].id,
        userId: user.id,
        clickedAt: new Date(),
        ipHash: 'hash1',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 ' + 'EdgeExtension'.repeat(50),
        browser: 'Chrome',
        device: 'desktop',
        os: 'Windows',
        country: 'US',
        city: 'New York',
        referrer: 'https://very-long-referrer-url.com/' + 'path/'.repeat(100),
        isBot: false,
        sessionId: 'session1',
      },
      // Click with null/undefined values
      {
        linkId: createdLinks[1].id,
        userId: user.id,
        clickedAt: new Date(),
        ipHash: 'hash2',
        userAgent: null,
        browser: null,
        device: 'unknown',
        os: null,
        country: null,
        city: null,
        referrer: null,
        isBot: false,
        sessionId: 'session2',
      },
      // Click with special characters in all fields
      {
        linkId: createdLinks[2].id,
        userId: user.id,
        clickedAt: new Date(),
        ipHash: 'hash3',
        userAgent: 'Special!@#$%^&*()_+{}|:"<>?[]\\;\',./',
        browser: 'Chrome™',
        device: 'mobile📱',
        os: 'iOS🍎',
        country: 'US🇺🇸',
        city: 'New York🗽',
        referrer: 'https://special-chars.com/?param=!@#$%^&*()',
        isBot: false,
        sessionId: 'session3',
      },
    ];

    await clicksCollection.insertMany(edgeCaseAnalytics);
    scenario.analytics.push(...edgeCaseAnalytics);

    return scenario;
  }

  /**
   * Clean up all test data
   */
  async cleanup(): Promise<void> {
    // Clear PostgreSQL tables in correct order (respecting foreign keys)
    const tables = [
      'link_tags',
      'geo_rules',
      'bio_links',
      'bio_pages',
      'links',
      'tags',
      'users',
    ];

    for (const table of tables) {
      await this.postgresDataSource.query(`DELETE FROM ${table}`);
    }

    // Clear MongoDB collections
    const collections = await this.mongoConnection.db.collections();
    for (const collection of collections) {
      await collection.deleteMany({});
    }

    // Clear Redis
    await this.redisClient.flushdb();
  }

  /**
   * Get scenario statistics
   */
  async getScenarioStats(scenario: TestScenario): Promise<any> {
    return {
      users: scenario.users.length,
      links: scenario.links.length,
      tags: scenario.tags.length,
      bioPages: scenario.bioPages.length,
      analyticsEvents: scenario.analytics.length,
      totalClicks: scenario.analytics.length,
      uniqueUsers: new Set(scenario.analytics.map(a => a.userId)).size,
      dateRange: {
        earliest: Math.min(...scenario.analytics.map(a => new Date(a.clickedAt).getTime())),
        latest: Math.max(...scenario.analytics.map(a => new Date(a.clickedAt).getTime())),
      },
      deviceBreakdown: scenario.analytics.reduce((acc, a) => {
        acc[a.device] = (acc[a.device] || 0) + 1;
        return acc;
      }, {}),
      countryBreakdown: scenario.analytics.reduce((acc, a) => {
        if (a.country) {
          acc[a.country] = (acc[a.country] || 0) + 1;
        }
        return acc;
      }, {}),
    };
  }
}