import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner, SelectQueryBuilder } from 'typeorm';
import { CachingService } from './caching.service';
import { ConfigService } from '@nestjs/config';

export interface QueryAnalysis {
  query: string;
  executionTime: number;
  rowsExamined: number;
  rowsReturned: number;
  indexesUsed: string[];
  suggestions: string[];
  isSlow: boolean;
}

export interface QueryCacheOptions {
  ttl?: number;
  tags?: string[];
  enabled?: boolean;
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  reason: string;
  estimatedImprovement: string;
}

@Injectable()
export class QueryOptimizationService {
  private readonly logger = new Logger(QueryOptimizationService.name);
  private readonly slowQueryThreshold: number;
  private readonly queryCache = new Map<string, any>();
  private readonly queryStats = new Map<string, { count: number; totalTime: number; avgTime: number }>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cachingService: CachingService,
    private readonly configService: ConfigService,
  ) {
    this.slowQueryThreshold = parseInt(
      this.configService.get('SLOW_QUERY_THRESHOLD_MS', '1000'),
      10,
    );
  }

  /**
   * Execute query with optimization and caching
   */
  async executeOptimizedQuery<T>(
    queryBuilder: SelectQueryBuilder<T>,
    cacheOptions: QueryCacheOptions = {},
  ): Promise<T[]> {
    const query = queryBuilder.getQuery();
    const parameters = queryBuilder.getParameters();
    const cacheKey = this.generateCacheKey(query, parameters);

    // Check cache first if enabled
    if (cacheOptions.enabled !== false) {
      const cached = await this.getCachedQuery<T[]>(cacheKey);
      if (cached) {
        this.logger.debug(`Query cache hit: ${cacheKey}`);
        return cached;
      }
    }

    // Execute query with timing
    const startTime = Date.now();
    let result: T[];
    
    try {
      result = await queryBuilder.getMany();
      const executionTime = Date.now() - startTime;

      // Log slow queries
      if (executionTime > this.slowQueryThreshold) {
        await this.logSlowQuery(query, parameters, executionTime);
      }

      // Update query statistics
      this.updateQueryStats(query, executionTime);

      // Cache result if enabled
      if (cacheOptions.enabled !== false) {
        await this.cacheQuery(cacheKey, result, cacheOptions);
      }

      return result;
    } catch (error) {
      this.logger.error(`Query execution failed: ${query}`, error);
      throw error;
    }
  }

  /**
   * Analyze query performance
   */
  async analyzeQuery(query: string, parameters: any[] = []): Promise<QueryAnalysis> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      
      // Execute EXPLAIN ANALYZE for PostgreSQL
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
      const startTime = Date.now();
      
      const explainResult = await queryRunner.query(explainQuery, parameters);
      const executionTime = Date.now() - startTime;
      
      const plan = explainResult[0]['QUERY PLAN'][0];
      
      return {
        query,
        executionTime,
        rowsExamined: this.extractRowsExamined(plan),
        rowsReturned: plan['Actual Rows'] || 0,
        indexesUsed: this.extractIndexesUsed(plan),
        suggestions: this.generateOptimizationSuggestions(plan),
        isSlow: executionTime > this.slowQueryThreshold,
      };
    } catch (error) {
      this.logger.error('Query analysis failed:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get query statistics
   */
  getQueryStats(): Map<string, { count: number; totalTime: number; avgTime: number }> {
    return new Map(this.queryStats);
  }

  /**
   * Get slow queries from the last period
   */
  async getSlowQueries(limit: number = 10): Promise<QueryAnalysis[]> {
    try {
      // Query PostgreSQL's pg_stat_statements if available
      const slowQueries = await this.dataSource.query(`
        SELECT 
          query,
          calls,
          total_exec_time,
          mean_exec_time,
          rows
        FROM pg_stat_statements 
        WHERE mean_exec_time > $1
        ORDER BY mean_exec_time DESC 
        LIMIT $2
      `, [this.slowQueryThreshold, limit]);

      return slowQueries.map((row: any) => ({
        query: row.query,
        executionTime: row.mean_exec_time,
        rowsExamined: row.rows,
        rowsReturned: row.rows,
        indexesUsed: [],
        suggestions: [],
        isSlow: true,
      }));
    } catch (error) {
      this.logger.warn('Could not retrieve slow queries from pg_stat_statements:', error);
      return [];
    }
  }

  /**
   * Generate index recommendations
   */
  async generateIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];

    try {
      // Analyze missing indexes based on slow queries
      const slowQueries = await this.getSlowQueries(20);
      
      for (const slowQuery of slowQueries) {
        const queryRecommendations = this.analyzeQueryForIndexes(slowQuery.query);
        recommendations.push(...queryRecommendations);
      }

      // Add common index recommendations for URL shortener
      recommendations.push(
        {
          table: 'links',
          columns: ['user_id', 'created_at'],
          type: 'btree',
          reason: 'Optimize user link listing with date ordering',
          estimatedImprovement: '50-80% faster user link queries',
        },
        {
          table: 'links',
          columns: ['short_code'],
          type: 'btree',
          reason: 'Optimize URL resolution lookups',
          estimatedImprovement: '90% faster URL resolution',
        },
        {
          table: 'links',
          columns: ['user_id', 'is_active'],
          type: 'btree',
          reason: 'Optimize active link filtering',
          estimatedImprovement: '60% faster active link queries',
        },
        {
          table: 'click_events',
          columns: ['link_id', 'clicked_at'],
          type: 'btree',
          reason: 'Optimize analytics queries by link and time',
          estimatedImprovement: '70% faster analytics aggregation',
        },
        {
          table: 'link_tags',
          columns: ['link_id', 'tag_id'],
          type: 'btree',
          reason: 'Optimize tag-based filtering',
          estimatedImprovement: '80% faster tag filtering',
        },
      );

      return this.deduplicateRecommendations(recommendations);
    } catch (error) {
      this.logger.error('Failed to generate index recommendations:', error);
      return [];
    }
  }

  /**
   * Create recommended indexes
   */
  async createRecommendedIndexes(recommendations: IndexRecommendation[]): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      for (const recommendation of recommendations) {
        try {
          const indexName = `idx_${recommendation.table}_${recommendation.columns.join('_')}`;
          const columnsStr = recommendation.columns.join(', ');
          
          const createIndexQuery = `
            CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} 
            ON ${recommendation.table} USING ${recommendation.type} (${columnsStr})
          `;
          
          await queryRunner.query(createIndexQuery);
          this.logger.log(`Created index: ${indexName}`);
        } catch (error) {
          this.logger.warn(`Failed to create index for ${recommendation.table}:`, error);
        }
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Failed to create indexes:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Optimize database configuration
   */
  async optimizeDatabaseConfig(): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    
    try {
      await queryRunner.connect();

      // Update PostgreSQL configuration for better performance
      const optimizations = [
        "SET shared_preload_libraries = 'pg_stat_statements'",
        "SET track_activity_query_size = 2048",
        "SET pg_stat_statements.track = 'all'",
        "SET log_min_duration_statement = 1000", // Log queries > 1s
        "SET log_checkpoints = on",
        "SET log_connections = on",
        "SET log_disconnections = on",
        "SET log_lock_waits = on",
      ];

      for (const optimization of optimizations) {
        try {
          await queryRunner.query(optimization);
        } catch (error) {
          this.logger.warn(`Failed to apply optimization: ${optimization}`, error);
        }
      }

      this.logger.log('Database configuration optimized');
    } catch (error) {
      this.logger.error('Failed to optimize database configuration:', error);
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Clear query cache
   */
  async clearQueryCache(): Promise<void> {
    this.queryCache.clear();
    await this.cachingService.deletePattern('query:*');
    this.logger.log('Query cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    const cacheStats = this.cachingService.getStats();
    return {
      size: this.queryCache.size,
      hitRate: cacheStats.hitRate,
    };
  }

  /**
   * Generate cache key for query
   */
  private generateCacheKey(query: string, parameters: any): string {
    const paramStr = JSON.stringify(parameters);
    const hash = this.hashString(`${query}:${paramStr}`);
    return `query:${hash}`;
  }

  /**
   * Get cached query result
   */
  private async getCachedQuery<T>(cacheKey: string): Promise<T | null> {
    // Check in-memory cache first
    if (this.queryCache.has(cacheKey)) {
      return this.queryCache.get(cacheKey);
    }

    // Check Redis cache
    return await this.cachingService.get<T>(cacheKey);
  }

  /**
   * Cache query result
   */
  private async cacheQuery(cacheKey: string, result: any, options: QueryCacheOptions): Promise<void> {
    const ttl = options.ttl || 300; // 5 minutes default

    // Store in memory cache for frequently accessed queries
    if (this.queryCache.size < 100) {
      this.queryCache.set(cacheKey, result);
    }

    // Store in Redis cache
    await this.cachingService.set(cacheKey, result, {
      ttl,
      tags: options.tags || ['query'],
    });
  }

  /**
   * Log slow query
   */
  private async logSlowQuery(query: string, parameters: any, executionTime: number): Promise<void> {
    this.logger.warn(`Slow query detected (${executionTime}ms): ${query}`, {
      query,
      parameters,
      executionTime,
    });

    // Store slow query for analysis
    const slowQueryKey = `slow_query:${Date.now()}`;
    await this.cachingService.set(slowQueryKey, {
      query,
      parameters,
      executionTime,
      timestamp: new Date(),
    }, { ttl: 86400 }); // Keep for 24 hours
  }

  /**
   * Update query statistics
   */
  private updateQueryStats(query: string, executionTime: number): void {
    const normalizedQuery = this.normalizeQuery(query);
    const stats = this.queryStats.get(normalizedQuery) || { count: 0, totalTime: 0, avgTime: 0 };
    
    stats.count++;
    stats.totalTime += executionTime;
    stats.avgTime = stats.totalTime / stats.count;
    
    this.queryStats.set(normalizedQuery, stats);
  }

  /**
   * Normalize query for statistics
   */
  private normalizeQuery(query: string): string {
    return query
      .replace(/\$\d+/g, '?') // Replace parameter placeholders
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .toLowerCase();
  }

  /**
   * Extract rows examined from query plan
   */
  private extractRowsExamined(plan: any): number {
    if (plan['Actual Rows']) {
      return plan['Actual Rows'];
    }
    
    if (plan.Plans) {
      return plan.Plans.reduce((total: number, subPlan: any) => {
        return total + this.extractRowsExamined(subPlan);
      }, 0);
    }
    
    return 0;
  }

  /**
   * Extract indexes used from query plan
   */
  private extractIndexesUsed(plan: any): string[] {
    const indexes: string[] = [];
    
    if (plan['Index Name']) {
      indexes.push(plan['Index Name']);
    }
    
    if (plan.Plans) {
      plan.Plans.forEach((subPlan: any) => {
        indexes.push(...this.extractIndexesUsed(subPlan));
      });
    }
    
    return indexes;
  }

  /**
   * Generate optimization suggestions
   */
  private generateOptimizationSuggestions(plan: any): string[] {
    const suggestions: string[] = [];
    
    if (plan['Node Type'] === 'Seq Scan') {
      suggestions.push('Consider adding an index to avoid sequential scan');
    }
    
    if (plan['Actual Rows'] > 1000 && !plan['Index Name']) {
      suggestions.push('Large result set without index - consider adding appropriate index');
    }
    
    if (plan['Execution Time'] > this.slowQueryThreshold) {
      suggestions.push('Query execution time is high - consider query optimization');
    }
    
    return suggestions;
  }

  /**
   * Analyze query for index recommendations
   */
  private analyzeQueryForIndexes(query: string): IndexRecommendation[] {
    const recommendations: IndexRecommendation[] = [];
    const lowerQuery = query.toLowerCase();
    
    // Simple pattern matching for common query patterns
    if (lowerQuery.includes('where') && lowerQuery.includes('user_id')) {
      recommendations.push({
        table: 'links',
        columns: ['user_id'],
        type: 'btree',
        reason: 'Frequent filtering by user_id',
        estimatedImprovement: '70% faster user-specific queries',
      });
    }
    
    if (lowerQuery.includes('order by') && lowerQuery.includes('created_at')) {
      recommendations.push({
        table: 'links',
        columns: ['created_at'],
        type: 'btree',
        reason: 'Frequent ordering by creation date',
        estimatedImprovement: '60% faster date-ordered queries',
      });
    }
    
    return recommendations;
  }

  /**
   * Remove duplicate recommendations
   */
  private deduplicateRecommendations(recommendations: IndexRecommendation[]): IndexRecommendation[] {
    const seen = new Set<string>();
    return recommendations.filter(rec => {
      const key = `${rec.table}:${rec.columns.join(',')}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}