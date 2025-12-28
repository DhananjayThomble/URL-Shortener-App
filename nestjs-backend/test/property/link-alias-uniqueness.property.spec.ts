/**
 * Link Alias Uniqueness Property-Based Tests
 * Tests universal properties of link alias uniqueness and validation
 * 
 * **Feature: backend-modernization, Property 1: Link Alias Uniqueness and Validation**
 * **Validates: Requirements 1.1**
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
  createdAt: Date;
  updatedAt: Date;
}

interface LinkCreationRequest {
  originalUrl: string;
  customAlias?: string;
  userId: string;
}

// Mock link service
class MockLinkService {
  private links: Map<string, Link> = new Map();
  private aliasIndex: Set<string> = new Set();
  private userLinkCounts: Map<string, number> = new Map();

  async createLink(request: LinkCreationRequest): Promise<Link> {
    const alias = request.customAlias || this.generateRandomAlias();
    
    // Check alias uniqueness
    if (this.aliasIndex.has(alias)) {
      throw new Error(`Alias '${alias}' already exists`);
    }

    // Validate alias format
    if (!this.isValidAlias(alias)) {
      throw new Error(`Invalid alias format: '${alias}'`);
    }

    // Validate URL format
    if (!this.isValidUrl(request.originalUrl)) {
      throw new Error(`Invalid URL format: '${request.originalUrl}'`);
    }

    const link: Link = {
      id: `link_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
      alias,
      originalUrl: request.originalUrl,
      userId: request.userId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.links.set(link.id, link);
    this.aliasIndex.add(alias);
    
    // Update user link count
    const currentCount = this.userLinkCounts.get(request.userId) || 0;
    this.userLinkCounts.set(request.userId, currentCount + 1);

    return link;
  }

  async getLinkByAlias(alias: string): Promise<Link | null> {
    for (const link of this.links.values()) {
      if (link.alias === alias && link.isActive) {
        return link;
      }
    }
    return null;
  }

  async getLinksByUser(userId: string): Promise<Link[]> {
    return Array.from(this.links.values())
      .filter(link => link.userId === userId && link.isActive)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateLink(linkId: string, updates: Partial<Pick<Link, 'originalUrl' | 'alias' | 'isActive'>>): Promise<Link> {
    const link = this.links.get(linkId);
    if (!link) {
      throw new Error(`Link not found: ${linkId}`);
    }

    // If updating alias, check uniqueness
    if (updates.alias && updates.alias !== link.alias) {
      if (this.aliasIndex.has(updates.alias)) {
        throw new Error(`Alias '${updates.alias}' already exists`);
      }
      if (!this.isValidAlias(updates.alias)) {
        throw new Error(`Invalid alias format: '${updates.alias}'`);
      }
      
      // Remove old alias and add new one
      this.aliasIndex.delete(link.alias);
      this.aliasIndex.add(updates.alias);
    }

    // If updating URL, validate format
    if (updates.originalUrl && !this.isValidUrl(updates.originalUrl)) {
      throw new Error(`Invalid URL format: '${updates.originalUrl}'`);
    }

    const updatedLink: Link = {
      ...link,
      ...updates,
      updatedAt: new Date(),
    };

    this.links.set(linkId, updatedLink);
    return updatedLink;
  }

  async deleteLink(linkId: string): Promise<boolean> {
    const link = this.links.get(linkId);
    if (!link) {
      return false;
    }

    // Remove from alias index
    this.aliasIndex.delete(link.alias);
    
    // Update user link count
    const currentCount = this.userLinkCounts.get(link.userId) || 0;
    this.userLinkCounts.set(link.userId, Math.max(0, currentCount - 1));

    return this.links.delete(linkId);
  }

  async isAliasAvailable(alias: string): Promise<boolean> {
    return !this.aliasIndex.has(alias) && this.isValidAlias(alias);
  }

  private generateRandomAlias(length: number = 8): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private isValidAlias(alias: string): boolean {
    // Alias must be 3-50 characters, alphanumeric plus hyphens and underscores
    const aliasRegex = /^[a-zA-Z0-9_-]{3,50}$/;
    return aliasRegex.test(alias);
  }

  private isValidUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch {
      return false;
    }
  }

  // Test utilities
  getAllLinks(): Link[] {
    return Array.from(this.links.values());
  }

  getAllAliases(): string[] {
    return Array.from(this.aliasIndex);
  }

  getUserLinkCount(userId: string): number {
    return this.userLinkCounts.get(userId) || 0;
  }

  clear(): void {
    this.links.clear();
    this.aliasIndex.clear();
    this.userLinkCounts.clear();
  }
}

describe('Link Alias Uniqueness Properties', () => {
  let linkService: MockLinkService;

  beforeEach(() => {
    linkService = new MockLinkService();
  });

  afterEach(() => {
    linkService.clear();
  });

  /**
   * Property 1: Link Alias Uniqueness and Validation
   * For any set of link creation operations, aliases must remain unique
   * and validation rules must be consistently enforced
   */
  describe('Property 1: Link Alias Uniqueness and Validation', () => {
    it('should maintain alias uniqueness across all link operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              originalUrl: fc.webUrl(),
              customAlias: fc.option(fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          async (linkRequests) => {
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();
            const expectedFailures = new Set<string>();

            for (const request of linkRequests) {
              try {
                const link = await linkService.createLink(request);
                createdLinks.push(link);
                
                // Verify alias uniqueness
                expect(usedAliases.has(link.alias)).toBe(false);
                usedAliases.add(link.alias);
                
                // Verify link properties
                expect(link.id).toBeDefined();
                expect(link.alias).toBeDefined();
                expect(link.originalUrl).toEqual(request.originalUrl);
                expect(link.userId).toEqual(request.userId);
                expect(link.isActive).toBe(true);
                expect(link.createdAt).toBeInstanceOf(Date);
                expect(link.updatedAt).toBeInstanceOf(Date);
                
                // Verify alias format
                expect(link.alias).toMatch(/^[a-zA-Z0-9_-]{3,50}$/);
                
              } catch (error) {
                // Expected failures for duplicate aliases or invalid formats
                if (request.customAlias) {
                  if (usedAliases.has(request.customAlias) || !/^[a-zA-Z0-9_-]{3,50}$/.test(request.customAlias)) {
                    expectedFailures.add(request.customAlias);
                  }
                }
              }
            }

            // Verify all created links have unique aliases
            const allAliases = createdLinks.map(link => link.alias);
            const uniqueAliases = new Set(allAliases);
            expect(uniqueAliases.size).toEqual(allAliases.length);

            // Verify service state consistency
            const serviceAliases = linkService.getAllAliases();
            expect(serviceAliases.length).toEqual(createdLinks.length);
            expect(new Set(serviceAliases)).toEqual(new Set(allAliases));
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should enforce alias validation rules consistently', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validAliases: fc.array(
              fc.string({ minLength: 3, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
              { minLength: 1, maxLength: 10 }
            ),
            invalidAliases: fc.array(
              fc.oneof(
                fc.string({ minLength: 1, maxLength: 2 }), // Too short
                fc.string({ minLength: 51, maxLength: 100 }), // Too long
                fc.string().filter(s => /[^a-zA-Z0-9_-]/.test(s) && s.length >= 3 && s.length <= 50), // Invalid characters
              ),
              { minLength: 1, maxLength: 10 }
            ),
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
          }),
          async ({ validAliases, invalidAliases, userId, originalUrl }) => {
            // Test valid aliases
            const createdLinks: Link[] = [];
            for (const alias of validAliases) {
              try {
                const link = await linkService.createLink({
                  originalUrl,
                  customAlias: alias,
                  userId,
                });
                createdLinks.push(link);
                expect(link.alias).toEqual(alias);
              } catch (error) {
                // Only acceptable if alias was already used
                const existingLink = await linkService.getLinkByAlias(alias);
                expect(existingLink).toBeTruthy();
              }
            }

            // Test invalid aliases
            for (const alias of invalidAliases) {
              await expect(linkService.createLink({
                originalUrl,
                customAlias: alias,
                userId,
              })).rejects.toThrow();
            }

            // Verify alias availability check consistency
            for (const link of createdLinks) {
              const isAvailable = await linkService.isAliasAvailable(link.alias);
              expect(isAvailable).toBe(false);
            }

            for (const alias of invalidAliases) {
              const isAvailable = await linkService.isAliasAvailable(alias);
              expect(isAvailable).toBe(false); // Invalid format should return false
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should maintain consistency during link updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            initialLinks: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                customAlias: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
              }),
              { minLength: 2, maxLength: 10 }
            ),
            updates: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 9 }),
                newAlias: fc.option(fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s))),
                newUrl: fc.option(fc.webUrl()),
              }),
              { minLength: 1, maxLength: 5 }
            ),
          }),
          async ({ initialLinks, updates }) => {
            // Create initial links with unique aliases
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();
            
            for (const linkData of initialLinks) {
              if (!usedAliases.has(linkData.customAlias)) {
                try {
                  const link = await linkService.createLink(linkData);
                  createdLinks.push(link);
                  usedAliases.add(link.alias);
                } catch (error) {
                  // Skip if creation fails
                }
              }
            }

            if (createdLinks.length === 0) return; // Skip if no links created

            // Apply updates
            for (const update of updates) {
              const linkIndex = update.linkIndex % createdLinks.length;
              const targetLink = createdLinks[linkIndex];

              try {
                const updateData: any = {};
                if (update.newUrl) updateData.originalUrl = update.newUrl;
                if (update.newAlias) updateData.alias = update.newAlias;

                const updatedLink = await linkService.updateLink(targetLink.id, updateData);
                
                // Update our tracking
                if (update.newAlias && update.newAlias !== targetLink.alias) {
                  usedAliases.delete(targetLink.alias);
                  usedAliases.add(update.newAlias);
                  createdLinks[linkIndex] = updatedLink;
                }
                
                // Verify update properties
                expect(updatedLink.id).toEqual(targetLink.id);
                expect(updatedLink.userId).toEqual(targetLink.userId);
                expect(updatedLink.updatedAt.getTime()).toBeGreaterThan(targetLink.updatedAt.getTime());
                
              } catch (error) {
                // Expected failures for duplicate aliases
                if (update.newAlias && usedAliases.has(update.newAlias)) {
                  expect(error.message).toContain('already exists');
                }
              }
            }

            // Verify final state consistency
            const finalAliases = linkService.getAllAliases();
            const finalLinks = linkService.getAllLinks().filter(link => link.isActive);
            
            expect(finalAliases.length).toEqual(finalLinks.length);
            expect(new Set(finalAliases).size).toEqual(finalAliases.length); // All unique
            
            // Verify each link can be retrieved by its alias
            for (const link of finalLinks) {
              const retrievedLink = await linkService.getLinkByAlias(link.alias);
              expect(retrievedLink).toBeTruthy();
              expect(retrievedLink!.id).toEqual(link.id);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain consistency during link deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            linksToCreate: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                customAlias: fc.string({ minLength: 3, maxLength: 15 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
              }),
              { minLength: 3, maxLength: 15 }
            ),
            deletionIndices: fc.array(fc.integer({ min: 0, max: 14 }), { minLength: 1, maxLength: 5 }),
          }),
          async ({ linksToCreate, deletionIndices }) => {
            // Create links with unique aliases
            const createdLinks: Link[] = [];
            const usedAliases = new Set<string>();
            
            for (const linkData of linksToCreate) {
              if (!usedAliases.has(linkData.customAlias)) {
                try {
                  const link = await linkService.createLink(linkData);
                  createdLinks.push(link);
                  usedAliases.add(link.alias);
                } catch (error) {
                  // Skip if creation fails
                }
              }
            }

            if (createdLinks.length === 0) return; // Skip if no links created

            const initialCount = createdLinks.length;
            const deletedAliases = new Set<string>();

            // Delete some links
            for (const index of deletionIndices) {
              const linkIndex = index % createdLinks.length;
              const linkToDelete = createdLinks[linkIndex];
              
              if (!deletedAliases.has(linkToDelete.alias)) {
                const deleted = await linkService.deleteLink(linkToDelete.id);
                expect(deleted).toBe(true);
                deletedAliases.add(linkToDelete.alias);
                
                // Verify link is no longer retrievable
                const retrievedLink = await linkService.getLinkByAlias(linkToDelete.alias);
                expect(retrievedLink).toBeNull();
              }
            }

            // Verify final state
            const remainingLinks = linkService.getAllLinks();
            const remainingAliases = linkService.getAllAliases();
            
            expect(remainingLinks.length).toEqual(initialCount - deletedAliases.size);
            expect(remainingAliases.length).toEqual(remainingLinks.length);
            
            // Verify deleted aliases are available again
            for (const deletedAlias of deletedAliases) {
              const isAvailable = await linkService.isAliasAvailable(deletedAlias);
              expect(isAvailable).toBe(true);
            }
            
            // Verify remaining aliases are not available
            for (const alias of remainingAliases) {
              const isAvailable = await linkService.isAliasAvailable(alias);
              expect(isAvailable).toBe(false);
            }
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should handle concurrent alias operations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            baseAlias: fc.string({ minLength: 3, maxLength: 10 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            concurrentRequests: fc.integer({ min: 2, max: 10 }),
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            originalUrl: fc.webUrl(),
          }),
          async ({ baseAlias, concurrentRequests, userId, originalUrl }) => {
            // Create multiple requests with the same alias
            const requests = Array(concurrentRequests).fill(null).map(() => ({
              originalUrl,
              customAlias: baseAlias,
              userId,
            }));

            // Execute requests concurrently
            const results = await Promise.allSettled(
              requests.map(request => linkService.createLink(request))
            );

            // Exactly one should succeed, others should fail
            const successful = results.filter(r => r.status === 'fulfilled');
            const failed = results.filter(r => r.status === 'rejected');

            expect(successful.length).toEqual(1);
            expect(failed.length).toEqual(concurrentRequests - 1);

            // Verify the successful link
            if (successful.length > 0) {
              const link = (successful[0] as PromiseFulfilledResult<Link>).value;
              expect(link.alias).toEqual(baseAlias);
              
              const retrievedLink = await linkService.getLinkByAlias(baseAlias);
              expect(retrievedLink).toBeTruthy();
              expect(retrievedLink!.id).toEqual(link.id);
            }

            // Verify failed requests have appropriate error messages
            for (const failedResult of failed) {
              const error = (failedResult as PromiseRejectedResult).reason;
              expect(error.message).toContain('already exists');
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});