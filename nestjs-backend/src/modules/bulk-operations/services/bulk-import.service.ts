import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as csv from 'csv-parser';
import { Readable } from 'stream';

import { ValidationService } from './validation.service';
import { ProgressTrackingService } from './progress-tracking.service';
import { Link } from '../../urls/entities/link.entity';
import { Tag } from '../../urls/entities/tag.entity';
import { User } from '../../users/entities/user.entity';

import { 
  BulkImportOptionsDto, 
  CsvLinkRecord, 
  DuplicateHandlingStrategy,
  BulkImportResponseDto 
} from '../dto/bulk-import.dto';
import { 
  BulkOperationType, 
  BulkOperationStatus,
  BulkOperationDocument 
} from '../schemas/bulk-operation.schema';

export interface BulkImportJobData {
  operationId: string;
  userId: string;
  fileBuffer: Buffer;
  filename: string;
  options: BulkImportOptionsDto;
}

@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    @InjectQueue('bulk-import') private importQueue: Queue,
    @InjectRepository(Link) private linkRepository: Repository<Link>,
    @InjectRepository(Tag) private tagRepository: Repository<Tag>,
    @InjectRepository(User) private userRepository: Repository<User>,
    private validationService: ValidationService,
    private progressTrackingService: ProgressTrackingService,
  ) {}

  /**
   * Start bulk import process
   */
  async startImport(
    userId: string,
    file: any,
    options: BulkImportOptionsDto
  ): Promise<BulkImportResponseDto> {
    this.logger.log(`Starting bulk import for user ${userId}, file: ${file.originalname}`);

    // Validate file
    const fileErrors = this.validationService.validateFile(file);
    if (fileErrors.length > 0) {
      throw new Error(`File validation failed: ${fileErrors.map(e => e.message).join(', ')}`);
    }

    // Validate user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Create operation record
    const operation = await this.progressTrackingService.createOperation({
      userId,
      type: BulkOperationType.IMPORT,
      status: BulkOperationStatus.PENDING,
      jobId: '', // Will be set after job creation
      filename: file.filename,
      originalFilename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      metadata: {
        options,
        uploadedAt: new Date(),
      },
    });

    // Add job to queue
    const job = await this.importQueue.add('process-import', {
      operationId: operation._id.toString(),
      userId,
      fileBuffer: file.buffer,
      filename: file.originalname,
      options,
    } as BulkImportJobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 10,
      removeOnFail: 10,
    });

    // Update operation with job ID
    await this.progressTrackingService.updateMetadata(operation._id.toString(), {
      ...operation.metadata,
      jobId: job.id.toString(),
    });

    // Update the operation document with job ID
    operation.jobId = job.id.toString();
    await operation.save();

    return {
      jobId: job.id.toString(),
      operationId: operation._id.toString(),
      status: BulkOperationStatus.PENDING,
      estimatedTime: this.estimateProcessingTime(file.size),
    };
  }

  /**
   * Parse CSV file and extract records
   */
  async parseCsvFile(fileBuffer: Buffer): Promise<{
    records: CsvLinkRecord[];
    headers: string[];
    totalRecords: number;
  }> {
    return new Promise((resolve, reject) => {
      const records: CsvLinkRecord[] = [];
      let headers: string[] = [];
      let isFirstRow = true;

      const stream = Readable.from(fileBuffer.toString());
      
      stream
        .pipe(csv())
        .on('headers', (headerList: string[]) => {
          headers = headerList;
        })
        .on('data', (data: CsvLinkRecord) => {
          if (isFirstRow) {
            isFirstRow = false;
          }
          records.push(data);
        })
        .on('end', () => {
          resolve({
            records,
            headers,
            totalRecords: records.length,
          });
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }

  /**
   * Process a batch of CSV records
   */
  async processBatch(
    records: CsvLinkRecord[],
    userId: string,
    options: BulkImportOptionsDto,
    operationId: string,
    startIndex: number
  ): Promise<{
    successful: number;
    failed: number;
    errors: any[];
  }> {
    let successful = 0;
    let failed = 0;
    const errors: any[] = [];

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const rowNumber = startIndex + i + 1;

      try {
        // Validate record
        const validationErrors = await this.validationService.validateCsvRecord(record, rowNumber);
        if (validationErrors.length > 0) {
          errors.push(...validationErrors);
          failed++;
          continue;
        }

        // Check for duplicates
        const existingLink = await this.checkForDuplicates(record, userId);
        if (existingLink) {
          const handled = await this.handleDuplicate(
            existingLink,
            record,
            options.duplicateHandling,
            rowNumber
          );
          
          if (!handled) {
            errors.push({
              row: rowNumber,
              message: 'Duplicate short code or custom alias found',
              value: record.shortCode || record.customAlias,
            });
            failed++;
            continue;
          }
        }

        // Create or update link
        await this.createOrUpdateLink(record, user, options);
        successful++;

      } catch (error) {
        this.logger.error(`Error processing record at row ${rowNumber}:`, error);
        errors.push({
          row: rowNumber,
          message: error.message || 'Unknown error occurred',
          value: record,
        });
        failed++;
      }
    }

    // Add errors to operation
    if (errors.length > 0) {
      await this.progressTrackingService.addErrors(operationId, errors);
    }

    return { successful, failed, errors };
  }

  /**
   * Check for duplicate links
   */
  private async checkForDuplicates(record: CsvLinkRecord, userId: string): Promise<Link | null> {
    const conditions: any[] = [];

    if (record.shortCode) {
      conditions.push({ shortCode: record.shortCode });
    }

    if (record.customAlias) {
      conditions.push({ customAlias: record.customAlias });
    }

    if (conditions.length === 0) {
      return null;
    }

    return this.linkRepository.findOne({
      where: conditions,
      relations: ['user'],
    });
  }

  /**
   * Handle duplicate records based on strategy
   */
  private async handleDuplicate(
    existingLink: Link,
    record: CsvLinkRecord,
    strategy: DuplicateHandlingStrategy,
    rowNumber: number
  ): Promise<boolean> {
    switch (strategy) {
      case DuplicateHandlingStrategy.SKIP:
        return true; // Skip without error

      case DuplicateHandlingStrategy.UPDATE:
        // Update existing link with new data
        await this.updateLinkFromRecord(existingLink, record);
        return true;

      case DuplicateHandlingStrategy.ERROR:
        return false; // Will cause error to be logged

      default:
        return false;
    }
  }

  /**
   * Create or update link from CSV record
   */
  private async createOrUpdateLink(
    record: CsvLinkRecord,
    user: User,
    options: BulkImportOptionsDto
  ): Promise<Link> {
    const link = new Link();
    link.user = user;
    link.originalUrl = record.originalUrl;
    link.title = record.title || null;
    link.isActive = record.isActive !== undefined ? 
      this.validationService.normalizeBoolean(record.isActive) : true;

    // Handle short code
    if (record.shortCode) {
      link.shortCode = record.shortCode;
    } else if (options.generateMissingShortCodes) {
      link.shortCode = await this.generateUniqueShortCode();
    }

    // Handle custom alias
    if (record.customAlias) {
      link.customAlias = record.customAlias;
    }

    // Handle expiration
    if (record.expiresAt) {
      link.expiresAt = new Date(record.expiresAt);
    }

    // Handle password protection
    if (record.password) {
      const bcrypt = require('bcrypt');
      link.passwordHash = await bcrypt.hash(record.password, 10);
      link.passwordHint = record.passwordHint || null;
    }

    // Handle device-specific URLs
    link.iosUrl = record.iosUrl || null;
    link.androidUrl = record.androidUrl || null;

    // Handle UTM parameters
    link.utmSource = record.utmSource || null;
    link.utmMedium = record.utmMedium || null;
    link.utmCampaign = record.utmCampaign || null;
    link.utmTerm = record.utmTerm || null;
    link.utmContent = record.utmContent || null;

    // Handle tracking pixels
    link.metaPixelId = record.metaPixelId || null;
    link.googleAnalyticsId = record.googleAnalyticsId || null;
    link.tiktokPixelId = record.tiktokPixelId || null;

    // Save link
    const savedLink = await this.linkRepository.save(link);

    // Handle tags
    if (record.tags && options.createMissingTags) {
      await this.handleTags(savedLink, record.tags, user);
    }

    // Handle geo rules
    if (record.geoRules) {
      await this.handleGeoRules(savedLink, record.geoRules);
    }

    return savedLink;
  }

  /**
   * Update existing link from CSV record
   */
  private async updateLinkFromRecord(existingLink: Link, record: CsvLinkRecord): Promise<void> {
    // Update fields that are provided
    if (record.originalUrl) existingLink.originalUrl = record.originalUrl;
    if (record.title !== undefined) existingLink.title = record.title || null;
    if (record.isActive !== undefined) {
      existingLink.isActive = this.validationService.normalizeBoolean(record.isActive);
    }

    // Update other fields...
    if (record.expiresAt) existingLink.expiresAt = new Date(record.expiresAt);
    if (record.iosUrl !== undefined) existingLink.iosUrl = record.iosUrl || null;
    if (record.androidUrl !== undefined) existingLink.androidUrl = record.androidUrl || null;

    // Update UTM parameters
    if (record.utmSource !== undefined) existingLink.utmSource = record.utmSource || null;
    if (record.utmMedium !== undefined) existingLink.utmMedium = record.utmMedium || null;
    if (record.utmCampaign !== undefined) existingLink.utmCampaign = record.utmCampaign || null;
    if (record.utmTerm !== undefined) existingLink.utmTerm = record.utmTerm || null;
    if (record.utmContent !== undefined) existingLink.utmContent = record.utmContent || null;

    // Update tracking pixels
    if (record.metaPixelId !== undefined) existingLink.metaPixelId = record.metaPixelId || null;
    if (record.googleAnalyticsId !== undefined) existingLink.googleAnalyticsId = record.googleAnalyticsId || null;
    if (record.tiktokPixelId !== undefined) existingLink.tiktokPixelId = record.tiktokPixelId || null;

    await this.linkRepository.save(existingLink);
  }

  /**
   * Handle tags for a link
   */
  private async handleTags(link: Link, tagsString: string, user: User): Promise<void> {
    const tagNames = tagsString.split(',').map(name => name.trim()).filter(name => name);
    
    for (const tagName of tagNames) {
      let tag = await this.tagRepository.findOne({
        where: { name: tagName, user: { id: user.id } }
      });

      if (!tag) {
        tag = new Tag();
        tag.name = tagName;
        tag.user = user;
        tag.color = '#6366f1'; // Default color
        await this.tagRepository.save(tag);
      }

      // Associate tag with link (this would need the LinkTag entity)
      // Implementation depends on your LinkTag entity structure
    }
  }

  /**
   * Handle geo rules for a link
   */
  private async handleGeoRules(link: Link, geoRulesString: string): Promise<void> {
    try {
      const geoRules = this.validationService.parseGeoRules(geoRulesString);
      // Implementation would depend on your GeoRule entity
      // This is a placeholder for the actual geo rules creation
      this.logger.log(`Would create ${geoRules.length} geo rules for link ${link.id}`);
    } catch (error) {
      this.logger.error(`Failed to create geo rules for link ${link.id}:`, error);
    }
  }

  /**
   * Generate unique short code
   */
  private async generateUniqueShortCode(): Promise<string> {
    const { nanoid } = await import('nanoid');
    let shortCode: string;
    let attempts = 0;
    const maxAttempts = 10;

    do {
      shortCode = nanoid(8);
      attempts++;
      
      const existing = await this.linkRepository.findOne({
        where: { shortCode }
      });
      
      if (!existing) {
        return shortCode;
      }
    } while (attempts < maxAttempts);

    throw new Error('Failed to generate unique short code after maximum attempts');
  }

  /**
   * Estimate processing time based on file size
   */
  private estimateProcessingTime(fileSize: number): number {
    // Rough estimate: 1MB = 30 seconds processing time
    const estimatedSeconds = Math.ceil((fileSize / 1024 / 1024) * 30);
    return Math.max(estimatedSeconds, 10); // Minimum 10 seconds
  }

  /**
   * Get import job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    const job = await this.importQueue.getJob(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress(),
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }
}