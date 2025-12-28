import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { BulkExportService, BulkExportJobData } from '../services/bulk-export.service';
import { ProgressTrackingService } from '../services/progress-tracking.service';
import { BulkOperationStatus } from '../schemas/bulk-operation.schema';

@Processor('bulk-export')
export class BulkExportProcessor {
  private readonly logger = new Logger(BulkExportProcessor.name);

  constructor(
    private bulkExportService: BulkExportService,
    private progressTrackingService: ProgressTrackingService,
  ) {}

  @Process('process-export')
  async processExport(job: Job<BulkExportJobData>): Promise<void> {
    const { operationId, userId, options } = job.data;
    
    this.logger.log(`Processing export job ${job.id} for operation ${operationId}`);

    try {
      // Update status to processing
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.PROCESSING);
      job.progress(10);

      // Export links to CSV
      this.logger.log(`Starting CSV export for user ${userId}`);
      const filepath = await this.bulkExportService.exportLinksToCSV(userId, options, operationId);
      
      job.progress(90);

      // Create download URL
      const downloadUrl = this.bulkExportService.createDownloadUrl(filepath);
      
      // Set result file URL
      await this.progressTrackingService.setResultFileUrl(operationId, downloadUrl);

      // Update status to completed
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.COMPLETED);

      job.progress(100);

      this.logger.log(`Export completed for operation ${operationId}: ${filepath}`);

    } catch (error) {
      this.logger.error(`Export job ${job.id} failed:`, error);
      
      // Update status to failed
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.FAILED);
      
      // Add error to operation
      await this.progressTrackingService.addError(operationId, {
        message: `Export job failed: ${error.message}`,
      });

      throw error;
    }
  }

  @OnQueueActive()
  onActive(job: Job<BulkExportJobData>) {
    this.logger.log(`Export job ${job.id} started for operation ${job.data.operationId}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job<BulkExportJobData>) {
    this.logger.log(`Export job ${job.id} completed for operation ${job.data.operationId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job<BulkExportJobData>, error: Error) {
    this.logger.error(`Export job ${job.id} failed for operation ${job.data.operationId}:`, error);
  }
}