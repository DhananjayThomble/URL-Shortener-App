import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as csvWriter from 'csv-writer';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

import { ProgressTrackingService } from './progress-tracking.service';
import { Link } from '../../urls/entities/link.entity';
import { Tag } from '../../urls/entities/tag.entity';
import { LinkTag } from '../../urls/entities/link-tag.entity';
import { User } from '../../users/entities/user.entity';
import { ClickEvent, ClickEventDocument } from '../../analytics/schemas/click-event.schema';

import { 
  BulkExportOptionsDto,
  BulkExportResponseDto 
} from '../dto/bulk-export.dto';
import { 
  BulkOperationType, 
  BulkOperationStatus,
  BulkOperationDocument 
} from '../schemas/bulk-operation.schema';

export interface BulkExportJobData {
  operationId: string;
  userId: string;
  options: BulkExportOptionsDto;
}

export interface ExportLinkData {
  id: string;
  originalUrl: string;
  shortCode: string;
  customAlias?: string;
  title?: string;
  isActive: boolean;
  expiresAt?: Date;
  passwordProtected: boolean;
  passwordHint?: string;
  iosUrl?: string;
  androidUrl?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  metaPixelId?: string;
  googleAnalyticsId?: string;
  tiktokPixelId?: string;
  tags?: string;
  geoRules?: string;
  createdAt: Date;
  updatedAt: Date;
  // Analytics data
  totalClicks?: number;
  uniqueClicks?: number;
  lastClickedAt?: Date;
  topCountries?: string;
  topDevices?: string;
  topBrowsers?: string;
  topReferrers?: string;
}

@Injectable()
export class BulkExportService {
  private readonly logger = new Logger(BulkExportService.name);
  private readonly exportDir = path.join(process.cwd(), 'exports');

