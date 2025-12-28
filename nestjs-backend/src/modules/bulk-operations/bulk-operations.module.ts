import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';

import { BulkOperationsController } from './controllers/bulk-operations.controller';
import { BulkImportService } from './services/bulk-import.service';
import { BulkExportService } from './services/bulk-export.service';
import { ValidationService } from './services/validation.service';
import { ProgressTrackingService } from './services/progress-tracking.service';
import { QueueManagementService } from './services/queue-management.service';
import { BulkImportProcessor } from './processors/bulk-import.processor';
import { BulkExportProcessor } from './processors/bulk-export.processor';

import { Link } from '../urls/entities/link.entity';
import { Tag } from '../urls/entities/tag.entity';
import { LinkTag } from '../urls/entities/link-tag.entity';
import { User } from '../users/entities/user.entity';

import { BulkOperation, BulkOperationSchema } from './schemas/bulk-operation.schema';

@Module({
  imports: [
    // TypeORM entities for PostgreSQL
    TypeOrmModule.forFeature([Link, Tag, LinkTag, User]),
    
    // Mongoose schemas for MongoDB
    MongooseModule.forFeature([
      { name: BulkOperation.name, schema: BulkOperationSchema }
    ]),
    
    // Bull queues
    BullModule.registerQueue({
      name: 'bulk-import',
    }),
    BullModule.registerQueue({
      name: 'bulk-export',
    }),
  ],
  controllers: [BulkOperationsController],
  providers: [
    BulkImportService,
    BulkExportService,
    ValidationService,
    ProgressTrackingService,
    QueueManagementService,
    BulkImportProcessor,
    BulkExportProcessor,
  ],
  exports: [
    BulkImportService,
    BulkExportService,
    ValidationService,
    ProgressTrackingService,
    QueueManagementService,
  ],
})
export class BulkOperationsModule {}