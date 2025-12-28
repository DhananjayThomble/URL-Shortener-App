import { Repository, SelectQueryBuilder, FindManyOptions, FindOneOptions } from 'typeorm';
import { QueryOptimizationService, QueryCacheOptions } from '../services/query-optimization.service';
import { Logger } from '@nestjs/common';

export abstract class OptimizedBaseRepository<T> {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly repository: Repository<T>,
    protected readonly queryOptimizationService: QueryOptimizationService,
  ) {}

  /**
   * Find with query optimization and caching
   */
  async findOptimized(
    options: FindManyOptions<T>,
    cacheOptions: QueryCacheOptions = {},
  ): Promise<T[]> {
    const queryBuilder = this.repository.createQueryBuilder();
    this.applyFindOptions(queryBuilder, options);
    
    return this.queryOptimizationService.executeOptimizedQuery(queryBuilder, cacheOptions);
  }

  /**
   * Find one with query optimization and caching
   */
  async findOneOptimized(
    options: FindOneOptions<T>,
    cacheOptions: QueryCacheOptions = {},
  ): Promise<T | null> {
    const queryBuilder = this.repository.createQueryBuilder();
    this.applyFindOneOptions(queryBuilder, options);
    
    const results = await this.queryOptimizationService.executeOptimizedQuery(
      queryBuilder,
      cacheOptions,
    );
    
    return results[0] || null;
  }

  /**
   * Execute paginated query with optimization
   */
  async findPaginatedOptimized(
    queryBuilder: SelectQueryBuilder<T>,
    page: number,
    limit: number,
    cacheOptions: QueryCacheOptions = {},
  ): Promise<{ data: T[]; total: number; page: number; limit: number; totalPages: number }> {
    // Clone query builder for count query
    const countQueryBuilder = queryBuilder.clone();
    
    // Get total count
    const total = await countQueryBuilder.getCount();
    
    // Apply pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);
    
    // Execute optimized query
    const data = await this.queryOptimizationService.executeOptimizedQuery(
      queryBuilder,
      cacheOptions,
    );
    
    const totalPages = Math.ceil(total / limit);
    
    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Execute query with automatic retry on failure
   */
  async executeWithRetry<R>(
    operation: () => Promise<R>,
    maxRetries: number = 3,
    delay: number = 1000,
  ): Promise<R> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Query attempt ${attempt} failed:`, error);
        
        if (attempt < maxRetries) {
          await this.sleep(delay * attempt); // Exponential backoff
        }
      }
    }
    
    throw lastError!;
  }

  /**
   * Bulk insert with optimization
   */
  async bulkInsertOptimized(entities: Partial<T>[], batchSize: number = 1000): Promise<void> {
    const batches = this.chunkArray(entities, batchSize);
    
    for (const batch of batches) {
      await this.repository
        .createQueryBuilder()
        .insert()
        .values(batch)
        .execute();
    }
    
    this.logger.log(`Bulk inserted ${entities.length} entities in ${batches.length} batches`);
  }

  /**
   * Bulk update with optimization
   */
  async bulkUpdateOptimized(
    criteria: any,
    updateData: Partial<T>,
    batchSize: number = 1000,
  ): Promise<number> {
    const queryBuilder = this.repository
      .createQueryBuilder()
      .update()
      .set(updateData)
      .where(criteria);
    
    const result = await queryBuilder.execute();
    
    this.logger.log(`Bulk updated ${result.affected || 0} entities`);
    return result.affected || 0;
  }

  /**
   * Get query builder with common optimizations
   */
  protected createOptimizedQueryBuilder(alias?: string): SelectQueryBuilder<T> {
    const queryBuilder = this.repository.createQueryBuilder(alias);
    
    // Add common optimizations
    queryBuilder.cache(true); // Enable query result caching
    
    return queryBuilder;
  }

  /**
   * Add indexes for common query patterns
   */
  protected async ensureIndexes(indexes: Array<{ columns: string[]; unique?: boolean }>): Promise<void> {
    const queryRunner = this.repository.manager.connection.createQueryRunner();
    
    try {
      await queryRunner.connect();
      
      for (const index of indexes) {
        const indexName = `idx_${this.repository.metadata.tableName}_${index.columns.join('_')}`;
        const columnsStr = index.columns.join(', ');
        const uniqueStr = index.unique ? 'UNIQUE' : '';
        
        try {
          await queryRunner.query(`
            CREATE ${uniqueStr} INDEX CONCURRENTLY IF NOT EXISTS ${indexName}
            ON ${this.repository.metadata.tableName} (${columnsStr})
          `);
          
          this.logger.log(`Ensured index: ${indexName}`);
        } catch (error) {
          this.logger.warn(`Failed to create index ${indexName}:`, error);
        }
      }
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Apply find options to query builder
   */
  private applyFindOptions(queryBuilder: SelectQueryBuilder<T>, options: FindManyOptions<T>): void {
    if (options.where) {
      queryBuilder.where(options.where);
    }
    
    if (options.order) {
      Object.entries(options.order).forEach(([key, direction]) => {
        queryBuilder.addOrderBy(key, direction as 'ASC' | 'DESC');
      });
    }
    
    if (options.take) {
      queryBuilder.take(options.take);
    }
    
    if (options.skip) {
      queryBuilder.skip(options.skip);
    }
    
    if (options.relations) {
      options.relations.forEach(relation => {
        queryBuilder.leftJoinAndSelect(`${queryBuilder.alias}.${relation}`, relation);
      });
    }
  }

  /**
   * Apply find one options to query builder
   */
  private applyFindOneOptions(queryBuilder: SelectQueryBuilder<T>, options: FindOneOptions<T>): void {
    if (options.where) {
      queryBuilder.where(options.where);
    }
    
    if (options.order) {
      Object.entries(options.order).forEach(([key, direction]) => {
        queryBuilder.addOrderBy(key, direction as 'ASC' | 'DESC');
      });
    }
    
    if (options.relations) {
      options.relations.forEach(relation => {
        queryBuilder.leftJoinAndSelect(`${queryBuilder.alias}.${relation}`, relation);
      });
    }
    
    queryBuilder.take(1);
  }

  /**
   * Chunk array into smaller batches
   */
  private chunkArray<U>(array: U[], size: number): U[][] {
    const chunks: U[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}