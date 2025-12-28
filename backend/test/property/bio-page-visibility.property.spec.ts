/**
 * Property-based tests for bio page visibility control
 * Tests Property 13: Bio Page Visibility Control
 * Validates Requirements 4.5, 4.6
 */

import * as fc from 'fast-check';

interface BioPage {
  id: string;
  username: string;
  userId: string;
  isPublic: boolean;
  title?: string;
  description?: string;
  theme: string;
  customCss?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface BioLink {
  id: string;
  bioPageId: string;
  title: string;
  url: string;
  isVisible: boolean;
  order: number;
  createdAt: Date;
}

// Mock bio page visibility service
class MockBioPageVisibilityService {
  private bioPages = new Map<string, BioPage>();
  private bioLinks = new Map<string, BioLink[]>();
  private accessLogs = new Map<string, { timestamp: Date; visitorId: string; isOwner: boolean }[]>();

  async createBioPage(data: Omit<BioPage, 'id' | 'createdAt' | 'updatedAt'>): Promise<BioPage> {
    const bioPage: BioPage = {
      ...data,
      id: `bio_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.bioPages.set(bioPage.id, bioPage);
    this.bioLinks.set(bioPage.id, []);
    return bioPage;
  }

  async updateVisibility(bioPageId: string, isPublic: boolean, userId: string): Promise<BioPage | null> {
    const bioPage = this.bioPages.get(bioPageId);
    if (!bioPage || bioPage.userId !== userId) {
      return null;
    }

    bioPage.isPublic = isPublic;
    bioPage.updatedAt = new Date();
    this.bioPages.set(bioPageId, bioPage);
    return bioPage;
  }

  async addBioLink(bioPageId: string, linkData: Omit<BioLink, 'id' | 'bioPageId' | 'createdAt'>): Promise<BioLink | null> {
    const bioPage = this.bioPages.get(bioPageId);
    if (!bioPage) return null;

    const bioLink: BioLink = {
      ...linkData,
      id: `link_${Math.random().toString(36).substr(2, 9)}`,
      bioPageId,
      createdAt: new Date(),
    };

    const links = this.bioLinks.get(bioPageId) || [];
    links.push(bioLink);
    this.bioLinks.set(bioPageId, links);
    return bioLink;
  }

  async updateLinkVisibility(bioPageId: string, linkId: string, isVisible: boolean, userId: string): Promise<BioLink | null> {
    const bioPage = this.bioPages.get(bioPageId);
    if (!bioPage || bioPage.userId !== userId) {
      return null;
    }

    const links = this.bioLinks.get(bioPageId) || [];
    const link = links.find(l => l.id === linkId);
    if (!link) return null;

    link.isVisible = isVisible;
    return link;
  }

  async getPublicBioPage(username: string, visitorId: string): Promise<{ bioPage: BioPage; visibleLinks: BioLink[] } | null> {
    const bioPage = Array.from(this.bioPages.values()).find(bp => bp.username === username);
    if (!bioPage || !bioPage.isPublic) {
      return null;
    }

    // Log access
    const logs = this.accessLogs.get(bioPage.id) || [];
    logs.push({
      timestamp: new Date(),
      visitorId,
      isOwner: false,
    });
    this.accessLogs.set(bioPage.id, logs);

    const allLinks = this.bioLinks.get(bioPage.id) || [];
    const visibleLinks = allLinks.filter(link => link.isVisible).sort((a, b) => a.order - b.order);

    return { bioPage, visibleLinks };
  }

  async getPrivateBioPage(bioPageId: string, userId: string): Promise<{ bioPage: BioPage; allLinks: BioLink[] } | null> {
    const bioPage = this.bioPages.get(bioPageId);
    if (!bioPage || bioPage.userId !== userId) {
      return null;
    }

    // Log owner access
    const logs = this.accessLogs.get(bioPage.id) || [];
    logs.push({
      timestamp: new Date(),
      visitorId: userId,
      isOwner: true,
    });
    this.accessLogs.set(bioPage.id, logs);

    const allLinks = this.bioLinks.get(bioPageId) || [];
    return { bioPage, allLinks: allLinks.sort((a, b) => a.order - b.order) };
  }

  async getBioPageAnalytics(bioPageId: string, userId: string): Promise<{
    totalViews: number;
    uniqueVisitors: number;
    ownerViews: number;
    publicViews: number;
  } | null> {
    const bioPage = this.bioPages.get(bioPageId);
    if (!bioPage || bioPage.userId !== userId) {
      return null;
    }

    const logs = this.accessLogs.get(bioPageId) || [];
    const uniqueVisitors = new Set(logs.filter(log => !log.isOwner).map(log => log.visitorId)).size;
    const ownerViews = logs.filter(log => log.isOwner).length;
    const publicViews = logs.filter(log => !log.isOwner).length;

    return {
      totalViews: logs.length,
      uniqueVisitors,
      ownerViews,
      publicViews,
    };
  }

  // Test helper methods
  getAllBioPages(): BioPage[] {
    return Array.from(this.bioPages.values());
  }

  getBioPageById(id: string): BioPage | undefined {
    return this.bioPages.get(id);
  }

  getBioLinksForPage(bioPageId: string): BioLink[] {
    return this.bioLinks.get(bioPageId) || [];
  }

  getAccessLogs(bioPageId: string): { timestamp: Date; visitorId: string; isOwner: boolean }[] {
    return this.accessLogs.get(bioPageId) || [];
  }
}

describe('Bio Page Visibility Properties', () => {
  let visibilityService: MockBioPageVisibilityService;

  beforeEach(() => {
    visibilityService = new MockBioPageVisibilityService();
  });

  /**
   * Property 13: Bio Page Visibility Control
   * Validates Requirements 4.5, 4.6
   */
  describe('Property 13: Bio Page Visibility Control', () => {
    it('should enforce public/private visibility rules', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPages: fc.array(
              fc.record({
                username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                isPublic: fc.boolean(),
                title: fc.option(fc.string({ minLength: 1, maxLength: 100 })),
                description: fc.option(fc.string({ minLength: 1, maxLength: 500 })),
                theme: fc.constantFrom('default', 'dark', 'minimal', 'colorful'),
              }),
              { minLength: 1, maxLength: 5 }
            ),
            visitors: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ bioPages, visitors }) => {
            // Ensure unique usernames
            const uniqueUsernames = [...new Set(bioPages.map(bp => bp.username))];
            fc.pre(uniqueUsernames.length === bioPages.length);

            // Create bio pages
            const createdPages: BioPage[] = [];
            for (const pageData of bioPages) {
              const bioPage = await visibilityService.createBioPage(pageData);
              createdPages.push(bioPage);
            }

            // Test visibility rules for each visitor
            for (const visitorId of visitors) {
              for (const bioPage of createdPages) {
                const result = await visibilityService.getPublicBioPage(bioPage.username, visitorId);

                if (bioPage.isPublic) {
                  // Public pages should be accessible
                  expect(result).toBeTruthy();
                  expect(result!.bioPage.id).toBe(bioPage.id);
                  expect(result!.bioPage.username).toBe(bioPage.username);
                } else {
                  // Private pages should not be accessible to public
                  expect(result).toBeNull();
                }
              }
            }

            // Owners should always be able to access their own pages
            for (const bioPage of createdPages) {
              const ownerResult = await visibilityService.getPrivateBioPage(bioPage.id, bioPage.userId);
              expect(ownerResult).toBeTruthy();
              expect(ownerResult!.bioPage.id).toBe(bioPage.id);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should control individual link visibility within bio pages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageData: fc.record({
              username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              isPublic: fc.boolean(),
              title: fc.string({ minLength: 1, maxLength: 100 }),
              theme: fc.constantFrom('default', 'dark', 'minimal'),
            }),
            links: fc.array(
              fc.record({
                title: fc.string({ minLength: 1, maxLength: 100 }),
                url: fc.webUrl(),
                isVisible: fc.boolean(),
                order: fc.integer({ min: 0, max: 100 }),
              }),
              { minLength: 1, maxLength: 10 }
            ),
            visitorId: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ bioPageData, links, visitorId }) => {
            // Create bio page
            const bioPage = await visibilityService.createBioPage(bioPageData);

            // Add links to bio page
            const createdLinks: BioLink[] = [];
            for (const linkData of links) {
              const link = await visibilityService.addBioLink(bioPage.id, linkData);
              expect(link).toBeTruthy();
              createdLinks.push(link!);
            }

            if (bioPage.isPublic) {
              // Public access should only show visible links
              const publicResult = await visibilityService.getPublicBioPage(bioPage.username, visitorId);
              expect(publicResult).toBeTruthy();
              
              const visibleLinks = createdLinks.filter(link => link.isVisible);
              expect(publicResult!.visibleLinks).toHaveLength(visibleLinks.length);
              
              // Verify only visible links are returned and in correct order
              const expectedOrder = visibleLinks.sort((a, b) => a.order - b.order);
              for (let i = 0; i < expectedOrder.length; i++) {
                expect(publicResult!.visibleLinks[i].id).toBe(expectedOrder[i].id);
                expect(publicResult!.visibleLinks[i].isVisible).toBe(true);
              }
            }

            // Owner access should show all links
            const ownerResult = await visibilityService.getPrivateBioPage(bioPage.id, bioPage.userId);
            expect(ownerResult).toBeTruthy();
            expect(ownerResult!.allLinks).toHaveLength(createdLinks.length);
            
            // Verify all links are returned in correct order
            const expectedOrder = createdLinks.sort((a, b) => a.order - b.order);
            for (let i = 0; i < expectedOrder.length; i++) {
              expect(ownerResult!.allLinks[i].id).toBe(expectedOrder[i].id);
            }
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should track analytics separately for public and private access', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageData: fc.record({
              username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              isPublic: fc.boolean(),
              title: fc.string({ minLength: 1, maxLength: 100 }),
              theme: fc.constantFrom('default', 'dark'),
            }),
            publicVisitors: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 0, maxLength: 5 }
            ),
            ownerVisits: fc.integer({ min: 0, max: 10 })
          }),
          async ({ bioPageData, publicVisitors, ownerVisits }) => {
            // Create bio page
            const bioPage = await visibilityService.createBioPage(bioPageData);

            let expectedPublicViews = 0;
            let expectedUniqueVisitors = 0;

            // Simulate public visits (only if page is public)
            if (bioPage.isPublic) {
              const uniqueVisitors = [...new Set(publicVisitors)];
              expectedUniqueVisitors = uniqueVisitors.length;
              
              for (const visitorId of publicVisitors) {
                const result = await visibilityService.getPublicBioPage(bioPage.username, visitorId);
                if (result) {
                  expectedPublicViews++;
                }
              }
            }

            // Simulate owner visits
            for (let i = 0; i < ownerVisits; i++) {
              await visibilityService.getPrivateBioPage(bioPage.id, bioPage.userId);
            }

            // Check analytics
            const analytics = await visibilityService.getBioPageAnalytics(bioPage.id, bioPage.userId);
            expect(analytics).toBeTruthy();
            
            expect(analytics!.publicViews).toBe(expectedPublicViews);
            expect(analytics!.ownerViews).toBe(ownerVisits);
            expect(analytics!.uniqueVisitors).toBe(expectedUniqueVisitors);
            expect(analytics!.totalViews).toBe(expectedPublicViews + ownerVisits);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain visibility state consistency during updates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageData: fc.record({
              username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              isPublic: fc.boolean(),
              title: fc.string({ minLength: 1, maxLength: 100 }),
              theme: fc.constantFrom('default', 'dark'),
            }),
            visibilityUpdates: fc.array(
              fc.boolean(),
              { minLength: 1, maxLength: 5 }
            ),
            visitorId: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ bioPageData, visibilityUpdates, visitorId }) => {
            // Create bio page
            let bioPage = await visibilityService.createBioPage(bioPageData);

            // Apply visibility updates
            for (const newVisibility of visibilityUpdates) {
              const updated = await visibilityService.updateVisibility(bioPage.id, newVisibility, bioPage.userId);
              expect(updated).toBeTruthy();
              expect(updated!.isPublic).toBe(newVisibility);
              bioPage = updated!;

              // Test immediate consistency
              const publicResult = await visibilityService.getPublicBioPage(bioPage.username, visitorId);
              
              if (newVisibility) {
                expect(publicResult).toBeTruthy();
                expect(publicResult!.bioPage.isPublic).toBe(true);
              } else {
                expect(publicResult).toBeNull();
              }

              // Owner should always have access
              const ownerResult = await visibilityService.getPrivateBioPage(bioPage.id, bioPage.userId);
              expect(ownerResult).toBeTruthy();
              expect(ownerResult!.bioPage.isPublic).toBe(newVisibility);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should enforce access control for visibility modifications', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageData: fc.record({
              username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              isPublic: fc.boolean(),
              title: fc.string({ minLength: 1, maxLength: 100 }),
              theme: fc.constantFrom('default', 'dark'),
            }),
            unauthorizedUsers: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 1, maxLength: 3 }
            ),
            newVisibility: fc.boolean()
          }),
          async ({ bioPageData, unauthorizedUsers, newVisibility }) => {
            // Ensure unauthorized users are different from owner
            const filteredUnauthorizedUsers = unauthorizedUsers.filter(u => u !== bioPageData.userId);
            fc.pre(filteredUnauthorizedUsers.length > 0);

            // Create bio page
            const bioPage = await visibilityService.createBioPage(bioPageData);

            // Test that unauthorized users cannot modify visibility
            for (const unauthorizedUserId of filteredUnauthorizedUsers) {
              const result = await visibilityService.updateVisibility(bioPage.id, newVisibility, unauthorizedUserId);
              expect(result).toBeNull();
            }

            // Verify original visibility is unchanged
            const unchangedPage = visibilityService.getBioPageById(bioPage.id);
            expect(unchangedPage!.isPublic).toBe(bioPageData.isPublic);

            // Owner should still be able to modify
            const ownerResult = await visibilityService.updateVisibility(bioPage.id, newVisibility, bioPage.userId);
            expect(ownerResult).toBeTruthy();
            expect(ownerResult!.isPublic).toBe(newVisibility);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle link visibility updates correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPageData: fc.record({
              username: fc.string({ minLength: 3, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_]+$/.test(s)),
              userId: fc.string({ minLength: 1, maxLength: 20 }),
              isPublic: fc.boolean(),
              title: fc.string({ minLength: 1, maxLength: 100 }),
              theme: fc.constantFrom('default', 'dark'),
            }),
            linkData: fc.record({
              title: fc.string({ minLength: 1, maxLength: 100 }),
              url: fc.webUrl(),
              isVisible: fc.boolean(),
              order: fc.integer({ min: 0, max: 100 }),
            }),
            visibilityUpdates: fc.array(
              fc.boolean(),
              { minLength: 1, maxLength: 3 }
            ),
            visitorId: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ bioPageData, linkData, visibilityUpdates, visitorId }) => {
            // Create bio page and link
            const bioPage = await visibilityService.createBioPage(bioPageData);
            const link = await visibilityService.addBioLink(bioPage.id, linkData);
            expect(link).toBeTruthy();

            // Apply visibility updates to the link
            for (const newVisibility of visibilityUpdates) {
              const updatedLink = await visibilityService.updateLinkVisibility(
                bioPage.id, 
                link!.id, 
                newVisibility, 
                bioPage.userId
              );
              expect(updatedLink).toBeTruthy();
              expect(updatedLink!.isVisible).toBe(newVisibility);

              // Test public visibility if bio page is public
              if (bioPage.isPublic) {
                const publicResult = await visibilityService.getPublicBioPage(bioPage.username, visitorId);
                expect(publicResult).toBeTruthy();
                
                if (newVisibility) {
                  expect(publicResult!.visibleLinks).toHaveLength(1);
                  expect(publicResult!.visibleLinks[0].id).toBe(link!.id);
                } else {
                  expect(publicResult!.visibleLinks).toHaveLength(0);
                }
              }

              // Owner should always see all links
              const ownerResult = await visibilityService.getPrivateBioPage(bioPage.id, bioPage.userId);
              expect(ownerResult).toBeTruthy();
              expect(ownerResult!.allLinks).toHaveLength(1);
              expect(ownerResult!.allLinks[0].isVisible).toBe(newVisibility);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});