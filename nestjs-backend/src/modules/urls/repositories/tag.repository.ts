import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Tag } from '../entities/tag.entity';
import { CreateTagDto } from '../dto/create-tag.dto';
import { UpdateTagDto } from '../dto/update-tag.dto';

@Injectable()
export class TagRepository {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  async create(userId: string, createTagDto: CreateTagDto): Promise<Tag> {
    const tag = this.tagRepository.create({
      ...createTagDto,
      userId,
      color: createTagDto.color || '#6366f1',
    });

    return await this.tagRepository.save(tag);
  }

  async findByUserIdAndName(userId: string, name: string): Promise<Tag | null> {
    return await this.tagRepository.findOne({
      where: { userId, name },
    });
  }

  async findByUserIdAndId(userId: string, id: string): Promise<Tag | null> {
    return await this.tagRepository.findOne({
      where: { userId, id },
    });
  }

  async findAllByUserId(userId: string): Promise<Tag[]> {
    return await this.tagRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAllByUserIdWithLinkCount(userId: string): Promise<any[]> {
    return await this.tagRepository
      .createQueryBuilder('tag')
      .leftJoin('tag.linkTags', 'linkTag')
      .leftJoin('linkTag.link', 'link')
      .where('tag.userId = :userId', { userId })
      .andWhere('(link.isActive = true OR link.id IS NULL)')
      .select([
        'tag.id',
        'tag.name',
        'tag.color',
        'tag.createdAt',
        'COUNT(DISTINCT link.id) as linkCount',
      ])
      .groupBy('tag.id, tag.name, tag.color, tag.createdAt')
      .orderBy('tag.createdAt', 'DESC')
      .getRawMany()
      .then((results) =>
        results.map((result) => ({
          id: result.tag_id,
          name: result.tag_name,
          color: result.tag_color,
          createdAt: result.tag_createdAt,
          linkCount: parseInt(result.linkCount, 10),
        })),
      );
  }

  async update(userId: string, id: string, updateTagDto: UpdateTagDto): Promise<Tag | null> {
    const tag = await this.findByUserIdAndId(userId, id);
    if (!tag) {
      return null;
    }

    Object.assign(tag, updateTagDto);
    return await this.tagRepository.save(tag);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.tagRepository.delete({ userId, id });
    return result.affected > 0;
  }

  async findTagsForLink(linkId: string): Promise<Tag[]> {
    return await this.tagRepository
      .createQueryBuilder('tag')
      .innerJoin('tag.linkTags', 'linkTag')
      .where('linkTag.linkId = :linkId', { linkId })
      .orderBy('tag.name', 'ASC')
      .getMany();
  }

  async checkNameUniquenessForUser(userId: string, name: string, excludeId?: string): Promise<boolean> {
    const queryBuilder = this.tagRepository
      .createQueryBuilder('tag')
      .where('tag.userId = :userId', { userId })
      .andWhere('LOWER(tag.name) = LOWER(:name)', { name });

    if (excludeId) {
      queryBuilder.andWhere('tag.id != :excludeId', { excludeId });
    }

    const existingTag = await queryBuilder.getOne();
    return !existingTag;
  }
}