/**
 * Enhanced Test Database Manager
 * Provides comprehensive database setup, teardown, and isolation for tests
 */

import { DataSource, Repository, EntityTarget } from 'typeorm';
import { Connection } from 'mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../../src/config/database.module';
import { User } from '../../src/modules/users/entities/user.entity';
import { Link } from '../../src/modules/urls/entities/link.entity';
import { BioPage } from '../../src/modules/bio-pages/entities/bio-page.entity';
import { Tag } from '../../src/modules/urls/entities/tag.entity';
import { RefreshToken } from '../../src/modules/users/entities/refresh-token.entity';
import { AdminUser } from '../../src/modules/users/entities/admin-user.entity';
import { AuditLog } from '../../src/modules/users/entities/audit-log.entity';
import { GeoRule } from '../../src/modules/urls/entities/geo-rule.entity';
import { LinkTag } from '../../src/modules/urls/entities/link-tag.entity';
import { BioLink } from '../../src/modules/bio-pages/entities/bio-link.entity';
import { CustomDomain } from '../../src/modules/users/entities/custom-domain.entity';

export interface TestDatabaseConfig {
  isolationLevel: 'transaction' | 'database' | 'schema';
  autoCleanup: boolean;
  seedData: boolean;
  parallelSafe: boolean;
}

export interface TestDataSeed {
  users?: Partial<User>[];
  links?: Partial<Link>[];
  bioPages?: Partial<BioPage>[];
  tags?: Partial<Tag>[];
  adminUsers?: Partial<AdminUser>[];
}

export class TestDatabaseManager {
  private dataSource: DataSource;
  private mongoConnection: Connection;
  private testModule: TestingModule;
  private repositories: Map<string, Repository<any>> = new Map();
  private transactionManager: any;
  private isInTransaction = false;
  private testDatabaseName: string;
  private originalDatabaseName: string;

