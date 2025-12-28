import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { TagRepository } from '../repositories/tag.repository';
import { CreateTagDto } from '../dto/create-tag.dto';
import { UpdateTagDto } from '../dto/update-tag.dto';
import { TagResponseDto } from '../dto/tag-response.dto';
import { Tag } from '../entities/tag.entity';

@Injectable()
export class TagsService {
  constructor(private readonly tagRepository: TagRepository) {}

  async createTag(userId: string, createTagDto: CreateTagDto): Promise<TagResponseDto> {
    // Validate name uniqueness for the user (case-insensitive)
    const isNameUnique = await this.tagRepository.checkNameUniquenessForUser(
      userId,
      createTagDto.name,
    );

    if (!isNameUnique) {
      throw new ConflictException(
        `Tag with name '${createTagDto.name}' already exists for this user`,
      );
    }

    // Validate color format if provided
    if (createTagDto.color && !/^#[0-9A-Fa-f]{6}$/.test(createTagDto.color)) {
      throw new BadRequestException('Color must be a valid hex color code (e.g., #6366f1)');
    }

    const tag = await this.tagRepository.create(userId, createTagDto);
    return this.mapTagToResponse(tag);
  }

  async getUserTags(userId: string, includeLinkCount = false): Promise<TagResponseDto[]> {
    if (includeLinkCount) {
      const tagsWithCount = await this.tagRepository.findAllByUserIdWithLinkCount(userId);
      return tagsWithCount.map((tag: any) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        createdAt: tag.createdAt,
        linkCount: tag.linkCount,
      }));
    }

    const tags = await this.tagRepository.findAllByUserId(userId);
    return tags.map((tag) => this.mapTagToResponse(tag));
  }

  async getTagById(userId: string, tagId: string): Promise<TagResponseDto> {
    const tag = await this.tagRepository.findByUserIdAndId(userId, tagId);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    return this.mapTagToResponse(tag);
  }

  async updateTag(
    userId: string,
    tagId: string,
    updateTagDto: UpdateTagDto,
  ): Promise<TagResponseDto> {
    // Check if tag exists
    const existingTag = await this.tagRepository.findByUserIdAndId(userId, tagId);
    if (!existingTag) {
      throw new NotFoundException('Tag not found');
    }

    // Validate name uniqueness if name is being updated
    if (updateTagDto.name && updateTagDto.name !== existingTag.name) {
      const isNameUnique = await this.tagRepository.checkNameUniquenessForUser(
        userId,
        updateTagDto.name,
        tagId,
      );

      if (!isNameUnique) {
        throw new ConflictException(
          `Tag with name '${updateTagDto.name}' already exists for this user`,
        );
      }
    }

    // Validate color format if provided
    if (updateTagDto.color && !/^#[0-9A-Fa-f]{6}$/.test(updateTagDto.color)) {
      throw new BadRequestException('Color must be a valid hex color code (e.g., #6366f1)');
    }

    const updatedTag = await this.tagRepository.update(userId, tagId, updateTagDto);
    if (!updatedTag) {
      throw new NotFoundException('Tag not found');
    }

    return this.mapTagToResponse(updatedTag);
  }

  async deleteTag(userId: string, tagId: string): Promise<void> {
    const tag = await this.tagRepository.findByUserIdAndId(userId, tagId);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }

    const deleted = await this.tagRepository.delete(userId, tagId);
    if (!deleted) {
      throw new NotFoundException('Tag not found');
    }
  }

  async getTagsForLink(linkId: string): Promise<TagResponseDto[]> {
    const tags = await this.tagRepository.findTagsForLink(linkId);
    return tags.map((tag) => this.mapTagToResponse(tag));
  }

  async validateTagExists(userId: string, tagId: string): Promise<Tag> {
    const tag = await this.tagRepository.findByUserIdAndId(userId, tagId);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }

  async validateTagsExist(userId: string, tagIds: string[]): Promise<Tag[]> {
    const tags: Tag[] = [];
    for (const tagId of tagIds) {
      const tag = await this.validateTagExists(userId, tagId);
      tags.push(tag);
    }
    return tags;
  }

  private mapTagToResponse(tag: Tag): TagResponseDto {
    return {
      id: tag.id,
      name: tag.name,
      color: tag.color,
      createdAt: tag.createdAt,
    };
  }
}