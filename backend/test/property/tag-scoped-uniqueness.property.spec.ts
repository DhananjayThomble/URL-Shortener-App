/**
 * Property-based tests for tag management scoped uniqueness
 * Tests Property 14: Tag Management Scoped Uniqueness
 * Validates Requirements 5.1, 5.3
 */

import * as fc from 'fast-check';

interface Tag {
  id: string;
  name: string;
  color: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface LinkTag {
  id: string;
  linkId: string;
  tagId: string;
  createdAt: Date;
}

// Mock tag scoped uniqueness service
class MockTagScopedUniquenessService {
  private tags = new Map<string, Tag>();
  private linkTags = new Map<string, LinkTag[]>(); // linkId -> LinkTag[]
  private userTagNames = new Map<string, Set<string>>(); // userId -> Set<tagName>

  async createTag(data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tag | null> {
    // Check scoped uniqueness - tag name must be unique per user
    const userTags = this.userTagNames.get(data.userId) || new Set();
    if (userTags.has(data.name.toLowerCase())) {
      return null; // Tag name already exists for this user
    }

    const tag: Tag = {
      ...data,
      id: `tag_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tags.set(tag.id, tag);
    userTags.add(data.name.toLowerCase());
    this.userTagNames.set(data.userId, userTags);

    return tag;
  }

  async updateTag(tagId: string, updates: Partial<Pick<Tag, 'name' | 'color'>>, userId: string): Promise<Tag | null> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return null;
    }

    // If updating name, check scoped uniqueness
    if (updates.name && updates.name !== tag.name) {
      const userTags = this.userTagNames.get(userId) || new Set();
      if (userTags.has(updates.name.toLowerCase())) {
        return null; // New name already exists for this user
      }

      // Remove old name and add new name
      userTags.delete(tag.name.toLowerCase());
      userTags.add(updates.name.toLowerCase());
      this.userTagNames.set(userId, userTags);
    }

    const updatedTag: Tag = {
      ...tag,
      ...updates,
      updatedAt: new Date(),
    };

    this.tags.set(tagId, updatedTag);
    return updatedTag;
  }

  async deleteTag(tagId: string, userId: string): Promise<boolean> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return false;
    }

    // Remove from user tag names
    const userTags = this.userTagNames.get(userId) || new Set();
    userTags.delete(tag.name.toLowerCase());
    this.userTagNames.set(userId, userTags);

    // Remove tag
    this.tags.delete(tagId);

    // Remove all link associations
    for (const [linkId, linkTagList] of this.linkTags.entries()) {
      const filteredLinkTags = linkTagList.filter(lt => lt.tagId !== tagId);
      if (filteredLinkTags.length !== linkTagList.length) {
        this.linkTags.set(linkId, filteredLinkTags);
      }
    }

    return true;
  }

  async addTagToLink(linkId: string, tagId: string, userId: string): Promise<LinkTag | null> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return null;
    }

    // Check if association already exists
    const linkTagList = this.linkTags.get(linkId) || [];
    if (linkTagList.some(lt => lt.tagId === tagId)) {
      return null; // Association already exists
    }

    const linkTag: LinkTag = {
      id: `linktag_${Math.random().toString(36).substr(2, 9)}`,
      linkId,
      tagId,
      createdAt: new Date(),
    };

    linkTagList.push(linkTag);
    this.linkTags.set(linkId, linkTagList);

    return linkTag;
  }

  async removeTagFromLink(linkId: string, tagId: string, userId: string): Promise<boolean> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return false;
    }

    const linkTagList = this.linkTags.get(linkId) || [];
    const filteredLinkTags = linkTagList.filter(lt => lt.tagId !== tagId);
    
    if (filteredLinkTags.length === linkTagList.length) {
      return false; // Association didn't exist
    }

    this.linkTags.set(linkId, filteredLinkTags);
    return true;
  }

  async getUserTags(userId: string): Promise<Tag[]> {
    return Array.from(this.tags.values())
      .filter(tag => tag.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTagsForLink(linkId: string, userId: string): Promise<Tag[]> {
    const linkTagList = this.linkTags.get(linkId) || [];
    const tagIds = linkTagList.map(lt => lt.tagId);
    
    return Array.from(this.tags.values())
      .filter(tag => tag.userId === userId && tagIds.includes(tag.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getLinksWithTag(tagId: string, userId: string): Promise<string[]> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return [];
    }

    const linkIds: string[] = [];
    for (const [linkId, linkTagList] of this.linkTags.entries()) {
      if (linkTagList.some(lt => lt.tagId === tagId)) {
        linkIds.push(linkId);
      }
    }

    return linkIds.sort();
  }

  // Test helper methods
  getAllTags(): Tag[] {
    return Array.from(this.tags.values());
  }

  getTagById(id: string): Tag | undefined {
    return this.tags.get(id);
  }

  getUserTagNames(userId: string): string[] {
    const userTags = this.userTagNames.get(userId) || new Set();
    return Array.from(userTags).sort();
  }

  getAllLinkTags(): LinkTag[] {
    const allLinkTags: LinkTag[] = [];
    for (const linkTagList of this.linkTags.values()) {
      allLinkTags.push(...linkTagList);
    }
    return allLinkTags;
  }
}

describe('Tag Scoped Uniqueness Properties', () => {
  let tagService: MockTagScopedUniquenessService;

  beforeEach(() => {
    tagService = new MockTagScopedUniquenessService();
  });

  /**
   * Property 14: Tag Management Scoped Uniqueness
   * Validates Requirements 5.1, 5.3
   */
  describe('Property 14: Tag Management Scoped Uniqueness', () => {
    it('should enforce tag name uniqueness within user scope', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            users: fc.array(
              fc.record({
                userId: fc.string({ minLength: 1, maxLength: 20 }),
                tags: fc.array(
                  fc.record({
                    name: fc.string({ minLength: 1, maxLength: 50 }),
                    color: fc.hexaString({ minLength: 6, maxLength: 6 }),
                  }),
                  { minLength: 1, maxLength: 10 }
                )
              }),
              { minLength: 1, maxLength: 5 }
            )
          }),
          async ({ users }) => {
            // Ensure unique user IDs
            const uniqueUserIds = [...new Set(users.map(u => u.userId))];
            fc.pre(uniqueUserIds.length === users.length);

            for (const user of users) {
              const createdTags: Tag[] = [];
              const attemptedNames = new Set<string>();

              for (const tagData of user.tags) {
                const normalizedName = tagData.name.toLowerCase();
                const tag = await tagService.createTag({
                  name: tagData.name,
                  color: tagData.color,
                  userId: user.userId,
                });

                if (attemptedNames.has(normalizedName)) {
                  // Duplicate name within same user - should fail
                  expect(tag).toBeNull();
                } else {
                  // First occurrence of this name for this user - should succeed
                  expect(tag).toBeTruthy();
                  if (tag) {
                    createdTags.push(tag);
                    attemptedNames.add(normalizedName);
                  }
                }
              }

              // Verify user's tags are unique
              const userTags = await tagService.getUserTags(user.userId);
              const tagNames = userTags.map(t => t.name.toLowerCase());
              const uniqueTagNames = [...new Set(tagNames)];
              expect(tagNames).toHaveLength(uniqueTagNames.length);
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    it('should allow same tag names across different users', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            tagName: fc.string({ minLength: 1, maxLength: 50 }),
            color: fc.hexaString({ minLength: 6, maxLength: 6 }),
            users: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 2, maxLength: 5 }
            )
          }),
          async ({ tagName, color, users }) => {
            // Ensure unique user IDs
            const uniqueUsers = [...new Set(users)];
            fc.pre(uniqueUsers.length === users.length && uniqueUsers.length >= 2);

            const createdTags: Tag[] = [];

            // Each user should be able to create a tag with the same name
            for (const userId of uniqueUsers) {
              const tag = await tagService.createTag({
                name: tagName,
                color: color,
                userId: userId,
              });

              expect(tag).toBeTruthy();
              expect(tag!.name).toBe(tagName);
              expect(tag!.userId).toBe(userId);
              createdTags.push(tag!);
            }

            // Verify all tags were created successfully
            expect(createdTags).toHaveLength(uniqueUsers.length);

            // Verify each user has their own tag with the same name
            for (const userId of uniqueUsers) {
              const userTags = await tagService.getUserTags(userId);
              expect(userTags).toHaveLength(1);
              expect(userTags[0].name).toBe(tagName);
              expect(userTags[0].userId).toBe(userId);
            }
          }
        ),
        { numRuns: 25 }
      );
    });

    it('should handle tag name updates with uniqueness constraints', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            initialTags: fc.array(
              fc.record({
                name: fc.string({ minLength: 1, maxLength: 50 }),
                color: fc.hexaString({ minLength: 6, maxLength: 6 }),
              }),
              { minLength: 2, maxLength: 5 }
            ),
            updates: fc.array(
              fc.record({
                tagIndex: fc.integer({ min: 0, max: 4 }),
                newName: fc.string({ minLength: 1, maxLength: 50 }),
                newColor: fc.option(fc.hexaString({ minLength: 6, maxLength: 6 })),
              }),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ userId, initialTags, updates }) => {
            // Ensure unique initial tag names
            const uniqueNames = [...new Set(initialTags.map(t => t.name.toLowerCase()))];
            fc.pre(uniqueNames.length === initialTags.length);

            // Create initial tags
            const createdTags: Tag[] = [];
            for (const tagData of initialTags) {
              const tag = await tagService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId: userId,
              });
              expect(tag).toBeTruthy();
              createdTags.push(tag!);
            }

            // Apply updates
            for (const update of updates) {
              const tagIndex = update.tagIndex % createdTags.length;
              const targetTag = createdTags[tagIndex];
              
              const updateData: Partial<Pick<Tag, 'name' | 'color'>> = {};
              if (update.newName) updateData.name = update.newName;
              if (update.newColor) updateData.color = update.newColor;

              const updatedTag = await tagService.updateTag(targetTag.id, updateData, userId);

              // Check if update should succeed or fail
              const currentTagNames = createdTags.map(t => t.name.toLowerCase());
              const wouldConflict = update.newName && 
                                  update.newName.toLowerCase() !== targetTag.name.toLowerCase() &&
                                  currentTagNames.includes(update.newName.toLowerCase());

              if (wouldConflict) {
                expect(updatedTag).toBeNull();
              } else {
                expect(updatedTag).toBeTruthy();
                if (updatedTag) {
                  // Update our local reference
                  createdTags[tagIndex] = updatedTag;
                }
              }
            }

            // Verify final state maintains uniqueness
            const finalTags = await tagService.getUserTags(userId);
            const finalNames = finalTags.map(t => t.name.toLowerCase());
            const uniqueFinalNames = [...new Set(finalNames)];
            expect(finalNames).toHaveLength(uniqueFinalNames.length);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain tag-link associations correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            tags: fc.array(
              fc.record({
                name: fc.string({ minLength: 1, maxLength: 50 }),
                color: fc.hexaString({ minLength: 6, maxLength: 6 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
            links: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 1, maxLength: 5 }
            ),
            associations: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 4 }),
                tagIndex: fc.integer({ min: 0, max: 4 }),
              }),
              { minLength: 1, maxLength: 10 }
            )
          }),
          async ({ userId, tags, links, associations }) => {
            // Ensure unique tag names and link IDs
            const uniqueTagNames = [...new Set(tags.map(t => t.name.toLowerCase()))];
            const uniqueLinks = [...new Set(links)];
            fc.pre(uniqueTagNames.length === tags.length && uniqueLinks.length === links.length);

            // Create tags
            const createdTags: Tag[] = [];
            for (const tagData of tags) {
              const tag = await tagService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId: userId,
              });
              expect(tag).toBeTruthy();
              createdTags.push(tag!);
            }

            // Track expected associations
            const expectedAssociations = new Map<string, Set<string>>(); // linkId -> Set<tagId>

            // Create associations
            for (const assoc of associations) {
              const linkIndex = assoc.linkIndex % uniqueLinks.length;
              const tagIndex = assoc.tagIndex % createdTags.length;
              const linkId = uniqueLinks[linkIndex];
              const tagId = createdTags[tagIndex].id;

              const linkTag = await tagService.addTagToLink(linkId, tagId, userId);

              const linkAssociations = expectedAssociations.get(linkId) || new Set();
              if (linkAssociations.has(tagId)) {
                // Duplicate association - should fail
                expect(linkTag).toBeNull();
              } else {
                // New association - should succeed
                expect(linkTag).toBeTruthy();
                linkAssociations.add(tagId);
                expectedAssociations.set(linkId, linkAssociations);
              }
            }

            // Verify associations
            for (const [linkId, expectedTagIds] of expectedAssociations.entries()) {
              const linkTags = await tagService.getTagsForLink(linkId, userId);
              const actualTagIds = new Set(linkTags.map(t => t.id));
              
              expect(actualTagIds.size).toBe(expectedTagIds.size);
              for (const tagId of expectedTagIds) {
                expect(actualTagIds.has(tagId)).toBe(true);
              }
            }

            // Verify reverse associations
            for (const tag of createdTags) {
              const linksWithTag = await tagService.getLinksWithTag(tag.id, userId);
              const expectedLinks = Array.from(expectedAssociations.entries())
                .filter(([, tagIds]) => tagIds.has(tag.id))
                .map(([linkId]) => linkId)
                .sort();
              
              expect(linksWithTag).toEqual(expectedLinks);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle tag deletion with cascade cleanup', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            tags: fc.array(
              fc.record({
                name: fc.string({ minLength: 1, maxLength: 50 }),
                color: fc.hexaString({ minLength: 6, maxLength: 6 }),
              }),
              { minLength: 2, maxLength: 5 }
            ),
            links: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 1, maxLength: 3 }
            ),
            associations: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 2 }),
                tagIndex: fc.integer({ min: 0, max: 4 }),
              }),
              { minLength: 1, maxLength: 8 }
            ),
            tagToDelete: fc.integer({ min: 0, max: 4 })
          }),
          async ({ userId, tags, links, associations, tagToDelete }) => {
            // Ensure unique tag names and link IDs
            const uniqueTagNames = [...new Set(tags.map(t => t.name.toLowerCase()))];
            const uniqueLinks = [...new Set(links)];
            fc.pre(uniqueTagNames.length === tags.length && uniqueLinks.length === links.length);

            // Create tags
            const createdTags: Tag[] = [];
            for (const tagData of tags) {
              const tag = await tagService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId: userId,
              });
              expect(tag).toBeTruthy();
              createdTags.push(tag!);
            }

            // Create associations
            for (const assoc of associations) {
              const linkIndex = assoc.linkIndex % uniqueLinks.length;
              const tagIndex = assoc.tagIndex % createdTags.length;
              const linkId = uniqueLinks[linkIndex];
              const tagId = createdTags[tagIndex].id;

              await tagService.addTagToLink(linkId, tagId, userId);
            }

            // Delete a tag
            const tagIndexToDelete = tagToDelete % createdTags.length;
            const tagToDeleteId = createdTags[tagIndexToDelete].id;
            const tagToDeleteName = createdTags[tagIndexToDelete].name;

            const deleteResult = await tagService.deleteTag(tagToDeleteId, userId);
            expect(deleteResult).toBe(true);

            // Verify tag is deleted
            const remainingTags = await tagService.getUserTags(userId);
            expect(remainingTags).toHaveLength(createdTags.length - 1);
            expect(remainingTags.find(t => t.id === tagToDeleteId)).toBeUndefined();

            // Verify tag name is available again
            const recreatedTag = await tagService.createTag({
              name: tagToDeleteName,
              color: 'FF0000',
              userId: userId,
            });
            expect(recreatedTag).toBeTruthy();

            // Verify all associations with deleted tag are removed
            for (const linkId of uniqueLinks) {
              const linkTags = await tagService.getTagsForLink(linkId, userId);
              expect(linkTags.find(t => t.id === tagToDeleteId)).toBeUndefined();
            }

            // Verify other associations remain intact
            const allLinkTags = tagService.getAllLinkTags();
            for (const linkTag of allLinkTags) {
              expect(linkTag.tagId).not.toBe(tagToDeleteId);
            }
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should enforce access control for tag operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            ownerUserId: fc.string({ minLength: 1, maxLength: 20 }),
            unauthorizedUsers: fc.array(
              fc.string({ minLength: 1, maxLength: 20 }),
              { minLength: 1, maxLength: 3 }
            ),
            tagData: fc.record({
              name: fc.string({ minLength: 1, maxLength: 50 }),
              color: fc.hexaString({ minLength: 6, maxLength: 6 }),
            }),
            linkId: fc.string({ minLength: 1, maxLength: 20 })
          }),
          async ({ ownerUserId, unauthorizedUsers, tagData, linkId }) => {
            // Ensure unauthorized users are different from owner
            const filteredUnauthorizedUsers = unauthorizedUsers.filter(u => u !== ownerUserId);
            fc.pre(filteredUnauthorizedUsers.length > 0);

            // Owner creates a tag
            const tag = await tagService.createTag({
              name: tagData.name,
              color: tagData.color,
              userId: ownerUserId,
            });
            expect(tag).toBeTruthy();

            // Test unauthorized operations
            for (const unauthorizedUserId of filteredUnauthorizedUsers) {
              // Cannot update tag
              const updateResult = await tagService.updateTag(
                tag!.id, 
                { name: 'unauthorized-update' }, 
                unauthorizedUserId
              );
              expect(updateResult).toBeNull();

              // Cannot delete tag
              const deleteResult = await tagService.deleteTag(tag!.id, unauthorizedUserId);
              expect(deleteResult).toBe(false);

              // Cannot add tag to link
              const addResult = await tagService.addTagToLink(linkId, tag!.id, unauthorizedUserId);
              expect(addResult).toBeNull();

              // Cannot remove tag from link
              const removeResult = await tagService.removeTagFromLink(linkId, tag!.id, unauthorizedUserId);
              expect(removeResult).toBe(false);

              // Cannot get links with tag
              const linksResult = await tagService.getLinksWithTag(tag!.id, unauthorizedUserId);
              expect(linksResult).toEqual([]);
            }

            // Verify tag remains unchanged
            const unchangedTag = tagService.getTagById(tag!.id);
            expect(unchangedTag).toBeTruthy();
            expect(unchangedTag!.name).toBe(tagData.name);
            expect(unchangedTag!.userId).toBe(ownerUserId);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});