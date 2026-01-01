/**
 * Comprehensive Test Data Factory
 * Provides realistic data generators for all entity types and property-based testing
 */

import * as fc from 'fast-check';
import { User, UserRole } from '../../src/modules/users/entities/user.entity';
import { Link } from '../../src/modules/urls/entities/link.entity';
import { BioPage } from '../../src/modules/bio-pages/entities/bio-page.entity';
import { BioLink } from '../../src/modules/bio-pages/entities/bio-link.entity';
import { Tag } from '../../src/modules/urls/entities/tag.entity';
import { RefreshToken } from '../../src/modules/users/entities/refresh-token.entity';
import { AdminUser } from '../../src/modules/users/entities/admin-user.entity';
import { AuditLog } from '../../src/modules/users/entities/audit-log.entity';
import { GeoRule } from '../../src/modules/urls/entities/geo-rule.entity';
import { LinkTag } from '../../src/modules/urls/entities/link-tag.entity';
import { CustomDomain } from '../../src/modules/users/entities/custom-domain.entity';

export interface TestDataOptions {
  realistic: boolean;
  includeOptionalFields: boolean;
  generateRelations: boolean;
  useFixedSeed: boolean;
  seed?: number;
}

export interface AnalyticsTestData {
  linkId: string;
  userId: string;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  referer?: string;
  country?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
}

export class TestDataFactory {
  private static instance: TestDataFactory;
  private options: TestDataOptions;
  private counter = 0;

  constructor(options: TestDataOptions = {
    realistic: true,
    includeOptionalFields: true,
    generateRelations: false,
    useFixedSeed: false,
  }) {
    this.options = options;
    if (options.useFixedSeed && options.seed) {
      // Set seed for reproducible tests
      Math.random = this.seededRandom(options.seed);
    }
  }

  static getInstance(options?: TestDataOptions): TestDataFactory {
    if (!TestDataFactory.instance) {
      TestDataFactory.instance = new TestDataFactory(options);
    }
    return TestDataFactory.instance;
  }

