import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { LinkTagRepository } from '../repositories/link-tag.repository';
import { TagRepository } from '../repositories/tag.repository';
import { LinkRepository } from '../repositories/link.repository';
import { TagsService } from './tags.service';
import {
  AssignTagsToLinkDto,
  RemoveTagsFromLinkDto,
  UpdateLinkTagsDto,
  FilterLinksByTagsDto,
} from '../dto/tag-link-operations.dto';
import { TagResponseDto } from '../dto/tag-response.dto';
import { Link } from '../entities/link.entity';

@Injectable()
export class TagAssociationService {
  constructor(
    private readonly linkTagRepository: LinkTagRepository,
    private readonly tagRepository: TagRepository,
    private readonly linkRepository: LinkRepository,
    private readonly tagsService: TagsService,
  ) {}

  async assignTagsToLink(
    userId: string,
    linkId: string,
    assignTagsDto: AssignTagsToLinkDto,
  ): Promise<TagResponseDto[]> {
    // Validate link exists and belongs to user
    const link = await this.linkRepository.findByUserIdAndId(userId, linkId);
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    // Validate all tags exist and belong to user
    await this.tagsService.validateTagsExist(userId, assignTagsDto.tagIds);

    // Check for existing associations to avoid duplicates
    const existingTagIds = await this.linkTagRepository.getTagIdsForLink(linkId);
    const newTagIds = assignTagsDto.tagIds.filter((tagId) => !existingTagIds.includes(tagId));

    if (newTagIds.length === 0) {
      throw new ConflictException('All specified tags are already assigned to this link');
    }

    // Create new associations
    await this.linkTagRepository.createMultipleAssociations(linkId, newTagIds);

    // Return all tags for the link
    return await this.tagsService.getTagsForLink(linkId);
  }

  async removeTagsFromLink(
    userId: string,
    linkId: string,
    removeTagsDto: RemoveTagsFromLinkDto,
  ): Promise<TagResponseDto[]> {
    // Validate link exists and belongs to user
    const link = await this.linkRepository.findByUserIdAndId(userId, linkId);
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    // Validate all tags exist and belong to user
    await this.tagsService.validateTagsExist(userId, removeTagsDto.tagIds);

    // Check if associations exist
    const existingTagIds = await this.linkTagRepository.getTagIdsForLink(linkId);
    const tagsToRemove = removeTagsDto.tagIds.filter((tagId) => existingTagIds.includes(tagId));

    if (tagsToRemove.length === 0) {
      throw new BadRequestException('None of the specified tags are assigned to this link');
    }

    // Remove associations
    await this.linkTagRepository.removeMultipleAssociations(linkId, tagsToRemove);

    // Return remaining tags for the link
    return await this.tagsService.getTagsForLink(linkId);
  }

  async updateLinkTags(
    userId: string,
    linkId: string,
    updateTagsDto: UpdateLinkTagsDto,
  ): Promise<TagResponseDto[]> {
    // Validate link exists and belongs to user
    const link = await this.linkRepository.findByUserIdAndId(userId, linkId);
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    // Validate all tags exist and belong to user
    if (updateTagsDto.tagIds.length > 0) {
      await this.tagsService.validateTagsExist(userId, updateTagsDto.tagIds);
    }

    // Remove all existing associations
    await this.linkTagRepository.removeAllAssociationsForLink(linkId);

    // Create new associations if any tags specified
    if (updateTagsDto.tagIds.length > 0) {
      await this.linkTagRepository.createMultipleAssociations(linkId, updateTagsDto.tagIds);
    }

    // Return all tags for the link
    return await this.tagsService.getTagsForLink(linkId);
  }

  async getTagsForLink(userId: string, linkId: string): Promise<TagResponseDto[]> {
    // Validate link exists and belongs to user
    const link = await this.linkRepository.findByUserIdAndId(userId, linkId);
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    return await this.tagsService.getTagsForLink(linkId);
  }

  async filterLinksByTags(
    userId: string,
    filterDto: FilterLinksByTagsDto,
  ): Promise<Link[]> {
    let tagIds: string[] = [];

    // Get tag IDs from tag names if provided
    if (filterDto.tagNames && filterDto.tagNames.length > 0) {
      const tagsByName: string[] = [];
      for (const tagName of filterDto.tagNames) {
        const tag = await this.tagRepository.findByUserIdAndName(userId, tagName);
        if (tag) {
          tagsByName.push(tag.id);
        }
      }
      tagIds = [...tagIds, ...tagsByName];
    }

    // Add tag IDs if provided
    if (filterDto.tagIds && filterDto.tagIds.length > 0) {
      // Validate tags belong to user
      await this.tagsService.validateTagsExist(userId, filterDto.tagIds);
      tagIds = [...tagIds, ...filterDto.tagIds];
    }

    // Remove duplicates
    tagIds = Array.from(new Set(tagIds));

    if (tagIds.length === 0) {
      return [];
    }

    // Get link IDs that have any of the specified tags
    const linkIds = await this.linkTagRepository.getLinkIdsForTags(tagIds);

    if (linkIds.length === 0) {
      return [];
    }

    // Get the actual links
    return await this.linkRepository.findByUserIdAndIds(userId, linkIds);
  }

  async removeTagAssociationsOnTagDelete(tagId: string): Promise<void> {
    await this.linkTagRepository.removeAllAssociationsForTag(tagId);
  }

  async removeTagAssociationsOnLinkDelete(linkId: string): Promise<void> {
    await this.linkTagRepository.removeAllAssociationsForLink(linkId);
  }

  async getLinkCountForTag(tagId: string): Promise<number> {
    const linkIds = await this.linkTagRepository.getLinkIdsForTag(tagId);
    return linkIds.length;
  }

  async bulkAssignTagsToLinks(
    userId: string,
    linkIds: string[],
    tagIds: string[],
  ): Promise<void> {
    // Validate all links exist and belong to user
    for (const linkId of linkIds) {
      const link = await this.linkRepository.findByUserIdAndId(userId, linkId);
      if (!link) {
        throw new NotFoundException(`Link with ID ${linkId} not found`);
      }
    }

    // Validate all tags exist and belong to user
    await this.tagsService.validateTagsExist(userId, tagIds);

    // Create associations for all combinations
    const associations: { linkId: string; tagId: string }[] = [];
    for (const linkId of linkIds) {
      for (const tagId of tagIds) {
        // Check if association already exists
        const exists = await this.linkTagRepository.checkAssociationExists(linkId, tagId);
        if (!exists) {
          associations.push({ linkId, tagId });
        }
      }
    }

    if (associations.length > 0) {
      await this.linkTagRepository.bulkCreateAssociations(associations);
    }
  }
}