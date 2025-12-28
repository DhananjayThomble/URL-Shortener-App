import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { LinkTag } from '../entities/link-tag.entity';

@Injectable()
export class LinkTagRepository {
  constructor(
    @InjectRepository(LinkTag)
    private readonly linkTagRepository: Repository<LinkTag>,
  ) {}

  async createAssociation(linkId: string, tagId: string): Promise<LinkTag> {
    const linkTag = this.linkTagRepository.create({
      linkId,
      tagId,
    });

    return await this.linkTagRepository.save(linkTag);
  }

  async createMultipleAssociations(linkId: string, tagIds: string[]): Promise<LinkTag[]> {
    const linkTags = tagIds.map((tagId) =>
      this.linkTagRepository.create({
        linkId,
        tagId,
      }),
    );

    return await this.linkTagRepository.save(linkTags);
  }

  async findAssociation(linkId: string, tagId: string): Promise<LinkTag | null> {
    return await this.linkTagRepository.findOne({
      where: { linkId, tagId },
    });
  }

  async findAssociationsForLink(linkId: string): Promise<LinkTag[]> {
    return await this.linkTagRepository.find({
      where: { linkId },
      relations: ['tag'],
    });
  }

  async findAssociationsForTag(tagId: string): Promise<LinkTag[]> {
    return await this.linkTagRepository.find({
      where: { tagId },
      relations: ['link'],
    });
  }

  async removeAssociation(linkId: string, tagId: string): Promise<boolean> {
    const result = await this.linkTagRepository.delete({ linkId, tagId });
    return result.affected > 0;
  }

  async removeMultipleAssociations(linkId: string, tagIds: string[]): Promise<number> {
    const result = await this.linkTagRepository.delete({
      linkId,
      tagId: In(tagIds),
    });
    return result.affected || 0;
  }

  async removeAllAssociationsForLink(linkId: string): Promise<number> {
    const result = await this.linkTagRepository.delete({ linkId });
    return result.affected || 0;
  }

  async removeAllAssociationsForTag(tagId: string): Promise<number> {
    const result = await this.linkTagRepository.delete({ tagId });
    return result.affected || 0;
  }

  async getTagIdsForLink(linkId: string): Promise<string[]> {
    const associations = await this.linkTagRepository.find({
      where: { linkId },
      select: ['tagId'],
    });

    return associations.map((association) => association.tagId);
  }

  async getLinkIdsForTag(tagId: string): Promise<string[]> {
    const associations = await this.linkTagRepository.find({
      where: { tagId },
      select: ['linkId'],
    });

    return associations.map((association) => association.linkId);
  }

  async getLinkIdsForTags(tagIds: string[]): Promise<string[]> {
    const associations = await this.linkTagRepository.find({
      where: { tagId: In(tagIds) },
      select: ['linkId'],
    });

    // Remove duplicates
    const uniqueLinkIds = Array.from(new Set(associations.map((association) => association.linkId)));
    return uniqueLinkIds;
  }

  async checkAssociationExists(linkId: string, tagId: string): Promise<boolean> {
    const association = await this.findAssociation(linkId, tagId);
    return !!association;
  }

  async bulkCreateAssociations(associations: { linkId: string; tagId: string }[]): Promise<LinkTag[]> {
    const linkTags = associations.map((association) =>
      this.linkTagRepository.create(association),
    );

    return await this.linkTagRepository.save(linkTags);
  }
}