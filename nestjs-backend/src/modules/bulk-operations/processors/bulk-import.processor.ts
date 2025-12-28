import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

import { BulkImportService, BulkImportJobData } from '../services/bulk-import.service';
import { ProgressTrackingService } from '../services/progress-tracking.service';
import { BulkOperationStatus } from '../schemas/bulk-operation.schema';

@Processor('bulk-import')
export class BulkImportProcessor {
  private readonly logger = new Logger(BulkImportProcessor.name);

  constructor(
    private bulkImportService: BulkImportService,
    private progressTrackingService: ProgressTrackingService,
  ) {}

  @Process('process-import')
  async processImport(job: Job<BulkImportJobData>): Promise<void> {
    const { operationId, userId, fileBuffer, filename, options } = job.data;
    
    this.logger.log(`Processing import job ${job.id} for operation ${operationId}`);

    try {
      // Update status to processing
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.PROCESSING);

      // Parse CSV file
      job.progress(10);
      const { records, headers, totalRecords } = await this.bulkImportService.parseCsvFile(fileBuffer);
      
      this.logger.log(`Parsed ${totalRecords} records from CSV file`);

      // Validate headers
      const headerErrors = this.bulkImportService['validationService'].validateCsvHeaders(headers);
      if (headerErrors.length > 0) {
        await this.progressTrackingService.addErrors(operationId, headerErrors);
        throw new Error(`Invalid CSV headers: ${headerErrors.map(e => e.message).join(', ')}`);
      }

      // Update progress with total records
      await this.progressTrackingService.updateProgress(operationId, {
        totalRecords,
        processedRecords: 0,
        successfulRecords: 0,
        failedRecords: 0,
      });

      job.progress(20);

      // Process records in batches
      const batchSize = options.batchSize || 100;
      let totalSuccessful = 0;
      let totalFailed = 0;
      let processedRecords = 0;

      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const batchStartIndex = i;

        this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(records.length / batchSize)}`);

        try {
          const result = await this.bulkImportService.processBatch(
            batch,
            userId,
            options,
            operationId,
            batchStartIndex
          );

          totalSuccessful += result.successful;
          totalFailed += result.failed;
          processedRecords += batch.length;

          // Update progress
          const progressPercentage = 20 + Math.round((processedRecords / totalRecords) * 70);
          job.progress(progressPercentage);

          await this.progressTrackingService.updateProgress(operationId, {
            processedRecords,
            successfulRecords: totalSuccessful,
            failedRecords: totalFailed,
          });

          this.logger.log(`Batch completed: ${result.successful} successful, ${result.failed} failed`);

        } catch (error) {
          this.logger.error(`Error processing batch starting at index ${batchStartIndex}:`, error);
          
          // Mark all records in this batch as failed
          totalFailed += batch.length;
          processedRecords += batch.length;

          await this.progressTrackingService.addError(operationId, {
            message: `Batch processing failed: ${error.message}`,
            value: `Batch starting at row ${batchStartIndex + 1}`,
          });
        }
      }

      job.progress(95);

      // Final progress update
      await this.progressTrackingService.updateProgress(operationId, {
        processedRecords: totalRecords,
        successfulRecords: totalSuccessful,
        failedRecords: totalFailed,
        percentage: 100,
      });

      // Update status to completed
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.COMPLETED);

      job.progress(100);

      this.logger.log(`Import completed for operation ${operationId}: ${totalSuccessful} successful, ${totalFailed} failed`);

    } catch (error) {
      this.logger.error(`Import job ${job.id} failed:`, error);
      
      // Update status to failed
      await this.progressTrackingService.updateStatus(operationId, BulkOperationStatus.FAILED);
      
      // Add error to operation
      await this.progressTrackingService.addError(operationId, {
        message: `Import job failed: ${error.message}`,
      });

      throw error;
    }
  }

  @OnQueueActive()
  onActive(job: Job<BulkImportJobData>) {
    this.logger.log(`Import job ${job.id} started for operation ${job.data.operationId}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job<BulkImportJobData>) {
    this.logger.log(`Import job ${job.id} completed for operation ${job.data.operationId}`);
  }

  @OnQueueFailed()
  onFailed(job: Job<BulkImportJobData>, error: Error) {
    this.logger.error(`Import job ${job.id} failed for operation ${job.data.operationId}:`, error);
  }
}