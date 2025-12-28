import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, In } from 'typeorm';
import { Link } from '../entities/link.entity';
import { OptimizedBaseRepository } from '../../../common/repositories/optimized-base.repository';
import { QueryOptimizationService } from '../../../common/services/query-optimization.service';
import { CacheKeyBuilder, CacheConfigs } from '../../../common/decorators/cache.decorator';

@Injectable()
export class LinkRepository extends OptimizedBaseRepository<Link> {
  constructor(
    @InjectRepository(Link)
    private readonly linkRepository: Repository<Link>,
    queryOptimizationService: QueryOptimizationService,
  ) {
    super(linkRepository, queryOptimizationService);
    this.ensureOptimalIndexes();
  }

  async create(linkData: Partial<Link>): Promise<Link> {
    const link = this.linkRepository.create(linkData);
    return this.linkRepository.save(link);
  }

  async findById(id: string): Promise<Link | null> {
    const cacheKey = CacheKeyBuilder.userData(id);
    return this.findOneOptimized(
      {
        where: { id },
        relations: ['geoRules', 'linkTags', 'linkTags.tag'],
      },
      { ...CacheConfigs.URL_RESOLUTION, enabled: true },
    );
  }

  async findByShortCode(shortCode: string): Promise<Link | null> {
    const cacheKey = CacheKeyBuilder.urlResolution(shortCode);
    return this.findOneOptimized(
      {
        where: { shortCode, isActive: true },
        relations: ['geoRules'],
      },
      { ...CacheConfigs.URL_RESOLUTION, enabled: true },
    );
  }

  async findByCustomAlias(customAlias: string): Promise<Link | null> {
    return this.findOneOptimized(
      {
        where: { customAlias },
      },
      { ...CacheConfigs.URL_RESOLUTION, enabled: true },
    );
  }

  async findByUserId(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ links: Link[]; total: number }> {
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .leftJoinAndSelect('link.linkTags', 'linkTags')
      .leftJoinAndSelect('linkTags.tag', 'tag')
      .where('link.userId = :userId', { userId })
      .orderBy('link.createdAt', 'DESC');

    const result = await this.findPaginatedOptimized(
      queryBuilder,
      page,
      limit,
      { ...CacheConfigs.USER_DATA, enabled: true },
    );

    return { links: result.data, total: result.total };
  }

  async findActiveByShortCode(shortCode: string): Promise<Link | null> {
    const now = new Date();
    
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .leftJoinAndSelect('link.geoRules', 'geoRules')
      .where('link.shortCode = :shortCode', { shortCode })
      .andWhere('link.isActive = :isActive', { isActive: true })
      .andWhere(
        '(link.expiresAt IS NULL OR link.expiresAt > :now)',
        { now }
      );

    const results = await this.queryOptimizationService.executeOptimizedQuery(
      queryBuilder,
      { ...CacheConfigs.URL_RESOLUTION, enabled: true },
    );

    return results[0] || null;
  }

  async findByUserIdAndCategory(
    userId: string,
    category: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{ links: Link[]; total: number }> {
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .leftJoinAndSelect('link.linkTags', 'linkTags')
      .leftJoinAndSelect('linkTags.tag', 'tag')
      .where('link.userId = :userId', { userId })
      .andWhere('tag.name = :category', { category })
      .orderBy('link.createdAt', 'DESC');

    const result = await this.findPaginatedOptimized(
      queryBuilder,
      page,
      limit,
      { ...CacheConfigs.USER_DATA, enabled: true },
    );

    return { links: result.data, total: result.total };
  }

  async findByUserIdAndTags(
    userId: string,
    tagNames: string[],
    page: number = 1,
    limit: number = 10,
  ): Promise<{ links: Link[]; total: number }> {
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .leftJoinAndSelect('link.linkTags', 'linkTags')
      .leftJoinAndSelect('linkTags.tag', 'tag')
      .where('link.userId = :userId', { userId })
      .andWhere('tag.name IN (:...tagNames)', { tagNames })
      .orderBy('link.createdAt', 'DESC');

    const result = await this.findPaginatedOptimized(
      queryBuilder,
      page,
      limit,
      { ...CacheConfigs.USER_DATA, enabled: true },
    );

    return { links: result.data, total: result.total };
  }

  async findPopularByUserId(userId: string, limit: number = 10): Promise<Link[]> {
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .leftJoinAndSelect('link.linkTags', 'linkTags')
      .leftJoinAndSelect('linkTags.tag', 'tag')
      .where('link.userId = :userId', { userId })
      .andWhere('link.isActive = :isActive', { isActive: true })
      .orderBy('link.visitCount', 'DESC')
      .take(limit);

    return this.queryOptimizationService.executeOptimizedQuery(
      queryBuilder,
      { ...CacheConfigs.POPULAR_URLS, enabled: true },
    );
  }

  async update(id: string, updateData: Partial<Link>): Promise<Link> {
    await this.linkRepository.update(id, updateData);
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    await this.linkRepository.delete(id);
  }

  async incrementVisitCount(id: string): Promise<void> {
    await this.linkRepository.increment({ id }, 'visitCount', 1);
  }

  async findExpiredLinks(): Promise<Link[]> {
    const now = new Date();
    
    const queryBuilder = this.createOptimizedQueryBuilder('link')
      .where('link.expiresAt < :now', { now })
      .andWhere('link.isActive = :isActive', { isActive: true });

    return this.queryOptimizationService.executeOptimizedQuery(queryBuilder);
  }

  async deactivateExpiredLinks(): Promise<number> {
    const now = new Date();
    
    const result = await this.linkRepository
      .createQueryBuilder()
      .update(Link)
      .set({ isActive: false })
      .where('expiresAt < :now', { now })
      .andWhere('isActive = :isActive', { isActive: true })
      .execute();

    return result.affected || 0;
  }

  async isShortCodeAvailable(shortCode: string): Promise<boolean> {
    const count = await this.linkRepository.count({
      where: { shortCode },
    });
    return count === 0;
  }

  async isCustomAliasAvailable(customAlias: string): Promise<boolean> {
    const count = await this.linkRepository.count({
      where: { customAlias },
    });
    return count === 0;
  }

  async findByUserIdAndId(userId: string, id: string): Promise<Link | null> {
    return this.findOneOptimized(
      {
        where: { userId, id },
        relations: ['geoRules', 'linkTags', 'linkTags.tag'],
      },
      { ...CacheConfigs.USER_DATA, enabled: true },
    );
  }

  async findByUserIdAndIds(userId: string, ids: string[]): Promise<Link[]> {
    return this.findOptimized(
      {
        where: { userId, id: In(ids) },
        relations: ['linkTags', 'linkTags.tag'],
        order: { createdAt: 'DESC' },
      },
      { ...CacheConfigs.USER_DATA, enabled: true },
    );
  }

  /**
   * Ensure optimal indexes for link queries
   */
  private async ensureOptimalIndexes(): Promise<void> {
    await this.ensureIndexes([
      { columns: ['short_code'], unique: true },
      { columns: ['custom_alias'], unique: true },
      { columns: ['user_id', 'created_at'] },
      { columns: ['user_id', 'is_active'] },
      { columns: ['expires_at'] },
      { columns: ['visit_count'] },
      { columns: ['is_active', 'expires_at'] },
    ]);
  }
}