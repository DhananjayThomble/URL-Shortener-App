/**
 * Property-based tests for bio link ordering atomicity
 * Tests Property 12: Bio Link Ordering Atomicity
 * Validates Requirements 4.4
 */

import * as fc from 'fast-check';

interface BioLink {
  id: string;
  bioPageId: string;
  title: string;
  url: string;
  order: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Mock bio link service
class MockBioLinkService {
  private bioLinks = new Map<string, BioLink>();
  private bioPageLinks = new Map<string, string[]>(); // bioPageId -> linkIds[]

  async createBioLink(data: Omit<BioLink, 'id' | 'createdAt' | 'updatedAt'>): Promise<BioLink> {
    const bioLink: BioLink = {
      ...data,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.bioLinks.set(bioLink.id, bioLink);
    
    // Add to bio page links
    if (!this.bioPageLinks.has(data.bioPageId)) {
      this.bioPageLinks.set(data.bioPageId, []);
    }
    this.bioPageLinks.get(data.bioPageId)!.push(bioLink.id);

    return bioLink;
  }

  async updateBioLink(id: string, updates: Partial<Pick<BioLink, 'title' | 'url' | 'isActive'>>): Promise<BioLink> {
    const bioLink = this.bioLinks.get(id);
    if (!bioLink) {
      throw new Error('Bio link not found');
    }

    const updatedBioLink: BioLink = {
      ...bioLink,
      ...updates,
      updatedAt: new Date()
    };

    this.bioLinks.set(id, updatedBioLink);
    return updatedBioLink;
  }

  async deleteBioLink(id: string): Promise<void> {
    const bioLink = this.bioLinks.get(id);
    if (!bioLink) {
      throw new Error('Bio link not found');
    }

    this.bioLinks.delete(id);
    
    // Remove from bio page links
    const pageLinks = this.bioPageLinks.get(bioLink.bioPageId);
    if (pageLinks) {
      const index = pageLinks.indexOf(id);
      if (index > -1) {
        pageLinks.splice(index, 1);
      }
    }

    // Reorder remaining links to fill gaps
    await this.reorderLinksAfterDeletion(bioLink.bioPageId, bioLink.order);
  }

  async reorderBioLinks(bioPageId: string, newOrder: string[]): Promise<BioLink[]> {
    const pageLinks = this.bioPageLinks.get(bioPageId) || [];
    
    // Validate that all provided IDs exist and belong to this bio page
    for (const linkId of newOrder) {
      const link = this.bioLinks.get(linkId);
      if (!link || link.bioPageId !== bioPageId) {
        throw new Error(`Invalid link ID: ${linkId}`);
      }
    }

    // Validate that all existing links are included in new order
    if (newOrder.length !== pageLinks.length || 
        !pageLinks.every(id => newOrder.includes(id))) {
      throw new Error('New order must include all existing links');
    }

    // Atomic reordering: update all orders in a single operation
    const updatedLinks: BioLink[] = [];
    const now = new Date();

    for (let i = 0; i < newOrder.length; i++) {
      const linkId = newOrder[i];
      const link = this.bioLinks.get(linkId)!;
      
      const updatedLink: BioLink = {
        ...link,
        order: i + 1, // 1-based ordering
        updatedAt: now
      };

      this.bioLinks.set(linkId, updatedLink);
      updatedLinks.push(updatedLink);
    }

    // Update the bio page links array to match new order
    this.bioPageLinks.set(bioPageId, newOrder);

    return updatedLinks;
  }

  async moveBioLink(linkId: string, newPosition: number): Promise<BioLink[]> {
    const link = this.bioLinks.get(linkId);
    if (!link) {
      throw new Error('Bio link not found');
    }

    const pageLinks = this.bioPageLinks.get(link.bioPageId) || [];
    const currentIndex = pageLinks.indexOf(linkId);
    
    if (currentIndex === -1) {
      throw new Error('Link not found in bio page');
    }

    // Validate new position
    if (newPosition < 1 || newPosition > pageLinks.length) {
      throw new Error('Invalid position');
    }

    // Create new order by moving the link
    const newOrder = [...pageLinks];
    newOrder.splice(currentIndex, 1); // Remove from current position
    newOrder.splice(newPosition - 1, 0, linkId); // Insert at new position (1-based to 0-based)

    return this.reorderBioLinks(link.bioPageId, newOrder);
  }

  getBioLinksForPage(bioPageId: string): BioLink[] {
    const linkIds = this.bioPageLinks.get(bioPageId) || [];
    return linkIds
      .map(id => this.bioLinks.get(id)!)
      .filter(link => link) // Filter out any null/undefined
      .sort((a, b) => a.order - b.order);
  }

  getBioLinkById(id: string): BioLink | null {
    return this.bioLinks.get(id) || null;
  }

  private async reorderLinksAfterDeletion(bioPageId: string, deletedOrder: number): Promise<void> {
    const pageLinks = this.bioPageLinks.get(bioPageId) || [];
    const now = new Date();

    // Update orders for links that come after the deleted link
    for (const linkId of pageLinks) {
      const link = this.bioLinks.get(linkId);
      if (link && link.order > deletedOrder) {
        const updatedLink: BioLink = {
          ...link,
          order: link.order - 1,
          updatedAt: now
        };
        this.bioLinks.set(linkId, updatedLink);
      }
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  // Test helper methods
  getAllBioLinks(): BioLink[] {
    return Array.from(this.bioLinks.values());
  }

  validateOrderConsistency(bioPageId: string): { valid: boolean; errors: string[] } {
    const links = this.getBioLinksForPage(bioPageId);
    const errors: string[] = [];

    // Check for gaps in ordering
    for (let i = 0; i < links.length; i++) {
      if (links[i].order !== i + 1) {
        errors.push(`Order gap detected: expected ${i + 1}, got ${links[i].order}`);
      }
    }

    // Check for duplicate orders
    const orders = links.map(l => l.order);
    const uniqueOrders = [...new Set(orders)];
    if (orders.length !== uniqueOrders.length) {
      errors.push('Duplicate orders detected');
    }

    return { valid: errors.length === 0, errors };
  }

  clear(): void {
    this.bioLinks.clear();
    this.bioPageLinks.clear();
  }
}

describe('Bio Link Ordering Properties', () => {
  let bioLinkService: MockBioLinkService;

  beforeEach(() => {
    bioLinkService = new MockBioLinkService();
  });

  /**
   * Property 12: Bio Link Ordering Atomicity
   * Validates Requirements 4.4
   */
  describe('Property 12: Bio Link Ordering Atomicity', () => {
    it('should maintain consistent ordering after reordering operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
            links: fc.array(
              fc.record({
                title: fc.string({ minLength: 1, maxLength: 100 }),
                url: fc.webUrl(),
                isActive: fc.boolean()
              }),
              { minLength: 2, maxLength: 8 }
            ),
            reorderOperations: fc.array(
              fc.integer({ min: 0, max: 7 }),
              { minLength: 1, maxLength: 5 }
            )
          }),
          async ({ bioPageId, links, reorderOperations }) => {
            // Create bio links
            const createdLinks: BioLink[] = [];
            for (let i = 0; i < links.length; i++) {
              const linkData = {
                ...links[i],
                bioPageId,
                order: i + 1
              };
              const createdLink = await bioLinkService.createBioLink(linkData);
              createdLinks.push(createdLink);
            }

            // Perform reordering operations
            for (const targetIndex of reorderOperations) {
              if (targetIndex < createdLinks.length) {
                const currentLinks = bioLinkService.getBioLinksForPage(bioPageId);
                const linkIds = currentLinks.map(l => l.id);
                
                // Create a new random order
                const shuffledIds = [...linkIds];
                for (let i = shuffledIds.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [shuffledIds[i], shuffledIds[j]] = [shuffledIds[j], shuffledIds[i]];
                }

                await bioLinkService.reorderBioLinks(bioPageId, shuffledIds);
              }
            }

            // Verify final state consistency
            const finalLinks = bioLinkService.getBioLinksForPage(bioPageId);
            const validation = bioLinkService.validateOrderConsistency(bioPageId);
            
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
            expect(finalLinks).toHaveLength(links.length);

            // Verify all original links are still present
            const finalLinkIds = new Set(finalLinks.map(l => l.id));
            const originalLinkIds = new Set(createdLinks.map(l => l.id));
            expect(finalLinkIds).toEqual(originalLinkIds);
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle individual link movement atomically', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
            linkCount: fc.integer({ min: 3, max: 10 }),
            moveOperations: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 9 }),
                newPosition: fc.integer({ min: 1, max: 10 })
              }),
              { minLength: 1, maxLength: 5 }
            )
          }),
          async ({ bioPageId, linkCount, moveOperations }) => {
            // Create bio links
            const createdLinks: BioLink[] = [];
            for (let i = 0; i < linkCount; i++) {
              const linkData = {
                title: `Link ${i + 1}`,
                url: `https://example${i + 1}.com`,
                bioPageId,
                order: i + 1,
                isActive: true
              };
              const createdLink = await bioLinkService.createBioLink(linkData);
              createdLinks.push(createdLink);
            }

            // Perform move operations
            for (const operation of moveOperations) {
              const currentLinks = bioLinkService.getBioLinksForPage(bioPageId);
              
              if (operation.linkIndex < currentLinks.length && 
                  operation.newPosition >= 1 && 
                  operation.newPosition <= currentLinks.length) {
                
                const linkToMove = currentLinks[operation.linkIndex];
                await bioLinkService.moveBioLink(linkToMove.id, operation.newPosition);

                // Verify consistency after each move
                const validation = bioLinkService.validateOrderConsistency(bioPageId);
                expect(validation.valid).toBe(true);
                expect(validation.errors).toHaveLength(0);
              }
            }

            // Final verification
            const finalLinks = bioLinkService.getBioLinksForPage(bioPageId);
            expect(finalLinks).toHaveLength(linkCount);

            // Verify all links have unique, consecutive orders
            const orders = finalLinks.map(l => l.order).sort((a, b) => a - b);
            const expectedOrders = Array.from({ length: linkCount }, (_, i) => i + 1);
            expect(orders).toEqual(expectedOrders);
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should maintain ordering consistency during deletions', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
            initialLinkCount: fc.integer({ min: 5, max: 12 }),
            deleteIndices: fc.array(
              fc.integer({ min: 0, max: 11 }),
              { minLength: 1, maxLength: 5 }
            )
          }),
          async ({ bioPageId, initialLinkCount, deleteIndices }) => {
            // Create bio links
            const createdLinks: BioLink[] = [];
            for (let i = 0; i < initialLinkCount; i++) {
              const linkData = {
                title: `Link ${i + 1}`,
                url: `https://example${i + 1}.com`,
                bioPageId,
                order: i + 1,
                isActive: true
              };
              const createdLink = await bioLinkService.createBioLink(linkData);
              createdLinks.push(createdLink);
            }

            // Delete links (process in reverse order to maintain valid indices)
            const validDeleteIndices = deleteIndices
              .filter(i => i < initialLinkCount)
              .sort((a, b) => b - a); // Sort in descending order

            for (const index of validDeleteIndices) {
              const currentLinks = bioLinkService.getBioLinksForPage(bioPageId);
              if (index < currentLinks.length) {
                const linkToDelete = currentLinks[index];
                await bioLinkService.deleteBioLink(linkToDelete.id);

                // Verify consistency after each deletion
                const validation = bioLinkService.validateOrderConsistency(bioPageId);
                expect(validation.valid).toBe(true);
                expect(validation.errors).toHaveLength(0);
              }
            }

            // Final verification
            const remainingLinks = bioLinkService.getBioLinksForPage(bioPageId);
            const expectedCount = initialLinkCount - validDeleteIndices.length;
            expect(remainingLinks).toHaveLength(expectedCount);

            // Verify orders are consecutive starting from 1
            if (remainingLinks.length > 0) {
              const orders = remainingLinks.map(l => l.order).sort((a, b) => a - b);
              const expectedOrders = Array.from({ length: expectedCount }, (_, i) => i + 1);
              expect(orders).toEqual(expectedOrders);
            }
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should reject invalid reordering operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
            linkCount: fc.integer({ min: 3, max: 8 }),
            invalidOperations: fc.array(
              fc.oneof(
                fc.record({
                  type: fc.constant('missing_link'),
                  missingId: fc.string({ minLength: 1, maxLength: 20 })
                }),
                fc.record({
                  type: fc.constant('extra_link'),
                  extraId: fc.string({ minLength: 1, maxLength: 20 })
                }),
                fc.record({
                  type: fc.constant('duplicate_link'),
                  duplicateIndex: fc.integer({ min: 0, max: 7 })
                })
              ),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ bioPageId, linkCount, invalidOperations }) => {
            // Create bio links
            const createdLinks: BioLink[] = [];
            for (let i = 0; i < linkCount; i++) {
              const linkData = {
                title: `Link ${i + 1}`,
                url: `https://example${i + 1}.com`,
                bioPageId,
                order: i + 1,
                isActive: true
              };
              const createdLink = await bioLinkService.createBioLink(linkData);
              createdLinks.push(createdLink);
            }

            const validLinkIds = createdLinks.map(l => l.id);

            // Test invalid operations
            for (const operation of invalidOperations) {
              let invalidOrder: string[] = [];

              if (operation.type === 'missing_link') {
                // Missing one of the existing links
                invalidOrder = validLinkIds.slice(1);
              } else if (operation.type === 'extra_link') {
                // Including a non-existent link
                invalidOrder = [...validLinkIds, operation.extraId];
              } else if (operation.type === 'duplicate_link' && operation.duplicateIndex < validLinkIds.length) {
                // Duplicating an existing link
                invalidOrder = [...validLinkIds, validLinkIds[operation.duplicateIndex]];
              }

              if (invalidOrder.length > 0) {
                await expect(
                  bioLinkService.reorderBioLinks(bioPageId, invalidOrder)
                ).rejects.toThrow();

                // Verify original order is preserved after failed operation
                const links = bioLinkService.getBioLinksForPage(bioPageId);
                const validation = bioLinkService.validateOrderConsistency(bioPageId);
                expect(validation.valid).toBe(true);
                expect(links).toHaveLength(linkCount);
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle concurrent reordering operations safely', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
            linkCount: fc.integer({ min: 4, max: 8 }),
            concurrentOperations: fc.array(
              fc.record({
                type: fc.constantFrom('reorder', 'move'),
                delay: fc.integer({ min: 0, max: 10 })
              }),
              { minLength: 2, maxLength: 4 }
            )
          }),
          async ({ bioPageId, linkCount, concurrentOperations }) => {
            // Create bio links
            const createdLinks: BioLink[] = [];
            for (let i = 0; i < linkCount; i++) {
              const linkData = {
                title: `Link ${i + 1}`,
                url: `https://example${i + 1}.com`,
                bioPageId,
                order: i + 1,
                isActive: true
              };
              const createdLink = await bioLinkService.createBioLink(linkData);
              createdLinks.push(createdLink);
            }

            // Execute operations with small delays to simulate concurrency
            const operations = concurrentOperations.map(async (op) => {
              await new Promise(resolve => setTimeout(resolve, op.delay));
              
              try {
                if (op.type === 'reorder') {
                  const currentLinks = bioLinkService.getBioLinksForPage(bioPageId);
                  const linkIds = currentLinks.map(l => l.id);
                  
                  // Shuffle the order
                  const shuffled = [...linkIds];
                  for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                  }
                  
                  await bioLinkService.reorderBioLinks(bioPageId, shuffled);
                } else if (op.type === 'move') {
                  const currentLinks = bioLinkService.getBioLinksForPage(bioPageId);
                  if (currentLinks.length > 0) {
                    const randomLink = currentLinks[Math.floor(Math.random() * currentLinks.length)];
                    const newPosition = Math.floor(Math.random() * currentLinks.length) + 1;
                    await bioLinkService.moveBioLink(randomLink.id, newPosition);
                  }
                }
              } catch (error) {
                // Some operations may fail due to race conditions, which is acceptable
                // The important thing is that the final state is consistent
              }
            });

            await Promise.all(operations);

            // Verify final consistency
            const finalLinks = bioLinkService.getBioLinksForPage(bioPageId);
            const validation = bioLinkService.validateOrderConsistency(bioPageId);
            
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
            expect(finalLinks).toHaveLength(linkCount);

            // Verify all original links are still present
            const finalLinkIds = new Set(finalLinks.map(l => l.id));
            const originalLinkIds = new Set(createdLinks.map(l => l.id));
            expect(finalLinkIds).toEqual(originalLinkIds);
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should maintain order integrity across multiple bio pages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPages: fc.array(
              fc.record({
                bioPageId: fc.string({ minLength: 1, maxLength: 20 }),
                linkCount: fc.integer({ min: 2, max: 6 })
              }),
              { minLength: 2, maxLength: 4 }
            )
          }),
          async ({ bioPages }) => {
            // Ensure unique bio page IDs
            const uniquePageIds = [...new Set(bioPages.map(p => p.bioPageId))];
            fc.pre(uniquePageIds.length === bioPages.length);

            // Create links for each bio page
            const allCreatedLinks: Map<string, BioLink[]> = new Map();

            for (const page of bioPages) {
              const pageLinks: BioLink[] = [];
              for (let i = 0; i < page.linkCount; i++) {
                const linkData = {
                  title: `Page ${page.bioPageId} Link ${i + 1}`,
                  url: `https://${page.bioPageId}-${i + 1}.com`,
                  bioPageId: page.bioPageId,
                  order: i + 1,
                  isActive: true
                };
                const createdLink = await bioLinkService.createBioLink(linkData);
                pageLinks.push(createdLink);
              }
              allCreatedLinks.set(page.bioPageId, pageLinks);
            }

            // Perform random reordering on each page
            for (const page of bioPages) {
              const currentLinks = bioLinkService.getBioLinksForPage(page.bioPageId);
              const linkIds = currentLinks.map(l => l.id);
              
              // Shuffle
              for (let i = linkIds.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [linkIds[i], linkIds[j]] = [linkIds[j], linkIds[i]];
              }
              
              await bioLinkService.reorderBioLinks(page.bioPageId, linkIds);
            }

            // Verify each page maintains its own consistent ordering
            for (const page of bioPages) {
              const pageLinks = bioLinkService.getBioLinksForPage(page.bioPageId);
              const validation = bioLinkService.validateOrderConsistency(page.bioPageId);
              
              expect(validation.valid).toBe(true);
              expect(validation.errors).toHaveLength(0);
              expect(pageLinks).toHaveLength(page.linkCount);

              // Verify orders are consecutive
              const orders = pageLinks.map(l => l.order).sort((a, b) => a - b);
              const expectedOrders = Array.from({ length: page.linkCount }, (_, i) => i + 1);
              expect(orders).toEqual(expectedOrders);

              // Verify all links belong to correct bio page
              for (const link of pageLinks) {
                expect(link.bioPageId).toBe(page.bioPageId);
              }
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});