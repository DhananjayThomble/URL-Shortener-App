/**
 * Property-based tests for tag deletion cascade
 * Tests Property 15: Tag Deletion Cascade
 * Validates Requirements 5.5
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

interface Link {
  id: string;
  userId: string;
  originalUrl: string;
  shortCode: string;
  createdAt: Date;
}

// Mock tag deletion cascade service
class MockTagDeletionCascadeService {
  private tags = new Map<string, Tag>();
  private links = new Map<string, Link>();
  private linkTags = new Map<string, LinkTag[]>(); // linkId -> LinkTag[]
  private tagStats = new Map<string, { usageCount: number; lastUsed: Date }>();

  async createTag(data: Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Tag> {
    const tag: Tag = {
      ...data,
      id: `tag_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tags.set(tag.id, tag);
    this.tagStats.set(tag.id, { usageCount: 0, lastUsed: new Date() });
    return tag;
  }

  async createLink(data: Omit<Link, 'id' | 'createdAt'>): Promise<Link> {
    const link: Link = {
      ...data,
      id: `link_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
    };

    this.links.set(link.id, link);
    this.linkTags.set(link.id, []);
    return link;
  }

  async addTagToLink(linkId: string, tagId: string, userId: string): Promise<LinkTag | null> {
    const tag = this.tags.get(tagId);
    const link = this.links.get(linkId);
    
    if (!tag || !link || tag.userId !== userId || link.userId !== userId) {
      return null;
    }

    // Check if association already exists
    const linkTagList = this.linkTags.get(linkId) || [];
    if (linkTagList.some(lt => lt.tagId === tagId)) {
      return null;
    }

    const linkTag: LinkTag = {
      id: `linktag_${Math.random().toString(36).substr(2, 9)}`,
      linkId,
      tagId,
      createdAt: new Date(),
    };

    linkTagList.push(linkTag);
    this.linkTags.set(linkId, linkTagList);

    // Update tag stats
    const stats = this.tagStats.get(tagId)!;
    stats.usageCount++;
    stats.lastUsed = new Date();

    return linkTag;
  }
  async deleteTagWithCascade(tagId: string, userId: string): Promise<{
    success: boolean;
    deletedAssociations: number;
    affectedLinks: string[];
    orphanedLinks: string[];
  }> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return { success: false, deletedAssociations: 0, affectedLinks: [], orphanedLinks: [] };
    }

    const affectedLinks: string[] = [];
    const orphanedLinks: string[] = [];
    let deletedAssociations = 0;

    // Find all links using this tag
    for (const [linkId, linkTagList] of this.linkTags.entries()) {
      const hasTag = linkTagList.some(lt => lt.tagId === tagId);
      if (hasTag) {
        affectedLinks.push(linkId);
        
        // Remove the tag association
        const filteredLinkTags = linkTagList.filter(lt => lt.tagId !== tagId);
        deletedAssociations++;
        
        // Check if link becomes orphaned (no tags left)
        if (filteredLinkTags.length === 0) {
          orphanedLinks.push(linkId);
        }
        
        this.linkTags.set(linkId, filteredLinkTags);
      }
    }

    // Delete the tag
    this.tags.delete(tagId);
    this.tagStats.delete(tagId);

    return {
      success: true,
      deletedAssociations,
      affectedLinks,
      orphanedLinks,
    };
  }

  async bulkDeleteTags(tagIds: string[], userId: string): Promise<{
    successfulDeletes: string[];
    failedDeletes: string[];
    totalAssociationsDeleted: number;
    totalAffectedLinks: string[];
    totalOrphanedLinks: string[];
  }> {
    const successfulDeletes: string[] = [];
    const failedDeletes: string[] = [];
    let totalAssociationsDeleted = 0;
    const totalAffectedLinks = new Set<string>();
    const totalOrphanedLinks = new Set<string>();

    for (const tagId of tagIds) {
      const result = await this.deleteTagWithCascade(tagId, userId);
      
      if (result.success) {
        successfulDeletes.push(tagId);
        totalAssociationsDeleted += result.deletedAssociations;
        result.affectedLinks.forEach(linkId => totalAffectedLinks.add(linkId));
        result.orphanedLinks.forEach(linkId => totalOrphanedLinks.add(linkId));
      } else {
        failedDeletes.push(tagId);
      }
    }

    return {
      successfulDeletes,
      failedDeletes,
      totalAssociationsDeleted,
      totalAffectedLinks: Array.from(totalAffectedLinks),
      totalOrphanedLinks: Array.from(totalOrphanedLinks),
    };
  }

  async getTagUsageStats(tagId: string, userId: string): Promise<{
    usageCount: number;
    lastUsed: Date;
    associatedLinks: string[];
  } | null> {
    const tag = this.tags.get(tagId);
    if (!tag || tag.userId !== userId) {
      return null;
    }

    const stats = this.tagStats.get(tagId)!;
    const associatedLinks: string[] = [];

    for (const [linkId, linkTagList] of this.linkTags.entries()) {
      if (linkTagList.some(lt => lt.tagId === tagId)) {
        associatedLinks.push(linkId);
      }
    }

    return {
      usageCount: stats.usageCount,
      lastUsed: stats.lastUsed,
      associatedLinks,
    };
  }

  async getOrphanedLinks(userId: string): Promise<string[]> {
    const orphanedLinks: string[] = [];

    for (const [linkId, link] of this.links.entries()) {
      if (link.userId === userId) {
        const linkTagList = this.linkTags.get(linkId) || [];
        if (linkTagList.length === 0) {
          orphanedLinks.push(linkId);
        }
      }
    }

    return orphanedLinks.sort();
  }

  // Test helper methods
  getAllTags(): Tag[] {
    return Array.from(this.tags.values());
  }

  getAllLinks(): Link[] {
    return Array.from(this.links.values());
  }

  getAllLinkTags(): LinkTag[] {
    const allLinkTags: LinkTag[] = [];
    for (const linkTagList of this.linkTags.values()) {
      allLinkTags.push(...linkTagList);
    }
    return allLinkTags;
  }

  getTagById(id: string): Tag | undefined {
    return this.tags.get(id);
  }

  getLinkById(id: string): Link | undefined {
    return this.links.get(id);
  }

  getTagsForLink(linkId: string): Tag[] {
    const linkTagList = this.linkTags.get(linkId) || [];
    const tagIds = linkTagList.map(lt => lt.tagId);
    return Array.from(this.tags.values()).filter(tag => tagIds.includes(tag.id));
  }
}

describe('Tag Deletion Cascade Properties', () => {
  let cascadeService: MockTagDeletionCascadeService;

  beforeEach(() => {
    cascadeService = new MockTagDeletionCascadeService();
  });

  /**
   * Property 15: Tag Deletion Cascade
   * Validates Requirements 5.5
   */
  describe('Property 15: Tag Deletion Cascade', () => {
    it('should cascade delete all tag associations when tag is deleted', async () => {
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
              fc.record({
                originalUrl: fc.webUrl(),
                shortCode: fc.string({ minLength: 5, maxLength: 10 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
            associations: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 4 }),
                tagIndex: fc.integer({ min: 0, max: 4 }),
              }),
              { minLength: 1, maxLength: 15 }
            ),
            tagToDelete: fc.integer({ min: 0, max: 4 })
          }),
          async ({ userId, tags, links, associations, tagToDelete }) => {
            // Create tags and links
            const createdTags: Tag[] = [];
            const createdLinks: Link[] = [];

            for (const tagData of tags) {
              const tag = await cascadeService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId,
              });
              createdTags.push(tag);
            }

            for (const linkData of links) {
              const link = await cascadeService.createLink({
                originalUrl: linkData.originalUrl,
                shortCode: linkData.shortCode,
                userId,
              });
              createdLinks.push(link);
            }

            // Create associations
            const expectedAssociations = new Map<string, Set<string>>();
            for (const assoc of associations) {
              const linkIndex = assoc.linkIndex % createdLinks.length;
              const tagIndex = assoc.tagIndex % createdTags.length;
              const linkId = createdLinks[linkIndex].id;
              const tagId = createdTags[tagIndex].id;

              await cascadeService.addTagToLink(linkId, tagId, userId);
              
              const linkAssocs = expectedAssociations.get(linkId) || new Set();
              linkAssocs.add(tagId);
              expectedAssociations.set(linkId, linkAssocs);
            }

            // Delete a tag
            const tagIndexToDelete = tagToDelete % createdTags.length;
            const tagToDeleteId = createdTags[tagIndexToDelete].id;

            // Count expected deletions
            let expectedDeletions = 0;
            const expectedAffectedLinks: string[] = [];
            for (const [linkId, tagIds] of expectedAssociations.entries()) {
              if (tagIds.has(tagToDeleteId)) {
                expectedDeletions++;
                expectedAffectedLinks.push(linkId);
              }
            }

            const deleteResult = await cascadeService.deleteTagWithCascade(tagToDeleteId, userId);

            expect(deleteResult.success).toBe(true);
            expect(deleteResult.deletedAssociations).toBe(expectedDeletions);
            expect(deleteResult.affectedLinks.sort()).toEqual(expectedAffectedLinks.sort());

            // Verify tag is deleted
            expect(cascadeService.getTagById(tagToDeleteId)).toBeUndefined();

            // Verify all associations with deleted tag are removed
            const remainingLinkTags = cascadeService.getAllLinkTags();
            for (const linkTag of remainingLinkTags) {
              expect(linkTag.tagId).not.toBe(tagToDeleteId);
            }

            // Verify other associations remain intact
            for (const [linkId, expectedTagIds] of expectedAssociations.entries()) {
              const actualTags = cascadeService.getTagsForLink(linkId);
              const actualTagIds = new Set(actualTags.map(t => t.id));
              
              const expectedRemainingTagIds = new Set(
                Array.from(expectedTagIds).filter(id => id !== tagToDeleteId)
              );
              
              expect(actualTagIds).toEqual(expectedRemainingTagIds);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should identify orphaned links after tag deletion', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            tags: fc.array(
              fc.record({
                name: fc.string({ minLength: 1, maxLength: 50 }),
                color: fc.hexaString({ minLength: 6, maxLength: 6 }),
              }),
              { minLength: 1, maxLength: 3 }
            ),
            links: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                shortCode: fc.string({ minLength: 5, maxLength: 10 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
            singleTagLinks: fc.array(
              fc.integer({ min: 0, max: 4 }),
              { minLength: 0, maxLength: 3 }
            )
          }),
          async ({ userId, tags, links, singleTagLinks }) => {
            // Create tags and links
            const createdTags: Tag[] = [];
            const createdLinks: Link[] = [];

            for (const tagData of tags) {
              const tag = await cascadeService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId,
              });
              createdTags.push(tag);
            }

            for (const linkData of links) {
              const link = await cascadeService.createLink({
                originalUrl: linkData.originalUrl,
                shortCode: linkData.shortCode,
                userId,
              });
              createdLinks.push(link);
            }

            // Create links that have only one tag (will become orphaned)
            const linksWithSingleTag = new Set<string>();
            for (const linkIndex of singleTagLinks) {
              if (linkIndex < createdLinks.length && createdTags.length > 0) {
                const linkId = createdLinks[linkIndex].id;
                const tagId = createdTags[0].id; // Use first tag
                
                await cascadeService.addTagToLink(linkId, tagId, userId);
                linksWithSingleTag.add(linkId);
              }
            }

            // Delete the first tag (which will orphan the single-tag links)
            if (createdTags.length > 0) {
              const deleteResult = await cascadeService.deleteTagWithCascade(createdTags[0].id, userId);
              
              expect(deleteResult.success).toBe(true);
              
              // Verify orphaned links are correctly identified
              const expectedOrphanedLinks = Array.from(linksWithSingleTag).sort();
              expect(deleteResult.orphanedLinks.sort()).toEqual(expectedOrphanedLinks);
              
              // Verify orphaned links query
              const orphanedLinks = await cascadeService.getOrphanedLinks(userId);
              expect(orphanedLinks).toEqual(expectedOrphanedLinks);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should handle bulk tag deletion with proper cascade', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            tags: fc.array(
              fc.record({
                name: fc.string({ minLength: 1, maxLength: 50 }),
                color: fc.hexaString({ minLength: 6, maxLength: 6 }),
              }),
              { minLength: 3, maxLength: 6 }
            ),
            links: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                shortCode: fc.string({ minLength: 5, maxLength: 10 }),
              }),
              { minLength: 2, maxLength: 4 }
            ),
            associations: fc.array(
              fc.record({
                linkIndex: fc.integer({ min: 0, max: 3 }),
                tagIndex: fc.integer({ min: 0, max: 5 }),
              }),
              { minLength: 3, maxLength: 12 }
            ),
            tagsToDelete: fc.array(
              fc.integer({ min: 0, max: 5 }),
              { minLength: 1, maxLength: 3 }
            )
          }),
          async ({ userId, tags, links, associations, tagsToDelete }) => {
            // Create tags and links
            const createdTags: Tag[] = [];
            const createdLinks: Link[] = [];

            for (const tagData of tags) {
              const tag = await cascadeService.createTag({
                name: tagData.name,
                color: tagData.color,
                userId,
              });
              createdTags.push(tag);
            }

            for (const linkData of links) {
              const link = await cascadeService.createLink({
                originalUrl: linkData.originalUrl,
                shortCode: linkData.shortCode,
                userId,
              });
              createdLinks.push(link);
            }

            // Create associations
            for (const assoc of associations) {
              const linkIndex = assoc.linkIndex % createdLinks.length;
              const tagIndex = assoc.tagIndex % createdTags.length;
              const linkId = createdLinks[linkIndex].id;
              const tagId = createdTags[tagIndex].id;

              await cascadeService.addTagToLink(linkId, tagId, userId);
            }

            // Bulk delete tags
            const uniqueTagIndices = [...new Set(tagsToDelete.map(i => i % createdTags.length))];
            const tagIdsToDelete = uniqueTagIndices.map(i => createdTags[i].id);

            const bulkDeleteResult = await cascadeService.bulkDeleteTags(tagIdsToDelete, userId);

            expect(bulkDeleteResult.successfulDeletes.sort()).toEqual(tagIdsToDelete.sort());
            expect(bulkDeleteResult.failedDeletes).toHaveLength(0);

            // Verify all specified tags are deleted
            for (const tagId of tagIdsToDelete) {
              expect(cascadeService.getTagById(tagId)).toBeUndefined();
            }

            // Verify no associations remain with deleted tags
            const remainingLinkTags = cascadeService.getAllLinkTags();
            for (const linkTag of remainingLinkTags) {
              expect(tagIdsToDelete).not.toContain(linkTag.tagId);
            }

            // Verify remaining tags are intact
            const remainingTags = cascadeService.getAllTags();
            const remainingTagIds = remainingTags.map(t => t.id);
            for (const tagId of remainingTagIds) {
              expect(tagIdsToDelete).not.toContain(tagId);
            }
          }
        ),
        { numRuns: 15 }
      );
    });

    it('should track tag usage statistics correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            tagData: fc.record({
              name: fc.string({ minLength: 1, maxLength: 50 }),
              color: fc.hexaString({ minLength: 6, maxLength: 6 }),
            }),
            links: fc.array(
              fc.record({
                originalUrl: fc.webUrl(),
                shortCode: fc.string({ minLength: 5, maxLength: 10 }),
              }),
              { minLength: 1, maxLength: 5 }
            ),
            linkAssociations: fc.array(
              fc.integer({ min: 0, max: 4 }),
              { minLength: 0, maxLength: 5 }
            )
          }),
          async ({ userId, tagData, links, linkAssociations }) => {
            // Create tag and links
            const tag = await cascadeService.createTag({
              name: tagData.name,
              color: tagData.color,
              userId,
            });

            const createdLinks: Link[] = [];
            for (const linkData of links) {
              const link = await cascadeService.createLink({
                originalUrl: linkData.originalUrl,
                shortCode: linkData.shortCode,
                userId,
              });
              createdLinks.push(link);
            }

            // Associate tag with links
            const associatedLinkIds = new Set<string>();
            for (const linkIndex of linkAssociations) {
              if (linkIndex < createdLinks.length) {
                const linkId = createdLinks[linkIndex].id;
                const result = await cascadeService.addTagToLink(linkId, tag.id, userId);
                if (result) {
                  associatedLinkIds.add(linkId);
                }
              }
            }

            // Check usage statistics
            const stats = await cascadeService.getTagUsageStats(tag.id, userId);
            expect(stats).toBeTruthy();
            expect(stats!.usageCount).toBe(associatedLinkIds.size);
            expect(stats!.associatedLinks.sort()).toEqual(Array.from(associatedLinkIds).sort());

            // Delete tag and verify stats are cleaned up
            const deleteResult = await cascadeService.deleteTagWithCascade(tag.id, userId);
            expect(deleteResult.success).toBe(true);

            const deletedStats = await cascadeService.getTagUsageStats(tag.id, userId);
            expect(deletedStats).toBeNull();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain referential integrity during cascade operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            userId: fc.string({ minLength: 1, maxLength: 20 }),
            operations: fc.array(
              fc.oneof(
                fc.record({
                  type: fc.constant('createTag'),
                  name: fc.string({ minLength: 1, maxLength: 50 }),
                  color: fc.hexaString({ minLength: 6, maxLength: 6 }),
                }),
                fc.record({
                  type: fc.constant('createLink'),
                  originalUrl: fc.webUrl(),
                  shortCode: fc.string({ minLength: 5, maxLength: 10 }),
                }),
                fc.record({
                  type: fc.constant('addAssociation'),
                  linkIndex: fc.integer({ min: 0, max: 9 }),
                  tagIndex: fc.integer({ min: 0, max: 9 }),
                }),
                fc.record({
                  type: fc.constant('deleteTag'),
                  tagIndex: fc.integer({ min: 0, max: 9 }),
                })
              ),
              { minLength: 5, maxLength: 20 }
            )
          }),
          async ({ userId, operations }) => {
            const createdTags: Tag[] = [];
            const createdLinks: Link[] = [];

            for (const operation of operations) {
              switch (operation.type) {
                case 'createTag':
                  const tag = await cascadeService.createTag({
                    name: operation.name,
                    color: operation.color,
                    userId,
                  });
                  createdTags.push(tag);
                  break;

                case 'createLink':
                  const link = await cascadeService.createLink({
                    originalUrl: operation.originalUrl,
                    shortCode: operation.shortCode,
                    userId,
                  });
                  createdLinks.push(link);
                  break;

                case 'addAssociation':
                  if (createdLinks.length > 0 && createdTags.length > 0) {
                    const linkIndex = operation.linkIndex % createdLinks.length;
                    const tagIndex = operation.tagIndex % createdTags.length;
                    const linkId = createdLinks[linkIndex].id;
                    const tagId = createdTags[tagIndex].id;
                    
                    await cascadeService.addTagToLink(linkId, tagId, userId);
                  }
                  break;

                case 'deleteTag':
                  if (createdTags.length > 0) {
                    const tagIndex = operation.tagIndex % createdTags.length;
                    const tagToDelete = createdTags[tagIndex];
                    
                    await cascadeService.deleteTagWithCascade(tagToDelete.id, userId);
                    createdTags.splice(tagIndex, 1);
                  }
                  break;
              }

              // Verify referential integrity after each operation
              const allLinkTags = cascadeService.getAllLinkTags();
              const allTags = cascadeService.getAllTags();
              const allLinks = cascadeService.getAllLinks();
              
              const existingTagIds = new Set(allTags.map(t => t.id));
              const existingLinkIds = new Set(allLinks.map(l => l.id));

              // All link-tag associations should reference existing tags and links
              for (const linkTag of allLinkTags) {
                expect(existingTagIds.has(linkTag.tagId)).toBe(true);
                expect(existingLinkIds.has(linkTag.linkId)).toBe(true);
              }
            }
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});