  constructor(private config: TestDatabaseConfig = {
    isolationLevel: 'transaction',
    autoCleanup: true,
    seedData: false,
    parallelSafe: true,
  }) {
    this.testDatabaseName = `test_db_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Initialize test database connections and setup
   */
  async setupTestDatabase(): Promise<void> {
    try {
      // Ensure test databases exist before connecting
      await this.ensureTestDatabasesExist();

      // Create test module with simplified database configuration
      this.testModule = await Test.createTestingModule({
        imports: [
          // Direct TypeORM configuration for testing
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: process.env.POSTGRES_TEST_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_TEST_PORT || '5433', 10),
            username: process.env.POSTGRES_TEST_USER || 'postgres',
            password: process.env.POSTGRES_TEST_PASSWORD || 'password',
            database: this.config.parallelSafe ? this.testDatabaseName : 'url_shortener_test',
            entities: [User, Link, BioPage, Tag, RefreshToken, AdminUser, AuditLog, GeoRule, LinkTag, BioLink, CustomDomain],
            synchronize: true, // Auto-create tables for testing
            logging: false, // Disable logging for cleaner test output
            dropSchema: false, // Don't drop schema automatically
          }),
          // Direct Mongoose configuration for testing
          MongooseModule.forRoot(
            process.env.MONGODB_TEST_URI || `mongodb://localhost:27018/${this.config.parallelSafe ? this.testDatabaseName : 'url_shortener_test'}`,
            {
              maxPoolSize: 5,
              minPoolSize: 1,
              serverSelectionTimeoutMS: 5000,
              socketTimeoutMS: 45000,
              connectTimeoutMS: 10000,
              bufferCommands: false,
            }
          ),
        ],
        providers: [
          {
            provide: ConfigService,
            useValue: this.createTestConfigService(),
          },
        ],
      }).compile();

      // Get database connections
      this.dataSource = this.testModule.get<DataSource>(getDataSourceToken());
      this.mongoConnection = this.testModule.get<Connection>(getConnectionToken());

      // Wait for connections to be ready
      await this.waitForConnections();

      // Initialize repositories
      await this.initializeRepositories();

      // Setup isolation based on configuration
      await this.setupIsolation();

      // Seed test data if configured
      if (this.config.seedData) {
        await this.seedTestData();
      }

      console.log(`✅ Test database setup complete: ${this.testDatabaseName}`);
    } catch (error) {
      console.error('❌ Test database setup failed:', error);
      throw error;
    }
  }

  /**
   * Clear all data from test database
   */
  async clearDatabase(): Promise<void> {
    try {
      if (this.config.isolationLevel === 'transaction' && this.isInTransaction) {
        // Rollback transaction to clear data
        await this.transactionManager.rollback();
        await this.startTransaction();
      } else {
        // Clear PostgreSQL tables
        await this.clearPostgreSQLTables();
        
        // Clear MongoDB collections
        await this.clearMongoDBCollections();
      }

      console.log('🧹 Test database cleared successfully');
    } catch (error) {
      console.error('❌ Test database clear failed:', error);
      throw error;
    }
  }

  /**
   * Seed test database with initial data
   */
  async seedTestData(customSeed?: TestDataSeed): Promise<void> {
    try {
      const seedData = customSeed || this.getDefaultSeedData();

      // Seed users first (as they're referenced by other entities)
      if (seedData.users?.length) {
        const userRepo = this.getRepository(User);
        await userRepo.save(seedData.users);
      }

      // Seed tags
      if (seedData.tags?.length) {
        const tagRepo = this.getRepository(Tag);
        await tagRepo.save(seedData.tags);
      }

      // Seed links
      if (seedData.links?.length) {
        const linkRepo = this.getRepository(Link);
        await linkRepo.save(seedData.links);
      }

      // Seed bio pages
      if (seedData.bioPages?.length) {
        const bioPageRepo = this.getRepository(BioPage);
        await bioPageRepo.save(seedData.bioPages);
      }

      // Seed admin users
      if (seedData.adminUsers?.length) {
        const adminRepo = this.getRepository(AdminUser);
        await adminRepo.save(seedData.adminUsers);
      }

      console.log('🌱 Test data seeded successfully');
    } catch (error) {
      console.error('❌ Test data seeding failed:', error);
      throw error;
    }
  }

  /**
   * Create a test user with default values
   */
  async createTestUser(overrides: Partial<User> = {}): Promise<User> {
    const userRepo = this.getRepository(User);
    const testUser = userRepo.create({
      email: `test${Date.now()}@example.com`,
      passwordHash: '$2b$10$hashedpassword', // Pre-hashed test password
      name: 'Test User',
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    return await userRepo.save(testUser);
  }

  /**
   * Create a test URL/Link with default values
   */
  async createTestUrl(userId?: string, overrides: Partial<Link> = {}): Promise<Link> {
    const linkRepo = this.getRepository(Link);
    
    // Create user if not provided
    let user: User;
    if (userId) {
      const userRepo = this.getRepository(User);
      user = await userRepo.findOne({ where: { id: userId } });
    } else {
      user = await this.createTestUser();
    }

    const testLink = linkRepo.create({
      originalUrl: 'https://example.com',
      shortCode: `test${Date.now()}`,
      title: 'Test Link',
      isActive: true,
      visitCount: 0,
      userId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    return await linkRepo.save(testLink);
  }

  /**
   * Create a test bio page with default values
   */
  async createTestBioPage(userId?: string, overrides: Partial<BioPage> = {}): Promise<BioPage> {
    const bioPageRepo = this.getRepository(BioPage);
    
    // Create user if not provided
    let user: User;
    if (userId) {
      const userRepo = this.getRepository(User);
      user = await userRepo.findOne({ where: { id: userId } });
    } else {
      user = await this.createTestUser();
    }

    const testBioPage = bioPageRepo.create({
      username: `testbio${Date.now()}`,
      title: 'Test Bio Page',
      bio: 'This is a test bio page',
      theme: 'default',
      backgroundColor: '#ffffff',
      textColor: '#000000',
      buttonStyle: 'rounded',
      isPublic: true,
      userId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    return await bioPageRepo.save(testBioPage);
  }

  /**
   * Get repository for entity type
   */
  getRepository<T>(entityClass: EntityTarget<T>): Repository<T> {
    const entityName = typeof entityClass === 'function' ? entityClass.name : 
                      typeof entityClass === 'string' ? entityClass : 
                      'entity';
    
    if (!this.repositories.has(entityName)) {
      const repository = this.dataSource.getRepository(entityClass);
      this.repositories.set(entityName, repository);
    }
    
    return this.repositories.get(entityName);
  }

  /**
   * Get data source for direct database operations
   */
  getDataSource(): DataSource {
    return this.dataSource;
  }

  /**
   * Get MongoDB connection for direct operations
   */
  getMongoConnection(): Connection {
    return this.mongoConnection;
  }

  /**
   * Start a database transaction for isolation
   */
  async startTransaction(): Promise<void> {
    if (this.config.isolationLevel === 'transaction') {
      this.transactionManager = this.dataSource.createQueryRunner();
      await this.transactionManager.connect();
      await this.transactionManager.startTransaction();
      this.isInTransaction = true;
    }
  }

  /**
   * Commit current transaction
   */
  async commitTransaction(): Promise<void> {
    if (this.isInTransaction && this.transactionManager) {
      await this.transactionManager.commitTransaction();
      await this.transactionManager.release();
      this.isInTransaction = false;
    }
  }

  /**
   * Rollback current transaction
   */
  async rollbackTransaction(): Promise<void> {
    if (this.isInTransaction && this.transactionManager) {
      await this.transactionManager.rollbackTransaction();
      await this.transactionManager.release();
      this.isInTransaction = false;
    }
  }

  /**
   * Teardown test database and cleanup resources
   */
  async teardownTestDatabase(): Promise<void> {
    try {
      // Rollback any active transactions
      if (this.isInTransaction) {
        await this.rollbackTransaction();
      }

      // Clear data if auto cleanup is enabled
      if (this.config.autoCleanup) {
        await this.clearDatabase();
      }

      // Close connections
      if (this.dataSource?.isInitialized) {
        await this.dataSource.destroy();
      }

      if (this.mongoConnection?.readyState === 1) {
        await this.mongoConnection.close();
      }

      // Close test module
      if (this.testModule) {
        await this.testModule.close();
      }

      console.log('🧹 Test database teardown complete');
    } catch (error) {
      console.error('❌ Test database teardown failed:', error);
      throw error;
    }
  }

  /**
   * Check if database is ready for testing
   */
  async isReady(): Promise<boolean> {
    try {
      // Check PostgreSQL connection
      const pgReady = this.dataSource?.isInitialized && 
                     await this.dataSource.query('SELECT 1');
      
      // Check MongoDB connection
      const mongoReady = this.mongoConnection?.readyState === 1;

      return !!pgReady && mongoReady;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get database statistics for monitoring
   */
  async getDatabaseStats(): Promise<{
    postgresql: { tables: number; records: number };
    mongodb: { collections: number; documents: number };
  }> {
    const stats = {
      postgresql: { tables: 0, records: 0 },
      mongodb: { collections: 0, documents: 0 },
    };

    try {
      // PostgreSQL stats
      const pgTables = await this.dataSource.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      stats.postgresql.tables = parseInt(pgTables[0].count);

      const pgRecords = await this.dataSource.query(`
        SELECT SUM(n_tup_ins + n_tup_upd) as total_records 
        FROM pg_stat_user_tables
      `);
      stats.postgresql.records = parseInt(pgRecords[0]?.total_records || '0');

      // MongoDB stats
      const mongoStats = await this.mongoConnection.db.stats();
      stats.mongodb.collections = mongoStats.collections;
      stats.mongodb.documents = mongoStats.objects;

    } catch (error) {
      console.warn('Could not retrieve database stats:', error.message);
    }

    return stats;
  }

  // Private helper methods

  private async ensureTestDatabasesExist(): Promise<void> {
    try {
      // For parallel-safe tests, we need to create unique databases
      if (this.config.parallelSafe) {
        await this.createUniqueTestDatabase();
      }
      // For non-parallel tests, ensure the standard test database exists
      else {
        await this.ensureStandardTestDatabase();
      }
    } catch (error) {
      console.warn('Could not ensure test databases exist:', error.message);
      // Continue anyway - the database might already exist
    }
  }

  private async createUniqueTestDatabase(): Promise<void> {
    // For unique test databases, we'll use the existing database but with unique table prefixes
    // This is simpler than creating entirely new databases for each test
    this.testDatabaseName = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  private async ensureStandardTestDatabase(): Promise<void> {
    // The standard test databases should already exist via Docker Compose
    // If they don't exist, the connection will fail and provide a clear error message
    this.testDatabaseName = 'url_shortener_test';
  }

  private async waitForConnections(): Promise<void> {
    const maxRetries = 10;
    const retryDelay = 1000; // 1 second

    for (let i = 0; i < maxRetries; i++) {
      try {
        // Test PostgreSQL connection
        if (this.dataSource?.isInitialized) {
          await this.dataSource.query('SELECT 1');
        }

        // Test MongoDB connection
        if (this.mongoConnection?.readyState === 1) {
          await this.mongoConnection.db.admin().ping();
        }

        console.log('✅ Database connections established');
        return;
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error(`Failed to establish database connections after ${maxRetries} attempts: ${error.message}`);
        }
        
        console.log(`⏳ Waiting for database connections (attempt ${i + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  private async initializeRepositories(): Promise<void> {
    const entities = [
      User, Link, BioPage, Tag, RefreshToken, AdminUser, 
      AuditLog, GeoRule, LinkTag, BioLink, CustomDomain
    ];

    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity);
      this.repositories.set(entity.name, repository);
    }
  }

  private async setupIsolation(): Promise<void> {
    switch (this.config.isolationLevel) {
      case 'transaction':
        await this.startTransaction();
        break;
      case 'database':
        // Database-level isolation is handled by test database name
        break;
      case 'schema':
        // Schema-level isolation could be implemented here
        break;
    }
  }

  private async clearPostgreSQLTables(): Promise<void> {
    const entities = this.dataSource.entityMetadatas;
    
    // Disable foreign key checks temporarily
    await this.dataSource.query('SET session_replication_role = replica;');
    
    try {
      // Clear tables in reverse dependency order
      for (const entity of entities.reverse()) {
        await this.dataSource.query(`TRUNCATE TABLE "${entity.tableName}" CASCADE;`);
      }
    } finally {
      // Re-enable foreign key checks
      await this.dataSource.query('SET session_replication_role = DEFAULT;');
    }
  }

  private async clearMongoDBCollections(): Promise<void> {
    const collections = await this.mongoConnection.db.listCollections().toArray();
    
    for (const collection of collections) {
      await this.mongoConnection.db.collection(collection.name).deleteMany({});
    }
  }

  private createTestConfigService(): ConfigService {
    // Use test-specific database configuration
    const testConfig = new Map([
      ['NODE_ENV', 'test'],
      // PostgreSQL test database configuration (postgres-test container on port 5433)
      ['DATABASE_HOST', process.env.POSTGRES_TEST_HOST || 'localhost'],
      ['DATABASE_PORT', process.env.POSTGRES_TEST_PORT || '5433'],
      ['DATABASE_USERNAME', process.env.POSTGRES_TEST_USER || 'postgres'],
      ['DATABASE_PASSWORD', process.env.POSTGRES_TEST_PASSWORD || 'password'],
      ['DATABASE_NAME', this.config.parallelSafe ? this.testDatabaseName : 'url_shortener_test'],
      // MongoDB test database configuration (mongo-test container on port 27018)
      ['MONGODB_URI', process.env.MONGODB_TEST_URI || `mongodb://localhost:27018/${this.config.parallelSafe ? this.testDatabaseName : 'url_shortener_test'}`],
      // Redis test database configuration (redis-test container on port 6380)
      ['REDIS_HOST', process.env.REDIS_TEST_HOST || 'localhost'],
      ['REDIS_PORT', process.env.REDIS_TEST_PORT || '6380'],
      // Disable SSL and other production features for testing
      ['DB_SSL_REJECT_UNAUTHORIZED', 'false'],
      ['MONGO_SSL', 'false'],
      // Reduce connection pool sizes for testing
      ['DB_POOL_MAX', '5'],
      ['DB_POOL_MIN', '1'],
      ['MONGO_POOL_MAX', '5'],
      ['MONGO_POOL_MIN', '1'],
      // Reduce timeouts for faster test execution
      ['DB_CONNECTION_TIMEOUT', '5000'],
      ['MONGO_CONNECT_TIMEOUT', '5000'],
      ['MONGO_SERVER_TIMEOUT', '5000'],
    ]);

    return {
      get: (key: string, defaultValue?: any) => testConfig.get(key) || defaultValue,
    } as ConfigService;
  }

  private getDefaultSeedData(): TestDataSeed {
    return {
      users: [
        {
          email: 'testuser1@example.com',
          passwordHash: '$2b$10$hashedpassword',
          name: 'Test User 1',
          isEmailVerified: true,
        },
        {
          email: 'testuser2@example.com',
          passwordHash: '$2b$10$hashedpassword',
          name: 'Test User 2',
          isEmailVerified: true,
        },
      ],
      tags: [
        {
          name: 'Test Tag 1',
          color: '#3b82f6',
        },
        {
          name: 'Test Tag 2',
          color: '#ef4444',
        },
      ],
    };
  }
}

// Export singleton instance for global use
export const testDatabaseManager = new TestDatabaseManager();