  /**
   * Create a test User entity
   */
  createUser(overrides: Partial<User> = {}): Partial<User> {
    const id = this.generateId();
    const timestamp = new Date();

    const baseUser: Partial<User> = {
      id,
      email: this.generateEmail(),
      passwordHash: this.generatePasswordHash(),
      name: this.generateFullName(),
      isEmailVerified: this.options.realistic ? Math.random() > 0.3 : true,
      role: this.options.realistic ? this.generateUserRole() : UserRole.USER,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (this.options.includeOptionalFields) {
      baseUser.emailVerificationToken = Math.random() > 0.7 ? this.generateToken() : undefined;
      baseUser.passwordResetToken = Math.random() > 0.9 ? this.generateToken() : undefined;
      baseUser.passwordResetExpires = baseUser.passwordResetToken ? 
        new Date(Date.now() + 3600000) : undefined;
      baseUser.lastLoginAt = Math.random() > 0.5 ? 
        new Date(Date.now() - Math.random() * 86400000 * 30) : undefined;
      baseUser.lastLoginIp = baseUser.lastLoginAt ? this.generateIpAddress() : undefined;
    }

    return { ...baseUser, ...overrides };
  }

  /**
   * Create a test Link entity
   */
  createLink(overrides: Partial<Link> = {}): Partial<Link> {
    const id = this.generateId();
    const timestamp = new Date();

    const baseLink: Partial<Link> = {
      id,
      userId: overrides.userId || this.generateId(),
      originalUrl: this.generateUrl(),
      shortCode: this.generateShortCode(),
      title: this.options.realistic ? this.generateLinkTitle() : 'Test Link',
      isActive: this.options.realistic ? Math.random() > 0.1 : true,
      visitCount: this.options.realistic ? Math.floor(Math.random() * 1000) : 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (this.options.includeOptionalFields) {
      baseLink.customAlias = Math.random() > 0.8 ? this.generateCustomAlias() : undefined;
      baseLink.expiresAt = Math.random() > 0.9 ? 
        new Date(Date.now() + Math.random() * 86400000 * 365) : undefined;
      baseLink.passwordHash = Math.random() > 0.95 ? this.generatePasswordHash() : undefined;
      baseLink.passwordHint = baseLink.passwordHash ? 'Test password hint' : undefined;
      
      // UTM parameters
      if (Math.random() > 0.7) {
        baseLink.utmSource = this.generateUtmParameter();
        baseLink.utmMedium = this.generateUtmParameter();
        baseLink.utmCampaign = this.generateUtmParameter();
      }

      // Device-specific URLs
      if (Math.random() > 0.8) {
        baseLink.iosUrl = this.generateUrl('ios');
        baseLink.androidUrl = this.generateUrl('android');
      }

      // Analytics IDs
      if (Math.random() > 0.9) {
        baseLink.metaPixelId = this.generateAnalyticsId();
        baseLink.googleAnalyticsId = this.generateAnalyticsId();
        baseLink.tiktokPixelId = this.generateAnalyticsId();
      }
    }

    return { ...baseLink, ...overrides };
  }

  /**
   * Create a test BioPage entity
   */
  createBioPage(overrides: Partial<BioPage> = {}): Partial<BioPage> {
    const id = this.generateId();
    const timestamp = new Date();

    const baseBioPage: Partial<BioPage> = {
      id,
      userId: overrides.userId || this.generateId(),
      username: this.generateUsername(),
      title: this.options.realistic ? this.generateBioTitle() : 'Test Bio',
      bio: this.options.realistic ? this.generateBioDescription() : 'Test bio description',
      theme: this.generateBioTheme(),
      backgroundColor: this.generateColor(),
      textColor: this.generateColor(),
      buttonStyle: this.generateButtonStyle(),
      isPublic: this.options.realistic ? Math.random() > 0.2 : true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (this.options.includeOptionalFields) {
      baseBioPage.avatarUrl = Math.random() > 0.6 ? this.generateAvatarUrl() : undefined;
    }

    return { ...baseBioPage, ...overrides };
  }

  /**
   * Create a test BioLink entity
   */
  createBioLink(overrides: Partial<BioLink> = {}): Partial<BioLink> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      bioPageId: overrides.bioPageId || this.generateId(),
      title: this.options.realistic ? this.generateLinkTitle() : 'Test Bio Link',
      url: this.generateUrl(),
      displayOrder: Math.floor(Math.random() * 10),
      isActive: this.options.realistic ? Math.random() > 0.1 : true,
      clickCount: this.options.realistic ? Math.floor(Math.random() * 100) : 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test Tag entity
   */
  createTag(overrides: Partial<Tag> = {}): Partial<Tag> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      name: this.generateTagName(),
      color: this.generateColor(),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test RefreshToken entity
   */
  createRefreshToken(overrides: Partial<RefreshToken> = {}): Partial<RefreshToken> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      token: this.generateToken(64),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test AdminUser entity
   */
  createAdminUser(overrides: Partial<AdminUser> = {}): Partial<AdminUser> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      permissions: ['read', 'write', 'delete'],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test AuditLog entity
   */
  createAuditLog(overrides: Partial<AuditLog> = {}): Partial<AuditLog> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      action: this.generateAuditAction(),
      entityType: this.generateEntityType(),
      entityId: this.generateId(),
      oldValues: this.options.realistic ? { field: 'old_value' } : undefined,
      newValues: this.options.realistic ? { field: 'new_value' } : undefined,
      ipAddress: this.generateIpAddress(),
      userAgent: this.generateUserAgent(),
      createdAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test GeoRule entity
   */
  createGeoRule(overrides: Partial<GeoRule> = {}): Partial<GeoRule> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      linkId: overrides.linkId || this.generateId(),
      country: this.generateCountryCode(),
      redirectUrl: this.generateUrl(),
      isActive: this.options.realistic ? Math.random() > 0.1 : true,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test LinkTag entity
   */
  createLinkTag(overrides: Partial<LinkTag> = {}): Partial<LinkTag> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      linkId: overrides.linkId || this.generateId(),
      tagId: overrides.tagId || this.generateId(),
      createdAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create a test CustomDomain entity
   */
  createCustomDomain(overrides: Partial<CustomDomain> = {}): Partial<CustomDomain> {
    const id = this.generateId();
    const timestamp = new Date();

    return {
      id,
      userId: overrides.userId || this.generateId(),
      domain: this.generateDomain(),
      isVerified: this.options.realistic ? Math.random() > 0.3 : true,
      verificationToken: this.generateToken(),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  /**
   * Create test analytics data
   */
  createAnalyticsData(overrides: Partial<AnalyticsTestData> = {}): AnalyticsTestData {
    return {
      linkId: this.generateId(),
      userId: this.generateId(),
      timestamp: new Date(Date.now() - Math.random() * 86400000 * 30), // Last 30 days
      ipAddress: this.generateIpAddress(),
      userAgent: this.generateUserAgent(),
      referer: Math.random() > 0.5 ? this.generateUrl() : undefined,
      country: Math.random() > 0.3 ? this.generateCountryCode() : undefined,
      city: Math.random() > 0.5 ? this.generateCityName() : undefined,
      device: Math.random() > 0.4 ? this.generateDeviceType() : undefined,
      browser: Math.random() > 0.4 ? this.generateBrowserName() : undefined,
      os: Math.random() > 0.4 ? this.generateOSName() : undefined,
      ...overrides,
    };
  }

  /**
   * Create multiple entities of the same type
   */
  createMultiple<T>(
    createFn: (overrides?: any) => T,
    count: number,
    overrides: any = {}
  ): T[] {
    return Array.from({ length: count }, () => createFn(overrides));
  }

  /**
   * Create a complete user with related entities
   */
  createUserWithRelations(userOverrides: Partial<User> = {}): {
    user: Partial<User>;
    links: Partial<Link>[];
    bioPage?: Partial<BioPage>;
    tags: Partial<Tag>[];
    refreshTokens: Partial<RefreshToken>[];
  } {
    const user = this.createUser(userOverrides);
    const linkCount = Math.floor(Math.random() * 5) + 1;
    const tagCount = Math.floor(Math.random() * 3) + 1;

    return {
      user,
      links: this.createMultiple(() => this.createLink({ userId: user.id }), linkCount),
      bioPage: Math.random() > 0.5 ? this.createBioPage({ userId: user.id }) : undefined,
      tags: this.createMultiple(() => this.createTag({ userId: user.id }), tagCount),
      refreshTokens: this.createMultiple(() => this.createRefreshToken({ userId: user.id }), 1),
    };
  }

  // Property-based testing generators

  /**
   * Fast-check generator for User entities
   */
  static userGenerator(): fc.Arbitrary<Partial<User>> {
    return fc.record({
      email: fc.emailAddress(),
      passwordHash: fc.string({ minLength: 60, maxLength: 60 }),
      name: fc.string({ minLength: 2, maxLength: 100 }),
      isEmailVerified: fc.boolean(),
      role: fc.constantFrom(...Object.values(UserRole)),
    });
  }

  /**
   * Fast-check generator for Link entities
   */
  static linkGenerator(): fc.Arbitrary<Partial<Link>> {
    return fc.record({
      originalUrl: fc.webUrl(),
      shortCode: fc.string({ minLength: 6, maxLength: 12 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
      title: fc.string({ minLength: 1, maxLength: 200 }),
      isActive: fc.boolean(),
      visitCount: fc.nat({ max: 10000 }),
    });
  }

  /**
   * Fast-check generator for BioPage entities
   */
  static bioPageGenerator(): fc.Arbitrary<Partial<BioPage>> {
    return fc.record({
      username: fc.string({ minLength: 3, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      bio: fc.string({ minLength: 0, maxLength: 1000 }),
      theme: fc.constantFrom('default', 'dark', 'light', 'colorful', 'minimal'),
      backgroundColor: fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`),
      textColor: fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`),
      buttonStyle: fc.constantFrom('rounded', 'square', 'pill'),
      isPublic: fc.boolean(),
    });
  }

  /**
   * Fast-check generator for analytics data
   */
  static analyticsGenerator(): fc.Arbitrary<AnalyticsTestData> {
    return fc.record({
      linkId: fc.uuid(),
      userId: fc.uuid(),
      timestamp: fc.date({ min: new Date('2020-01-01'), max: new Date() }),
      ipAddress: fc.ipV4(),
      userAgent: fc.constantFrom(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
      ),
      referer: fc.option(fc.webUrl(), { nil: undefined }),
      country: fc.option(fc.constantFrom('US', 'GB', 'CA', 'AU', 'DE', 'FR'), { nil: undefined }),
      city: fc.option(fc.constantFrom('New York', 'London', 'Toronto', 'Sydney'), { nil: undefined }),
      device: fc.option(fc.constantFrom('desktop', 'mobile', 'tablet'), { nil: undefined }),
      browser: fc.option(fc.constantFrom('Chrome', 'Firefox', 'Safari', 'Edge'), { nil: undefined }),
      os: fc.option(fc.constantFrom('Windows', 'macOS', 'Linux', 'iOS', 'Android'), { nil: undefined }),
    });
  }

  // Private helper methods for data generation

  private generateId(): string {
    return `test-${Date.now()}-${this.counter++}-${Math.random().toString(36).substring(7)}`;
  }

  private generateEmail(): string {
    const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];
    const username = `user${this.counter++}${Math.random().toString(36).substring(7)}`;
    const domain = domains[Math.floor(Math.random() * domains.length)];
    return `${username}@${domain}`;
  }

  private generatePasswordHash(): string {
    // Simulate bcrypt hash
    return '$2b$10$' + Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  private generateFullName(): string {
    const firstNames = ['John', 'Jane', 'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    return `${firstName} ${lastName}`;
  }

  private generateUserRole(): UserRole {
    const roles = Object.values(UserRole);
    // Weight towards USER role (80% chance)
    if (Math.random() < 0.8) return UserRole.USER;
    return roles[Math.floor(Math.random() * roles.length)];
  }

  private generateUrl(type?: string): string {
    const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];
    const paths = ['', '/page', '/article', '/product', '/service'];
    
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const path = paths[Math.floor(Math.random() * paths.length)];
    
    if (type === 'ios') {
      return `https://apps.apple.com/app/id${Math.floor(Math.random() * 1000000)}`;
    } else if (type === 'android') {
      return `https://play.google.com/store/apps/details?id=com.${domain.split('.')[0]}.app`;
    }
    
    return `https://${domain}${path}`;
  }

  private generateShortCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private generateCustomAlias(): string {
    const words = ['test', 'demo', 'sample', 'example', 'custom'];
    return words[Math.floor(Math.random() * words.length)] + Math.floor(Math.random() * 1000);
  }

  private generateLinkTitle(): string {
    const titles = [
      'Amazing Product Launch',
      'Latest News Update',
      'Special Offer Available',
      'Important Announcement',
      'New Feature Release',
      'Company Blog Post',
      'Event Registration',
      'Download Our App',
    ];
    return titles[Math.floor(Math.random() * titles.length)];
  }

  private generateUsername(): string {
    const adjectives = ['cool', 'awesome', 'super', 'mega', 'ultra'];
    const nouns = ['user', 'person', 'creator', 'maker', 'builder'];
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adj}${noun}${Math.floor(Math.random() * 1000)}`;
  }

  private generateBioTitle(): string {
    const titles = [
      'Welcome to my page!',
      'Check out my links',
      'My awesome bio',
      'Connect with me',
      'Find me everywhere',
    ];
    return titles[Math.floor(Math.random() * titles.length)];
  }

  private generateBioDescription(): string {
    const descriptions = [
      'This is my bio page where you can find all my important links.',
      'Welcome! Here are all the places you can connect with me online.',
      'Check out my latest projects and social media profiles.',
      'Find all my content and ways to get in touch.',
    ];
    return descriptions[Math.floor(Math.random() * descriptions.length)];
  }

  private generateBioTheme(): string {
    const themes = ['default', 'dark', 'light', 'colorful', 'minimal'];
    return themes[Math.floor(Math.random() * themes.length)];
  }

  private generateColor(): string {
    const colors = ['#ffffff', '#000000', '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private generateButtonStyle(): string {
    const styles = ['rounded', 'square', 'pill'];
    return styles[Math.floor(Math.random() * styles.length)];
  }

  private generateAvatarUrl(): string {
    return `https://avatar.example.com/${Math.random().toString(36).substring(7)}.jpg`;
  }

  private generateTagName(): string {
    const tags = ['work', 'personal', 'social', 'business', 'project', 'important', 'archive'];
    return tags[Math.floor(Math.random() * tags.length)];
  }

  private generateToken(length = 32): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private generateIpAddress(): string {
    return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  }

  private generateUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private generateUtmParameter(): string {
    const params = ['google', 'facebook', 'twitter', 'email', 'direct', 'organic'];
    return params[Math.floor(Math.random() * params.length)];
  }

  private generateAnalyticsId(): string {
    return `GA-${Math.floor(Math.random() * 1000000)}-${Math.floor(Math.random() * 10)}`;
  }

  private generateAuditAction(): string {
    const actions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'RESET_PASSWORD'];
    return actions[Math.floor(Math.random() * actions.length)];
  }

  private generateEntityType(): string {
    const types = ['User', 'Link', 'BioPage', 'Tag', 'CustomDomain'];
    return types[Math.floor(Math.random() * types.length)];
  }

  private generateCountryCode(): string {
    const codes = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX'];
    return codes[Math.floor(Math.random() * codes.length)];
  }

  private generateCityName(): string {
    const cities = ['New York', 'London', 'Toronto', 'Sydney', 'Berlin', 'Paris', 'Tokyo', 'São Paulo'];
    return cities[Math.floor(Math.random() * cities.length)];
  }

  private generateDeviceType(): string {
    const devices = ['desktop', 'mobile', 'tablet'];
    return devices[Math.floor(Math.random() * devices.length)];
  }

  private generateBrowserName(): string {
    const browsers = ['Chrome', 'Firefox', 'Safari', 'Edge', 'Opera'];
    return browsers[Math.floor(Math.random() * browsers.length)];
  }

  private generateOSName(): string {
    const oses = ['Windows', 'macOS', 'Linux', 'iOS', 'Android'];
    return oses[Math.floor(Math.random() * oses.length)];
  }

  private generateDomain(): string {
    const domains = ['example.com', 'test.org', 'demo.net', 'custom.io'];
    return domains[Math.floor(Math.random() * domains.length)];
  }

  private seededRandom(seed: number): () => number {
    let x = Math.sin(seed) * 10000;
    return () => {
      x = Math.sin(x) * 10000;
      return x - Math.floor(x);
    };
  }
}

// Export singleton instance for global use
export const testDataFactory = TestDataFactory.getInstance();