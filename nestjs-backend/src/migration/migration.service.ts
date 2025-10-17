import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectDataSource } from '@nestjs/typeorm';
import { Connection } from 'mongoose';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { User, UserRole } from '../modules/users/entities/user.entity';
import { Url } from '../modules/urls/schemas/url.schema';

export interface MigrationProgress {
  step: string;
  current: number;
  total: number;
  percentage: number;
  errors: string[];
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectConnection() private mongoConnection: Connection,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async migrateFromExpressApp(): Promise<MigrationProgress> {
    const progress: MigrationProgress = {
      step: 'Starting migration',
      current: 0,
      total: 0,
      percentage: 0,
      errors: [],
    };

    try {
      // Step 1: Migrate Users from MongoDB to PostgreSQL
      progress.step = 'Migrating users';
      await this.migrateUsers(progress);

      // Step 2: Migrate URLs and update schema
      progress.step = 'Migrating URLs';
      await this.migrateUrls(progress);

      // Step 3: Create admin user if not exists
      progress.step = 'Creating admin user';
      await this.createDefaultAdmin(progress);

      // Step 4: Validate migration
      progress.step = 'Validating migration';
      await this.validateMigration(progress);

      progress.step = 'Migration completed successfully';
      progress.percentage = 100;

    } catch (error) {
      this.logger.error('Migration failed:', error);
      progress.errors.push(`Migration failed: ${error.message}`);
      throw error;
    }

    return progress;
  }

  private async migrateUsers(progress: MigrationProgress): Promise<void> {
    try {
      // Get users from old MongoDB collection
      const oldUsers = await this.mongoConnection.db.collection('users').find({}).toArray();
      progress.total = oldUsers.length;

      const userRepository = this.dataSource.getRepository(User);

      for (let i = 0; i < oldUsers.length; i++) {
        const oldUser = oldUsers[i];
        progress.current = i + 1;
        progress.percentage = Math.round((progress.current / progress.total) * 50); // 50% of total migration

        try {
          // Check if user already exists
          const existingUser = await userRepository.findOne({
            where: { email: oldUser.email },
          });

          if (!existingUser) {
            // Create new user in PostgreSQL
            const newUser = userRepository.create({
              email: oldUser.email,
              passwordHash: oldUser.password, // Already hashed in old system
              name: oldUser.name,
              isEmailVerified: oldUser.isEmailVerified || false,
              role: UserRole.USER,
              createdAt: oldUser.createdAt || new Date(),
              updatedAt: oldUser.updatedAt || new Date(),
            });

            await userRepository.save(newUser);
            this.logger.log(`Migrated user: ${oldUser.email}`);
          } else {
            this.logger.log(`User already exists: ${oldUser.email}`);
          }
        } catch (error) {
          const errorMsg = `Failed to migrate user ${oldUser.email}: ${error.message}`;
          this.logger.error(errorMsg);
          progress.errors.push(errorMsg);
        }
      }
    } catch (error) {
      throw new Error(`User migration failed: ${error.message}`);
    }
  }

