/**
 * Property-based tests for bio page username uniqueness
 * Tests Property 11: Bio Page Username Uniqueness
 * Validates Requirements 4.1
 */

import * as fc from 'fast-check';

interface BioPage {
  id: string;
  username: string;
  userId: string;
  title: string;
  bio?: string;
  theme: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Mock bio page service
class MockBioPageService {
  private bioPages = new Map<string, BioPage>();
  private usernameIndex = new Map<string, string>(); // username -> bioPageId

  async createBioPage(data: Omit<BioPage, 'id' | 'createdAt' | 'updatedAt'>): Promise<BioPage> {
    // Validate username uniqueness
    if (this.usernameIndex.has(data.username.toLowerCase())) {
      throw new Error(`Username '${data.username}' is already taken`);
    }

    // Validate username format
    if (!this.isValidUsername(data.username)) {
      throw new Error('Username contains invalid characters or format');
    }

    const bioPage: BioPage = {
      ...data,
      id: this.generateId(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.bioPages.set(bioPage.id, bioPage);
    this.usernameIndex.set(data.username.toLowerCase(), bioPage.id);

    return bioPage;
  }

  async updateBioPage(id: string, updates: Partial<Pick<BioPage, 'username' | 'title' | 'bio' | 'theme' | 'isPublic'>>): Promise<BioPage> {
    const bioPage = this.bioPages.get(id);
    if (!bioPage) {
      throw new Error('Bio page not found');
    }

    // If username is being updated, check uniqueness
    if (updates.username && updates.username !== bioPage.username) {
      if (this.usernameIndex.has(updates.username.toLowerCase())) {
        throw new Error(`Username '${updates.username}' is already taken`);
      }

      if (!this.isValidUsername(updates.username)) {
        throw new Error('Username contains invalid characters or format');
      }

      // Remove old username from index
      this.usernameIndex.delete(bioPage.username.toLowerCase());
      // Add new username to index
      this.usernameIndex.set(updates.username.toLowerCase(), id);
    }

    const updatedBioPage: BioPage = {
      ...bioPage,
      ...updates,
      updatedAt: new Date()
    };

    this.bioPages.set(id, updatedBioPage);
    return updatedBioPage;
  }

  async deleteBioPage(id: string): Promise<void> {
    const bioPage = this.bioPages.get(id);
    if (!bioPage) {
      throw new Error('Bio page not found');
    }

    this.bioPages.delete(id);
    this.usernameIndex.delete(bioPage.username.toLowerCase());
  }

  getBioPageByUsername(username: string): BioPage | null {
    const id = this.usernameIndex.get(username.toLowerCase());
    return id ? this.bioPages.get(id) || null : null;
  }

  getBioPageById(id: string): BioPage | null {
    return this.bioPages.get(id) || null;
  }

  getUserBioPages(userId: string): BioPage[] {
    return Array.from(this.bioPages.values()).filter(page => page.userId === userId);
  }

  isUsernameAvailable(username: string): boolean {
    return !this.usernameIndex.has(username.toLowerCase());
  }

  private isValidUsername(username: string): boolean {
    // Username must be 3-30 characters
    if (username.length < 3 || username.length > 30) return false;
    
    // Username can only contain alphanumeric characters, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return false;
    
    // Username cannot start or end with hyphen or underscore
    if (username.startsWith('-') || username.startsWith('_') || 
        username.endsWith('-') || username.endsWith('_')) return false;
    
    // Username cannot contain consecutive special characters
    if (/[_-]{2,}/.test(username)) return false;
    
    return true;
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  // Test helper methods
  getAllBioPages(): BioPage[] {
    return Array.from(this.bioPages.values());
  }

  getAllUsernames(): string[] {
    return Array.from(this.usernameIndex.keys());
  }

  clear(): void {
    this.bioPages.clear();
    this.usernameIndex.clear();
  }
}

describe('Bio Page Username Uniqueness Properties', () => {
  let bioPageService: MockBioPageService;

  beforeEach(() => {
    bioPageService = new MockBioPageService();
  });

  /**
   * Property 11: Bio Page Username Uniqueness
   * Validates Requirements 4.1
   */
  describe('Property 11: Bio Page Username Uniqueness', () => {
    it('should enforce username uniqueness across all bio pages', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPages: fc.array(
              fc.record({
                username: fc.string({ minLength: 3, maxLength: 30 })
                  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                              !s.startsWith('-') && !s.startsWith('_') &&
                              !s.endsWith('-') && !s.endsWith('_') &&
                              !/[_-]{2,}/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                title: fc.string({ minLength: 1, maxLength: 100 }),
                theme: fc.constantFrom('default', 'dark', 'colorful'),
                isPublic: fc.boolean()
              }),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ bioPages }) => {
            const createdPages: BioPage[] = [];
            const usedUsernames = new Set<string>();

            for (const pageData of bioPages) {
              const normalizedUsername = pageData.username.toLowerCase();
              
              if (usedUsernames.has(normalizedUsername)) {
                // Should reject duplicate username
                await expect(bioPageService.createBioPage(pageData)).rejects.toThrow('already taken');
              } else {
                // Should accept unique username
                const createdPage = await bioPageService.createBioPage(pageData);
                expect(createdPage.username).toBe(pageData.username);
                expect(createdPage.userId).toBe(pageData.userId);
                
                createdPages.push(createdPage);
                usedUsernames.add(normalizedUsername);
                
                // Verify username is no longer available
                expect(bioPageService.isUsernameAvailable(pageData.username)).toBe(false);
                
                // Verify case-insensitive uniqueness
                expect(bioPageService.isUsernameAvailable(pageData.username.toUpperCase())).toBe(false);
                expect(bioPageService.isUsernameAvailable(pageData.username.toLowerCase())).toBe(false);
              }
            }

            // Verify all created pages can be retrieved by username
            for (const page of createdPages) {
              const retrieved = bioPageService.getBioPageByUsername(page.username);
              expect(retrieved).toBeTruthy();
              expect(retrieved!.id).toBe(page.id);
              expect(retrieved!.username).toBe(page.username);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should handle username updates while maintaining uniqueness', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            initialPages: fc.array(
              fc.record({
                username: fc.string({ minLength: 3, maxLength: 30 })
                  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                              !s.startsWith('-') && !s.startsWith('_') &&
                              !s.endsWith('-') && !s.endsWith('_') &&
                              !/[_-]{2,}/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                title: fc.string({ minLength: 1, maxLength: 100 }),
                theme: fc.constantFrom('default', 'dark', 'colorful'),
                isPublic: fc.boolean()
              }),
              { minLength: 2, maxLength: 5 }
            ),
            newUsername: fc.string({ minLength: 3, maxLength: 30 })
              .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                          !s.startsWith('-') && !s.startsWith('_') &&
                          !s.endsWith('-') && !s.endsWith('_') &&
                          !/[_-]{2,}/.test(s))
          }),
          async ({ initialPages, newUsername }) => {
            // Ensure all initial usernames are unique
            const uniqueUsernames = [...new Set(initialPages.map(p => p.username.toLowerCase()))];
            fc.pre(uniqueUsernames.length === initialPages.length);

            // Create initial bio pages
            const createdPages: BioPage[] = [];
            for (const pageData of initialPages) {
              const page = await bioPageService.createBioPage(pageData);
              createdPages.push(page);
            }

            // Try to update first page's username
            const pageToUpdate = createdPages[0];
            const existingUsernames = createdPages.map(p => p.username.toLowerCase());
            
            if (existingUsernames.includes(newUsername.toLowerCase()) && 
                newUsername.toLowerCase() !== pageToUpdate.username.toLowerCase()) {
              // Should reject update to existing username
              await expect(
                bioPageService.updateBioPage(pageToUpdate.id, { username: newUsername })
              ).rejects.toThrow('already taken');
              
              // Original username should still be in use
              expect(bioPageService.isUsernameAvailable(pageToUpdate.username)).toBe(false);
            } else {
              // Should accept update to new unique username
              const oldUsername = pageToUpdate.username;
              const updatedPage = await bioPageService.updateBioPage(pageToUpdate.id, { username: newUsername });
              
              expect(updatedPage.username).toBe(newUsername);
              expect(updatedPage.id).toBe(pageToUpdate.id);
              
              // Old username should now be available (if different)
              if (oldUsername.toLowerCase() !== newUsername.toLowerCase()) {
                expect(bioPageService.isUsernameAvailable(oldUsername)).toBe(true);
              }
              
              // New username should not be available
              expect(bioPageService.isUsernameAvailable(newUsername)).toBe(false);
              
              // Should be retrievable by new username
              const retrieved = bioPageService.getBioPageByUsername(newUsername);
              expect(retrieved).toBeTruthy();
              expect(retrieved!.id).toBe(pageToUpdate.id);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain username availability after deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            bioPages: fc.array(
              fc.record({
                username: fc.string({ minLength: 3, maxLength: 30 })
                  .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                              !s.startsWith('-') && !s.startsWith('_') &&
                              !s.endsWith('-') && !s.endsWith('_') &&
                              !/[_-]{2,}/.test(s)),
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                title: fc.string({ minLength: 1, maxLength: 100 }),
                theme: fc.constantFrom('default', 'dark', 'colorful'),
                isPublic: fc.boolean()
              }),
              { minLength: 2, maxLength: 5 }
            ),
            deleteIndices: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 3 })
          }),
          async ({ bioPages, deleteIndices }) => {
            // Ensure all usernames are unique
            const uniqueUsernames = [...new Set(bioPages.map(p => p.username.toLowerCase()))];
            fc.pre(uniqueUsernames.length === bioPages.length);

            // Create bio pages
            const createdPages: BioPage[] = [];
            for (const pageData of bioPages) {
              const page = await bioPageService.createBioPage(pageData);
              createdPages.push(page);
            }

            // Delete some pages
            const validDeleteIndices = deleteIndices.filter(i => i < createdPages.length);
            const deletedUsernames: string[] = [];
            
            for (const index of validDeleteIndices) {
              const pageToDelete = createdPages[index];
              if (pageToDelete) {
                deletedUsernames.push(pageToDelete.username);
                await bioPageService.deleteBioPage(pageToDelete.id);
                
                // Username should become available immediately
                expect(bioPageService.isUsernameAvailable(pageToDelete.username)).toBe(true);
                
                // Should not be retrievable by username
                expect(bioPageService.getBioPageByUsername(pageToDelete.username)).toBeNull();
                
                // Should not be retrievable by ID
                expect(bioPageService.getBioPageById(pageToDelete.id)).toBeNull();
              }
            }

            // Verify deleted usernames can be reused
            for (const username of deletedUsernames) {
              const newPageData = {
                username,
                userId: 'new-user',
                title: 'Reused Username Page',
                theme: 'default' as const,
                isPublic: true
              };
              
              const newPage = await bioPageService.createBioPage(newPageData);
              expect(newPage.username).toBe(username);
              expect(bioPageService.isUsernameAvailable(username)).toBe(false);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should enforce case-insensitive username uniqueness', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            baseUsername: fc.string({ minLength: 3, maxLength: 20 })
              .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                          !s.startsWith('-') && !s.startsWith('_') &&
                          !s.endsWith('-') && !s.endsWith('_') &&
                          !/[_-]{2,}/.test(s)),
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            title: fc.string({ minLength: 1, maxLength: 100 })
          }),
          async ({ baseUsername, userId, title }) => {
            const pageData = {
              username: baseUsername,
              userId,
              title,
              theme: 'default' as const,
              isPublic: true
            };

            // Create bio page with original username
            const originalPage = await bioPageService.createBioPage(pageData);
            expect(originalPage.username).toBe(baseUsername);

            // Try to create pages with different case variations
            const variations = [
              baseUsername.toLowerCase(),
              baseUsername.toUpperCase(),
              baseUsername.charAt(0).toUpperCase() + baseUsername.slice(1).toLowerCase()
            ];

            for (const variation of variations) {
              if (variation !== baseUsername) {
                const variationData = {
                  ...pageData,
                  username: variation,
                  userId: userId + '-variant'
                };

                // Should reject case variations
                await expect(bioPageService.createBioPage(variationData)).rejects.toThrow('already taken');
                
                // Username should not be available in any case
                expect(bioPageService.isUsernameAvailable(variation)).toBe(false);
              }
            }

            // Original page should still be retrievable by any case variation
            for (const variation of variations) {
              const retrieved = bioPageService.getBioPageByUsername(variation);
              expect(retrieved).toBeTruthy();
              expect(retrieved!.id).toBe(originalPage.id);
              expect(retrieved!.username).toBe(baseUsername); // Should return original case
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should validate username format requirements', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            validUsernames: fc.array(
              fc.string({ minLength: 3, maxLength: 30 })
                .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                            !s.startsWith('-') && !s.startsWith('_') &&
                            !s.endsWith('-') && !s.endsWith('_') &&
                            !/[_-]{2,}/.test(s)),
              { minLength: 1, maxLength: 3 }
            ),
            invalidUsernames: fc.array(
              fc.oneof(
                fc.string({ minLength: 1, maxLength: 2 }), // Too short
                fc.string({ minLength: 31, maxLength: 50 }), // Too long
                fc.string({ minLength: 3, maxLength: 20 }).map(s => '-' + s), // Starts with hyphen
                fc.string({ minLength: 3, maxLength: 20 }).map(s => '_' + s), // Starts with underscore
                fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '-'), // Ends with hyphen
                fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '_'), // Ends with underscore
                fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '--' + s), // Consecutive hyphens
                fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '__' + s), // Consecutive underscores
                fc.string({ minLength: 3, maxLength: 20 }).map(s => s + '@' + s) // Invalid characters
              ),
              { minLength: 1, maxLength: 3 }
            ),
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            title: fc.string({ minLength: 1, maxLength: 100 })
          }),
          async ({ validUsernames, invalidUsernames, userId, title }) => {
            // Valid usernames should be accepted
            for (const username of validUsernames) {
              const pageData = {
                username,
                userId: userId + '-' + username,
                title,
                theme: 'default' as const,
                isPublic: true
              };

              const page = await bioPageService.createBioPage(pageData);
              expect(page.username).toBe(username);
            }

            // Invalid usernames should be rejected
            for (const username of invalidUsernames) {
              const pageData = {
                username,
                userId: userId + '-invalid',
                title,
                theme: 'default' as const,
                isPublic: true
              };

              await expect(bioPageService.createBioPage(pageData)).rejects.toThrow('invalid characters or format');
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain username index consistency', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            operations: fc.array(
              fc.oneof(
                fc.record({
                  type: fc.constant('create'),
                  username: fc.string({ minLength: 3, maxLength: 20 })
                    .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                                !s.startsWith('-') && !s.startsWith('_') &&
                                !s.endsWith('-') && !s.endsWith('_') &&
                                !/[_-]{2,}/.test(s)),
                  userId: fc.string({ minLength: 1, maxLength: 20 })
                }),
                fc.record({
                  type: fc.constant('update'),
                  pageIndex: fc.integer({ min: 0, max: 10 }),
                  newUsername: fc.string({ minLength: 3, maxLength: 20 })
                    .filter(s => /^[a-zA-Z0-9_-]+$/.test(s) && 
                                !s.startsWith('-') && !s.startsWith('_') &&
                                !s.endsWith('-') && !s.endsWith('_') &&
                                !/[_-]{2,}/.test(s))
                }),
                fc.record({
                  type: fc.constant('delete'),
                  pageIndex: fc.integer({ min: 0, max: 10 })
                })
              ),
              { minLength: 5, maxLength: 15 }
            )
          }),
          async ({ operations }) => {
            const createdPages: BioPage[] = [];

            for (const operation of operations) {
              try {
                if (operation.type === 'create') {
                  const pageData = {
                    username: operation.username,
                    userId: operation.userId,
                    title: 'Test Page',
                    theme: 'default' as const,
                    isPublic: true
                  };

                  const page = await bioPageService.createBioPage(pageData);
                  createdPages.push(page);
                } else if (operation.type === 'update' && operation.pageIndex < createdPages.length) {
                  const pageToUpdate = createdPages[operation.pageIndex];
                  if (pageToUpdate) {
                    const updatedPage = await bioPageService.updateBioPage(pageToUpdate.id, {
                      username: operation.newUsername
                    });
                    createdPages[operation.pageIndex] = updatedPage;
                  }
                } else if (operation.type === 'delete' && operation.pageIndex < createdPages.length) {
                  const pageToDelete = createdPages[operation.pageIndex];
                  if (pageToDelete) {
                    await bioPageService.deleteBioPage(pageToDelete.id);
                    createdPages.splice(operation.pageIndex, 1);
                  }
                }
              } catch (error) {
                // Expected errors for duplicate usernames, etc.
                // Continue with next operation
              }
            }

            // Verify consistency: all remaining pages should be retrievable by username
            for (const page of createdPages) {
              if (page) {
                const retrieved = bioPageService.getBioPageByUsername(page.username);
                expect(retrieved).toBeTruthy();
                expect(retrieved!.id).toBe(page.id);
                expect(retrieved!.username).toBe(page.username);
              }
            }

            // Verify no orphaned usernames in index
            const allUsernames = bioPageService.getAllUsernames();
            const allPages = bioPageService.getAllBioPages();
            const pageUsernames = allPages.map(p => p.username.toLowerCase());
            
            expect(allUsernames.sort()).toEqual(pageUsernames.sort());
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});