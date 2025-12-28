/**
 * Link Expiration Property-Based Tests
 * Tests universal properties of link expiration lifecycle management
 * 
 * **Feature: backend-modernization, Property 2: Link Expiration Lifecycle Management**
 * **Validates: Requirements 1.2**
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { PropertyTestUtils } from '../property-setup';

interface Link {
  id: string;
  alias: string;
  originalUrl: string;
  userId: string;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  clickCount: number;
}

interface LinkCreationRequest {
  originalUrl: string;
  customAlias?: string;
  userId: string;
  expiresAt?: Date;
  maxClicks?: number;
}

interface LinkAccessResult {
  success: boolean;
  link?: Link;
  reason?: 'expired' | 'max_clicks_reached' | 'not_found' | 'inactive';
}

// Mock link expiration service
class MockLinkExpirationService {
  private links: Map<string, Link> = new Map();
  private aliasIndex: Map<string, string> = new Map(); // alias -> linkId
  private maxClicksMap: Map<string, number> = new Map(); // linkId -> maxClicks

  async createLink(request: LinkCreationRequest): Promise<Link> {
    const alias = request.customAlias || this.generateRandomAlias();
    
    if (this.aliasIndex.has(alias)) {
      throw new Error(`Alias '${alias}' already exists`);
    }

    // Validate expiration date
    if (request.expiresAt && request.expiresAt <= new Date()) {
      throw new Error('Expiration date must be in the future');
    }

    const link: Link = {
      id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      alias,
      originalUrl: request.originalUrl,
      userId: request.userId,
      isActive: true,
      expiresAt: request.expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
      clickCount: 0,
    };

    this.links.set(link.id, link);
    this.aliasIndex.set(alias, link.id);
    
    if (request.maxClicks !== undefined && request.maxClicks > 0) {
      this.maxClicksMap.set(link.id, request.maxClicks);
    }

    return link;
  }

  async accessLink(alias: string): Promise<LinkAccessResult> {
    const linkId = this.aliasIndex.get(alias);
    if (!linkId) {
      return { success: false, reason: 'not_found' };
    }

    const link = this.links.get(linkId);
    if (!link || !link.isActive) {
      return { success: false, reason: 'inactive' };
    }

    // Check expiration
    if (link.expiresAt && new Date() >= link.expiresAt) {
      // Auto-deactivate expired link
      await this.deactivateLink(link.id, 'expired');
      return { success: false, reason: 'expired', link };
    }

    // Check max clicks
    const maxClicks = this.maxClicksMap.get(link.id);
    if (maxClicks !== undefined && link.clickCount >= maxClicks) {
      // Auto-deactivate link that reached max clicks
      await this.deactivateLink(link.id, 'max_clicks_reached');
      return { success: false, reason: 'max_clicks_reached', link };
    }

    // Increment click count
    link.clickCount++;
    link.updatedAt = new Date();
    this.links.set(link.id, link);

    return { success: true, link };
  }

  async getLinkById(linkId: string): Promise<Link | null> {
    return this.links.get(linkId) || null;
  }

  async getLinkByAlias(alias: string): Promise<Link | null> {
    const linkId = this.aliasIndex.get(alias);
    return linkId ? this.links.get(linkId) || null : null;
  }

  async updateLinkExpiration(linkId: string, expiresAt?: Date, maxClicks?: number): Promise<Link> {
    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`Link not found: ${linkId}`);
    }

    if (expiresAt && expiresAt <= new Date()) {
      throw new Error('Expiration date must be in the future');
    }

    const updatedLink: Link = {
      ...link,
      expiresAt,
      updatedAt: new Date(),
    };

    this.links.set(linkId, updatedLink);
    
    if (maxClicks !== undefined) {
      if (maxClicks > 0) {
        this.maxClicksMap.set(linkId, maxClicks);
      } else {
        this.maxClicksMap.delete(linkId);
      }
    }

    return updatedLink;
  }

  async deactivateLink(linkId: string, reason?: string): Promise<boolean> {
    const link = this.links.get(linkId);
    if (!link) {
      return false;
    }

    const updatedLink: Link = {
      ...link,
      isActive: false,
      updatedAt: new Date(),
    };

    this.links.set(linkId, updatedLink);
    return true;
  }

  async cleanupExpiredLinks(): Promise<number> {
    const now = new Date();
    let cleanedCount = 0;

    for (const link of this.links.values()) {
      if (link.isActive && link.expiresAt && now >= link.expiresAt) {
        await this.deactivateLink(link.id, 'expired');
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  async getExpiredLinks(): Promise<Link[]> {
    const now = new Date();
    return Array.from(this.links.values())
      .filter(link => link.expiresAt && now >= link.expiresAt);
  }

  async getLinksExpiringWithin(timeMs: number): Promise<Link[]> {
    const futureTime = new Date(Date.now() + timeMs);
    return Array.from(this.links.values())
      .filter(link => 
        link.isActive && 
        link.expiresAt && 
        link.expiresAt <= futureTime && 
        link.expiresAt > new Date()
      );
  }

  private generateRandomAlias(length: number = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Test utilities
  getAllLinks(): Link[] {
    return Array.from(this.links.values());
  }

  getMaxClicks(linkId: string): number | undefined {
    return this.maxClicksMap.get(linkId);
  }

  clear(): void {
    this.links.clear();
    this.aliasIndex.clear();
    this.maxClicksMap.clear();
  }

  // Simulate time passage for testing
  simulateTimePassage(ms: number): void {
    // This would normally be handled by the system clock
    // For testing, we can manually trigger expiration checks
  }
}

describe('Link Expiration Properties', () => {
  let linkService: MockLinkExpirationService;

  beforeEach(() => {
    linkService = new MockLinkExpirationService();
  });

  afterEach(() => {
    linkService.clear();
  });

  /**
   * Property 2: Link Expiration Lifecycle Management
   * For any link with expiration settings, the lifecycle must be properly managed
   * and access must be denied after expiration conditions are met
   */
  describe('Property 2: Link Expiration Lifecycle Management', () => {
    it('should properly handle time-based expiration', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              originalUrl: fc.webUrl(),
              customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              expirationOffsetMs: fc.option(fc.integer({ min: -3600000, max: 3600000 })), // -1 hour to +1 hour
            }),
            { minLength: 1, maxLength: 20 }
          ),
          async (linkRequests) => {
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();

            // Create links with various expiration times
            for (const request of linkRequests) {
              if (!usedAliases.has(request.customAlias)) {
                try {
                  const expiresAt = request.expirationOffsetMs !== null && request.expirationOffsetMs !== undefined
                    ? new Date(Date.now() + request.expirationOffsetMs)
                    : undefined;

                  // Only create links with future expiration dates
                  if (!expiresAt || expiresAt > new Date()) {
                    const link = await linkService.createLink({
                      originalUrl: request.originalUrl,
                      customAlias: request.customAlias,
                      userId: request.userId,
                      expiresAt,
                    });
                    createdLinks.push(link);
                    usedAliases.add(request.customAlias);
                  }
                } catch (error) {
                  // Expected for past expiration dates or duplicate aliases
                }
              }
            }

            // Test access for each link
            for (const link of createdLinks) {
              const accessResult = await linkService.accessLink(link.alias);

              if (link.expiresAt && new Date() >= link.expiresAt) {
                // Should be expired
                expect(accessResult.success).toBe(false);
                expect(accessResult.reason).toBe('expired');
                
                // Link should be deactivated
                const updatedLink = await linkService.getLinkById(link.id);
                expect(updatedLink?.isActive).toBe(false);
              } else {
                // Should be accessible
                expect(accessResult.success).toBe(true);
                expect(accessResult.link?.clickCount).toBeGreaterThan(0);
              }
            }

            // Test cleanup functionality
            const cleanedCount = await linkService.cleanupExpiredLinks();
            const expiredLinks = await linkService.getExpiredLinks();
            
            // All expired links should be inactive after cleanup
            for (const expiredLink of expiredLinks) {
              expect(expiredLink.isActive).toBe(false);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should properly handle click-based expiration', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              originalUrl: fc.webUrl(),
              customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              maxClicks: fc.option(fc.integer({ min: 1, max: 10 })),
              accessAttempts: fc.integer({ min: 1, max: 15 }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (linkRequests) => {
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();

            // Create links with click limits
            for (const request of linkRequests) {
              if (!usedAliases.has(request.customAlias)) {
                try {
                  const link = await linkService.createLink({
                    originalUrl: request.originalUrl,
                    customAlias: request.customAlias,
                    userId: request.userId,
                    maxClicks: request.maxClicks,
                  });
                  createdLinks.push(link);
                  usedAliases.add(request.customAlias);
                } catch (error) {
                  // Skip duplicate aliases
                }
              }
            }

            // Test access attempts for each link
            for (let i = 0; i < linkRequests.length; i++) {
              const request = linkRequests[i];
              const link = createdLinks.find(l => l.alias === request.customAlias);
              
              if (!link) continue;

              let successfulAccesses = 0;
              let failedAccesses = 0;

              // Attempt multiple accesses
              for (let attempt = 0; attempt < request.accessAttempts; attempt++) {
                const accessResult = await linkService.accessLink(link.alias);
                
                if (accessResult.success) {
                  successfulAccesses++;
                } else {
                  failedAccesses++;
                  
                  if (accessResult.reason === 'max_clicks_reached') {
                    // Verify link is deactivated
                    const updatedLink = await linkService.getLinkById(link.id);
                    expect(updatedLink?.isActive).toBe(false);
                  }
                }
              }

              // Verify click limit enforcement
              if (request.maxClicks !== null && request.maxClicks !== undefined) {
                expect(successfulAccesses).toBeLessThanOrEqual(request.maxClicks);
                
                if (request.accessAttempts > request.maxClicks) {
                  expect(successfulAccesses).toEqual(request.maxClicks);
                  expect(failedAccesses).toBeGreaterThan(0);
                }
              } else {
                // No click limit, all attempts should succeed
                expect(successfulAccesses).toEqual(request.accessAttempts);
                expect(failedAccesses).toEqual(0);
              }

              // Verify final click count
              const finalLink = await linkService.getLinkById(link.id);
              expect(finalLink?.clickCount).toEqual(successfulAccesses);
            }
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should handle combined time and click expiration correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            originalUrl: fc.webUrl(),
            customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            expirationOffsetMs: fc.integer({ min: 100, max: 5000 }), // Short future expiration
            maxClicks: fc.integer({ min: 2, max: 8 }),
            accessAttempts: fc.integer({ min: 1, max: 12 }),
          }),
          async ({ originalUrl, customAlias, userId, expirationOffsetMs, maxClicks, accessAttempts }) => {
            const expiresAt = new Date(Date.now() + expirationOffsetMs);
            
            const link = await linkService.createLink({
              originalUrl,
              customAlias,
              userId,
              expiresAt,
              maxClicks,
            });

            let successfulAccesses = 0;
            let expiredAccesses = 0;
            let maxClicksReached = 0;

            // Attempt accesses with small delays
            for (let attempt = 0; attempt < accessAttempts; attempt++) {
              // Small delay to potentially trigger time expiration
              if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
              }

              const accessResult = await linkService.accessLink(link.alias);
              
              if (accessResult.success) {
                successfulAccesses++;
              } else {
                if (accessResult.reason === 'expired') {
                  expiredAccesses++;
                } else if (accessResult.reason === 'max_clicks_reached') {
                  maxClicksReached++;
                }
              }
            }

            // Verify that either time or click limit was enforced
            expect(successfulAccesses).toBeLessThanOrEqual(maxClicks);
            
            // If we had failures, they should be due to expiration or max clicks
            const totalFailures = expiredAccesses + maxClicksReached;
            expect(successfulAccesses + totalFailures).toEqual(accessAttempts);

            // Verify final link state
            const finalLink = await linkService.getLinkById(link.id);
            expect(finalLink?.clickCount).toEqual(successfulAccesses);
            
            // If link reached max clicks or expired, it should be inactive
            if (maxClicksReached > 0 || expiredAccesses > 0) {
              expect(finalLink?.isActive).toBe(false);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain expiration consistency during updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            initialLinks: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                expirationOffsetMs: fc.option(fc.integer({ min: 1000, max: 10000 })),
                maxClicks: fc.option(fc.integer({ min: 1, max: 5 })),
              }),
              { minLength: 2, maxLength: 8 }
            ),
            updates: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 7 }),
                newExpirationOffsetMs: fc.option(fc.integer({ min: 500, max: 8000 })),
                newMaxClicks: fc.option(fc.integer({ min: 1, max: 10 })),
              }),
              { minLength: 1, maxLength: 4 }
            ),
          }),
          async ({ initialLinks, updates }) => {
            // Create initial links
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();

            for (const linkData of initialLinks) {
              if (!usedAliases.has(linkData.customAlias)) {
                try {
                  const expiresAt = linkData.expirationOffsetMs 
                    ? new Date(Date.now() + linkData.expirationOffsetMs)
                    : undefined;

                  const link = await linkService.createLink({
                    originalUrl: linkData.originalUrl,
                    customAlias: linkData.customAlias,
                    userId: linkData.userId,
                    expiresAt,
                    maxClicks: linkData.maxClicks,
                  });
                  createdLinks.push(link);
                  usedAliases.add(linkData.customAlias);
                } catch (error) {
                  // Skip if creation fails
                }
              }
            }

            if (createdLinks.length === 0) return;

            // Apply updates
            for (const update of updates) {
              const linkIndex = update.linkIndex % createdLinks.length;
              const targetLink = createdLinks[linkIndex];

              try {
                const newExpiresAt = update.newExpirationOffsetMs
                  ? new Date(Date.now() + update.newExpirationOffsetMs)
                  : undefined;

                const updatedLink = await linkService.updateLinkExpiration(
                  targetLink.id,
                  newExpiresAt,
                  update.newMaxClicks
                );

                // Verify update properties
                expect(updatedLink.id).toEqual(targetLink.id);
                expect(updatedLink.expiresAt).toEqual(newExpiresAt);
                expect(updatedLink.updatedAt.getTime()).toBeGreaterThan(targetLink.updatedAt.getTime());

                // Update our tracking
                createdLinks[linkIndex] = updatedLink;

                // Verify max clicks update
                if (update.newMaxClicks !== null && update.newMaxClicks !== undefined) {
                  const maxClicks = linkService.getMaxClicks(targetLink.id);
                  expect(maxClicks).toEqual(update.newMaxClicks);
                }

              } catch (error) {
                // Expected for invalid expiration dates
                if (update.newExpirationOffsetMs && update.newExpirationOffsetMs <= 0) {
                  expect(error.message).toContain('must be in the future');
                }
              }
            }

            // Verify final state consistency
            for (const link of createdLinks) {
              const currentLink = await linkService.getLinkById(link.id);
              expect(currentLink).toBeTruthy();
              
              // Test access to verify expiration logic still works
              const accessResult = await linkService.accessLink(link.alias);
              
              if (currentLink?.expiresAt && new Date() >= currentLink.expiresAt) {
                expect(accessResult.success).toBe(false);
                expect(accessResult.reason).toBe('expired');
              } else if (currentLink?.isActive) {
                // Should be accessible if not expired and active
                expect(accessResult.success).toBe(true);
              }
            }
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should correctly identify links expiring within time windows', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            links: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                expirationOffsetMs: fc.integer({ min: -5000, max: 15000 }), // Some past, some future
              }),
              { minLength: 3, maxLength: 12 }
            ),
            queryWindowMs: fc.integer({ min: 1000, max: 10000 }),
          }),
          async ({ links, queryWindowMs }) => {
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();
            const now = new Date();

            // Create links with various expiration times
            for (const linkData of links) {
              if (!usedAliases.has(linkData.customAlias)) {
                const expiresAt = new Date(now.getTime() + linkData.expirationOffsetMs);
                
                // Only create links with future expiration
                if (expiresAt > now) {
                  try {
                    const link = await linkService.createLink({
                      originalUrl: linkData.originalUrl,
                      customAlias: linkData.customAlias,
                      userId: linkData.userId,
                      expiresAt,
                    });
                    createdLinks.push(link);
                    usedAliases.add(linkData.customAlias);
                  } catch (error) {
                    // Skip if creation fails
                  }
                }
              }
            }

            if (createdLinks.length === 0) return;

            // Query for links expiring within the time window
            const expiringLinks = await linkService.getLinksExpiringWithin(queryWindowMs);
            const queryTime = new Date(Date.now() + queryWindowMs);

            // Verify results
            for (const link of expiringLinks) {
              expect(link.isActive).toBe(true);
              expect(link.expiresAt).toBeTruthy();
              expect(link.expiresAt!.getTime()).toBeLessThanOrEqual(queryTime.getTime());
              expect(link.expiresAt!.getTime()).toBeGreaterThan(Date.now());
            }

            // Verify no links are missed
            for (const link of createdLinks) {
              if (link.isActive && link.expiresAt && 
                  link.expiresAt <= queryTime && 
                  link.expiresAt > new Date()) {
                expect(expiringLinks).toContainEqual(link);
              }
            }

            // Test expired links query
            const expiredLinks = await linkService.getExpiredLinks();
            for (const expiredLink of expiredLinks) {
              expect(expiredLink.expiresAt).toBeTruthy();
              expect(expiredLink.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now());
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});