  constructor(
    @InjectQueue('bulk-export') private exportQueue: Queue,
    @InjectRepository(Link) private linkRepository: Repository<Link>,
    @InjectRepository(Tag) private tagRepository: Repository<Tag>,
    @InjectRepository(LinkTag) private linkTagRepository: Repository<LinkTag>,
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectModel(ClickEvent.name) private clickEventModel: Model<ClickEventDocument>,
    private progressTrackingService: ProgressTrackingService,
  ) {
    // Ensure export directory exists
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  /**
   * Start bulk export process
   */
  async startExport(
    userId: string,
    options: BulkExportOptionsDto
  ): Promise<BulkExportResponseDto> {
    this.logger.log(`Starting bulk export for user ${userId}`);

    // Validate user exists
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    // Get estimated record count
    const estimatedCount = await this.getEstimatedRecordCount(userId, options);
    
    // Create operation record
    const operation = await this.progressTrackingService.createOperation({
      userId,
      type: BulkOperationType.EXPORT,
      status: BulkOperationStatus.PENDING,
      jobId: '', // Will be set after job creation
      metadata: {
        options,
        estimatedRecords: estimatedCount,
        requestedAt: new Date(),
      },
    });

    // Add job to queue
    const job = await this.exportQueue.add('process-export', {
      operationId: operation._id.toString(),
      userId,
      options,
    } as BulkExportJobData, {
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
      estimatedTime: this.estimateProcessingTime(estimatedCount),
    };
  }

  /**
   * Get estimated record count for export
   */
  private async getEstimatedRecordCount(
    userId: string,
    options: BulkExportOptionsDto
  ): Promise<number> {
    const query = this.buildExportQuery(userId, options);
    return query.getCount();
  }

  /**
   * Build query for export based on options
   */
  private buildExportQuery(
    userId: string,
    options: BulkExportOptionsDto
  ): SelectQueryBuilder<Link> {
    let query = this.linkRepository
      .createQueryBuilder('link')
      .leftJoinAndSelect('link.user', 'user')
      .where('user.id = :userId', { userId });

    // Filter by active status
    if (options.activeOnly) {
      query = query.andWhere('link.isActive = :isActive', { isActive: true });
    }

    // Filter by date range
    if (options.startDate) {
      query = query.andWhere('link.createdAt >= :startDate', { 
        startDate: new Date(options.startDate) 
      });
    }

    if (options.endDate) {
      query = query.andWhere('link.createdAt <= :endDate', { 
        endDate: new Date(options.endDate) 
      });
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      query = query
        .leftJoin('link.tags', 'tag')
        .andWhere('tag.name IN (:...tagNames)', { tagNames: options.tags });
    }

    // Filter password-protected links
    if (!options.includePasswordProtected) {
      query = query.andWhere('link.passwordHash IS NULL');
    }

    // Apply limit
    if (options.limit) {
      query = query.limit(options.limit);
    }

    return query.orderBy('link.createdAt', 'DESC');
  }

  /**
   * Export links to CSV with streaming for large datasets
   */
  async exportLinksToCSV(
    userId: string,
    options: BulkExportOptionsDto,
    operationId: string
  ): Promise<string> {
    const filename = `links_export_${userId}_${Date.now()}.csv`;
    const filepath = path.join(this.exportDir, filename);

    // Define CSV headers based on options
    const headers = this.buildCsvHeaders(options);

    // Create CSV writer
    const writer = csvWriter.createObjectCsvWriter({
      path: filepath,
      header: headers,
    });

    // Get total count for progress tracking
    const totalCount = await this.getEstimatedRecordCount(userId, options);
    await this.progressTrackingService.updateProgress(operationId, {
      totalRecords: totalCount,
      processedRecords: 0,
      successfulRecords: 0,
      failedRecords: 0,
    });

    // Process in batches to handle large datasets
    const batchSize = 1000;
    let offset = 0;
    let processedCount = 0;
    const allRecords: any[] = [];

    while (true) {
      const query = this.buildExportQuery(userId, options)
        .skip(offset)
        .take(batchSize);

      const links = await query.getMany();
      
      if (links.length === 0) {
        break;
      }

      // Process batch
      const batchRecords = await this.processBatchForExport(links, options);
      allRecords.push(...batchRecords);

      processedCount += links.length;
      offset += batchSize;

      // Update progress
      await this.progressTrackingService.updateProgress(operationId, {
        processedRecords: processedCount,
        successfulRecords: processedCount,
        percentage: Math.round((processedCount / totalCount) * 100),
      });

      this.logger.log(`Processed ${processedCount}/${totalCount} records for export`);
    }

    // Write all records to CSV
    await writer.writeRecords(allRecords);

    this.logger.log(`Export completed: ${filepath}`);
    return filepath;
  }

  /**
   * Process a batch of links for export
   */
  private async processBatchForExport(
    links: Link[],
    options: BulkExportOptionsDto
  ): Promise<ExportLinkData[]> {
    const records: ExportLinkData[] = [];

    for (const link of links) {
      const record: ExportLinkData = {
        id: link.id,
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        customAlias: link.customAlias,
        title: link.title,
        isActive: link.isActive,
        expiresAt: link.expiresAt,
        passwordProtected: !!link.passwordHash,
        passwordHint: link.passwordHint,
        iosUrl: link.iosUrl,
        androidUrl: link.androidUrl,
        utmSource: link.utmSource,
        utmMedium: link.utmMedium,
        utmCampaign: link.utmCampaign,
        utmTerm: link.utmTerm,
        utmContent: link.utmContent,
        metaPixelId: link.metaPixelId,
        googleAnalyticsId: link.googleAnalyticsId,
        tiktokPixelId: link.tiktokPixelId,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      };

      // Add tags if requested
      if (options.includeTags) {
        record.tags = await this.getLinkTags(link.id);
      }

      // Add geo rules if requested
      if (options.includeGeoRules) {
        record.geoRules = await this.getLinkGeoRules(link.id);
      }

      // Add analytics data if requested
      if (options.includeAnalytics) {
        const analytics = await this.getLinkAnalytics(link.id);
        record.totalClicks = analytics.totalClicks;
        record.uniqueClicks = analytics.uniqueClicks;
        record.lastClickedAt = analytics.lastClickedAt;
        record.topCountries = analytics.topCountries;
        record.topDevices = analytics.topDevices;
        record.topBrowsers = analytics.topBrowsers;
        record.topReferrers = analytics.topReferrers;
      }

      records.push(record);
    }

    return records;
  }

  /**
   * Get tags for a link as comma-separated string
   */
  private async getLinkTags(linkId: string): Promise<string> {
    const linkTags = await this.linkTagRepository.find({
      where: { link: { id: linkId } },
      relations: ['tag'],
    });

    return linkTags.map(lt => lt.tag.name).join(', ');
  }

  /**
   * Get geo rules for a link as JSON string
   */
  private async getLinkGeoRules(linkId: string): Promise<string> {
    // This would depend on your GeoRule entity implementation
    // For now, returning empty JSON array
    return '[]';
  }

  /**
   * Get analytics data for a link
   */
  private async getLinkAnalytics(linkId: string): Promise<{
    totalClicks: number;
    uniqueClicks: number;
    lastClickedAt?: Date;
    topCountries: string;
    topDevices: string;
    topBrowsers: string;
    topReferrers: string;
  }> {
    const [
      totalClicks,
      uniqueClicks,
      lastClick,
      topCountries,
      topDevices,
      topBrowsers,
      topReferrers,
    ] = await Promise.all([
      this.clickEventModel.countDocuments({ linkId }),
      this.clickEventModel.distinct('ipHash', { linkId }).then(ips => ips.length),
      this.clickEventModel.findOne({ linkId }, {}, { sort: { clickedAt: -1 } }),
      this.getTopAnalyticsData(linkId, 'country', 3),
      this.getTopAnalyticsData(linkId, 'device', 3),
      this.getTopAnalyticsData(linkId, 'browser', 3),
      this.getTopAnalyticsData(linkId, 'referrer', 3),
    ]);

    return {
      totalClicks,
      uniqueClicks,
      lastClickedAt: lastClick?.clickedAt,
      topCountries: topCountries.join(', '),
      topDevices: topDevices.join(', '),
      topBrowsers: topBrowsers.join(', '),
      topReferrers: topReferrers.join(', '),
    };
  }

  private async getTopAnalyticsData(
    linkId: string,
    field: string,
    limit: number
  ): Promise<string[]> {
    const results = await this.clickEventModel.aggregate([
      { $match: { linkId } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    return results.map(r => r._id).filter(id => id);
  }

  /**
   * Build CSV headers based on export options
   */
  private buildCsvHeaders(options: BulkExportOptionsDto): any[] {
    const baseHeaders = [
      { id: 'id', title: 'ID' },
      { id: 'originalUrl', title: 'Original URL' },
      { id: 'shortCode', title: 'Short Code' },
      { id: 'customAlias', title: 'Custom Alias' },
      { id: 'title', title: 'Title' },
      { id: 'isActive', title: 'Is Active' },
      { id: 'expiresAt', title: 'Expires At' },
      { id: 'passwordProtected', title: 'Password Protected' },
      { id: 'passwordHint', title: 'Password Hint' },
      { id: 'iosUrl', title: 'iOS URL' },
      { id: 'androidUrl', title: 'Android URL' },
      { id: 'utmSource', title: 'UTM Source' },
      { id: 'utmMedium', title: 'UTM Medium' },
      { id: 'utmCampaign', title: 'UTM Campaign' },
      { id: 'utmTerm', title: 'UTM Term' },
      { id: 'utmContent', title: 'UTM Content' },
      { id: 'metaPixelId', title: 'Meta Pixel ID' },
      { id: 'googleAnalyticsId', title: 'Google Analytics ID' },
      { id: 'tiktokPixelId', title: 'TikTok Pixel ID' },
      { id: 'createdAt', title: 'Created At' },
      { id: 'updatedAt', title: 'Updated At' },
    ];

    if (options.includeTags) {
      baseHeaders.push({ id: 'tags', title: 'Tags' });
    }

    if (options.includeGeoRules) {
      baseHeaders.push({ id: 'geoRules', title: 'Geo Rules' });
    }

    if (options.includeAnalytics) {
      baseHeaders.push(
        { id: 'totalClicks', title: 'Total Clicks' },
        { id: 'uniqueClicks', title: 'Unique Clicks' },
        { id: 'lastClickedAt', title: 'Last Clicked At' },
        { id: 'topCountries', title: 'Top Countries' },
        { id: 'topDevices', title: 'Top Devices' },
        { id: 'topBrowsers', title: 'Top Browsers' },
        { id: 'topReferrers', title: 'Top Referrers' }
      );
    }

    return baseHeaders;
  }

  /**
   * Create downloadable file URL
   */
  createDownloadUrl(filepath: string): string {
    const filename = path.basename(filepath);
    // This would typically be a signed URL or served through a download endpoint
    return `/api/bulk-operations/download/${filename}`;
  }

  /**
   * Clean up old export files
   */
  async cleanupOldExports(daysOld: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const files = fs.readdirSync(this.exportDir);
    let deletedCount = 0;

    for (const file of files) {
      const filepath = path.join(this.exportDir, file);
      const stats = fs.statSync(filepath);
      
      if (stats.mtime < cutoffDate) {
        fs.unlinkSync(filepath);
        deletedCount++;
      }
    }

    this.logger.log(`Cleaned up ${deletedCount} old export files`);
    return deletedCount;
  }

  /**
   * Estimate processing time based on record count
   */
  private estimateProcessingTime(recordCount: number): number {
    // Rough estimate: 1000 records = 10 seconds processing time
    const estimatedSeconds = Math.ceil((recordCount / 1000) * 10);
    return Math.max(estimatedSeconds, 5); // Minimum 5 seconds
  }

  /**
   * Get export job status
   */
  async getJobStatus(jobId: string): Promise<any> {
    const job = await this.exportQueue.getJob(jobId);
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

  /**
   * Get file for download
   */
  getExportFile(filename: string): string {
    const filepath = path.join(this.exportDir, filename);
    
    if (!fs.existsSync(filepath)) {
      throw new Error('Export file not found');
    }

    return filepath;
  }
}