  private async migrateUrls(progress: MigrationProgress): Promise<void> {
    try {
      // Get URLs from old MongoDB collection
      const oldUrls = await this.mongoConnection.db.collection('url_collections').find({}).toArray();
      
      if (oldUrls.length === 0) {
        this.logger.log('No URLs to migrate');
        return;
      }

      // Get user mapping (old MongoDB _id to new PostgreSQL UUID)
      const userRepository = this.dataSource.getRepository(User);
      const users = await userRepository.find();
      const userEmailToIdMap = new Map();
      users.forEach(user => userEmailToIdMap.set(user.email, user.id));

      const urlCollection = this.mongoConnection.db.collection('urls');

      for (let i = 0; i < oldUrls.length; i++) {
        const oldUrl = oldUrls[i];
        progress.current = progress.total + i + 1;
        progress.percentage = Math.round(50 + ((i + 1) / oldUrls.length) * 40); // 40% of total migration

        try {
          // Find user by email or skip if not found
          const oldUser = await this.mongoConnection.db.collection('users').findOne({
            _id: oldUrl.userId,
          });

          if (!oldUser) {
            this.logger.warn(`User not found for URL ${oldUrl.shortUrl}, skipping`);
            continue;
          }

          const newUserId = userEmailToIdMap.get(oldUser.email);
          if (!newUserId) {
            this.logger.warn(`New user ID not found for ${oldUser.email}, skipping URL ${oldUrl.shortUrl}`);
            continue;
          }

          // Check if URL already exists in new schema
          const existingUrl = await urlCollection.findOne({ shortCode: oldUrl.shortUrl });

          if (!existingUrl) {
            // Create new URL document with updated schema
            const newUrl = {
              userId: newUserId,
              shortCode: oldUrl.shortUrl,
              originalUrl: oldUrl.originalUrl,
              customBackHalf: oldUrl.customBackHalf,
              category: oldUrl.category,
              visitCount: oldUrl.visitCount || 0,
              isActive: true,
              metadata: {
                title: null,
                description: null,
                favicon: null,
              },
              createdAt: oldUrl.createdAt || new Date(),
              updatedAt: oldUrl.updatedAt || new Date(),
            };

            await urlCollection.insertOne(newUrl);
            this.logger.log(`Migrated URL: ${oldUrl.shortUrl}`);
          } else {
            this.logger.log(`URL already exists: ${oldUrl.shortUrl}`);
          }
        } catch (error) {
          const errorMsg = `Failed to migrate URL ${oldUrl.shortUrl}: ${error.message}`;
          this.logger.error(errorMsg);
          progress.errors.push(errorMsg);
        }
      }
    } catch (error) {
      throw new Error(`URL migration failed: ${error.message}`);
    }
  }

  private async createDefaultAdmin(progress: MigrationProgress): Promise<void> {
    try {
      const userRepository = this.dataSource.getRepository(User);
      
      // Check if admin user already exists
      const existingAdmin = await userRepository.findOne({
        where: { email: 'admin@urlshortener.com' },
      });

      if (!existingAdmin) {
        const hashedPassword = await bcrypt.hash('admin123', 12);
        
        const adminUser = userRepository.create({
          email: 'admin@urlshortener.com',
          passwordHash: hashedPassword,
          name: 'Admin User',
          role: UserRole.ADMIN,
          isEmailVerified: true,
        });

        await userRepository.save(adminUser);
        this.logger.log('Created default admin user');
      } else {
        this.logger.log('Admin user already exists');
      }

      progress.percentage = 95;
    } catch (error) {
      throw new Error(`Admin creation failed: ${error.message}`);
    }
  }

  private async validateMigration(progress: MigrationProgress): Promise<void> {
    try {
      const userRepository = this.dataSource.getRepository(User);
      const urlCollection = this.mongoConnection.db.collection('urls');

      const userCount = await userRepository.count();
      const urlCount = await urlCollection.countDocuments();

      this.logger.log(`Migration validation: ${userCount} users, ${urlCount} URLs`);

      if (userCount === 0) {
        throw new Error('No users found after migration');
      }

      progress.percentage = 100;
    } catch (error) {
      throw new Error(`Migration validation failed: ${error.message}`);
    }
  }

  async rollbackMigration(): Promise<void> {
    this.logger.warn('Starting migration rollback...');

    try {
      // Clear PostgreSQL tables (except admin user)
      const userRepository = this.dataSource.getRepository(User);
      await userRepository.delete({ role: UserRole.USER });

      // Clear new MongoDB collections
      await this.mongoConnection.db.collection('urls').deleteMany({});
      await this.mongoConnection.db.collection('clickanalytics').deleteMany({});
      await this.mongoConnection.db.collection('linkinbios').deleteMany({});
      await this.mongoConnection.db.collection('urlstats').deleteMany({});

      this.logger.log('Migration rollback completed');
    } catch (error) {
      this.logger.error('Rollback failed:', error);
      throw error;
    }
  }

  async getMigrationStatus(): Promise<{
    isCompleted: boolean;
    userCount: number;
    urlCount: number;
    lastMigration?: Date;
  }> {
    try {
      const userRepository = this.dataSource.getRepository(User);
      const urlCollection = this.mongoConnection.db.collection('urls');

      const userCount = await userRepository.count();
      const urlCount = await urlCollection.countDocuments();

      return {
        isCompleted: userCount > 0 && urlCount >= 0,
        userCount,
        urlCount,
        lastMigration: new Date(), // This could be stored in a migration log table
      };
    } catch (error) {
      this.logger.error('Failed to get migration status:', error);
      throw error;
    }
  }
}