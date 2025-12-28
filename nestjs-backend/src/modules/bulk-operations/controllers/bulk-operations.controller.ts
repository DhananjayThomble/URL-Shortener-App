import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { EnhancedJwtAuthGuard } from '../../auth/guards/enhanced-jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { User } from '../../users/entities/user.entity';

import { BulkImportService } from '../services/bulk-import.service';
import { BulkExportService } from '../services/bulk-export.service';
import { ProgressTrackingService } from '../services/progress-tracking.service';
import { QueueManagementService } from '../services/queue-management.service';

import {
  BulkImportOptionsDto,
  BulkImportResponseDto,
} from '../dto/bulk-import.dto';
import {
  BulkExportOptionsDto,
  BulkExportResponseDto,
} from '../dto/bulk-export.dto';
import {
  BulkOperationStatusDto,
  BulkOperationListDto,
} from '../dto/bulk-status.dto';

@ApiTags('Bulk Operations')
@ApiBearerAuth()
@Controller('bulk-operations')
@UseGuards(EnhancedJwtAuthGuard)
export class BulkOperationsController {
  constructor(
    private bulkImportService: BulkImportService,
    private bulkExportService: BulkExportService,
    private progressTrackingService: ProgressTrackingService,
    private queueManagementService: QueueManagementService,
  ) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Import links from CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV file with link data and import options',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV file containing link data',
        },
        duplicateHandling: {
          type: 'string',
          enum: ['skip', 'update', 'error'],
          default: 'skip',
          description: 'Strategy for handling duplicate short codes',
        },
        validateUrls: {
          type: 'boolean',
          default: true,
          description: 'Whether to validate URLs before importing',
        },
        generateMissingShortCodes: {
          type: 'boolean',
          default: true,
          description: 'Whether to generate short codes for missing ones',
        },
        createMissingTags: {
          type: 'boolean',
          default: true,
          description: 'Whether to create missing tags',
        },
        batchSize: {
          type: 'number',
          default: 100,
          description: 'Batch size for processing records',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Import job started successfully',
    type: BulkImportResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file or options' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async importLinks(
    @CurrentUser() user: User,
    @UploadedFile() file: any,
    @Body() options: BulkImportOptionsDto,
  ): Promise<BulkImportResponseDto> {
    if (!file) {
      throw new BadRequestException('CSV file is required');
    }

    return this.bulkImportService.startImport(user.id, file, options);
  }

  @Post('export')
  @ApiOperation({ summary: 'Export links to CSV file' })
  @ApiBody({ type: BulkExportOptionsDto })
  @ApiResponse({
    status: 201,
    description: 'Export job started successfully',
    type: BulkExportResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async exportLinks(
    @CurrentUser() user: User,
    @Body() options: BulkExportOptionsDto,
  ): Promise<BulkExportResponseDto> {
    return this.bulkExportService.startExport(user.id, options);
  }

  @Get('operations')
  @ApiOperation({ summary: 'Get user bulk operations with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 10)' })
  @ApiResponse({
    status: 200,
    description: 'List of bulk operations',
    type: BulkOperationListDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserOperations(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<BulkOperationListDto> {
    const result = await this.progressTrackingService.getUserOperations(user.id, page, limit);

    return {
      operations: result.operations.map(op => ({
        id: op._id.toString(),
        userId: op.userId,
        type: op.type,
        status: op.status,
        jobId: op.jobId,
        originalFilename: op.originalFilename,
        fileSize: op.fileSize,
        progress: op.progress,
        errors: op.errors,
        resultFileUrl: op.resultFileUrl,
        startedAt: op.startedAt,
        completedAt: op.completedAt,
        createdAt: op.createdAt || new Date(),
        updatedAt: op.updatedAt || new Date(),
        metadata: op.metadata,
      })),
      total: result.total,
      page,
      limit,
      totalPages: result.totalPages,
    };
  }

  @Get('operations/:operationId')
  @ApiOperation({ summary: 'Get specific bulk operation status' })
  @ApiParam({ name: 'operationId', description: 'Bulk operation ID' })
  @ApiResponse({
    status: 200,
    description: 'Bulk operation details',
    type: BulkOperationStatusDto,
  })
  @ApiResponse({ status: 404, description: 'Operation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getOperationStatus(
    @CurrentUser() user: User,
    @Param('operationId') operationId: string,
  ): Promise<BulkOperationStatusDto> {
    const operation = await this.progressTrackingService.getOperation(operationId);

    if (!operation || operation.userId !== user.id) {
      throw new NotFoundException('Operation not found');
    }

    return {
      id: operation._id.toString(),
      userId: operation.userId,
      type: operation.type,
      status: operation.status,
      jobId: operation.jobId,
      originalFilename: operation.originalFilename,
      fileSize: operation.fileSize,
      progress: operation.progress,
      errors: operation.errors,
      resultFileUrl: operation.resultFileUrl,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      createdAt: operation.createdAt || new Date(),
      updatedAt: operation.updatedAt || new Date(),
      metadata: operation.metadata,
    };
  }

  @Delete('operations/:operationId')
  @ApiOperation({ summary: 'Cancel a bulk operation' })
  @ApiParam({ name: 'operationId', description: 'Bulk operation ID' })
  @ApiResponse({ status: 200, description: 'Operation cancelled successfully' })
  @ApiResponse({ status: 404, description: 'Operation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async cancelOperation(
    @CurrentUser() user: User,
    @Param('operationId') operationId: string,
  ): Promise<{ message: string }> {
    const operation = await this.progressTrackingService.getOperation(operationId);

    if (!operation || operation.userId !== user.id) {
      throw new NotFoundException('Operation not found');
    }

    // Cancel the job in the queue
    const queueName = operation.type === 'import' ? 'bulk-import' : 'bulk-export';
    await this.queueManagementService.cancelJob(queueName, operation.jobId);

    return { message: 'Operation cancelled successfully' };
  }

  @Get('download/:filename')
  @ApiOperation({ summary: 'Download export file' })
  @ApiParam({ name: 'filename', description: 'Export filename' })
  @ApiResponse({ status: 200, description: 'File download' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async downloadExportFile(
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const filepath = this.bulkExportService.getExportFile(filename);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(filepath);
    } catch (error) {
      throw new NotFoundException('Export file not found');
    }
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Get job status from queue' })
  @ApiParam({ name: 'jobId', description: 'Bull queue job ID' })
  @ApiResponse({ status: 200, description: 'Job status information' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<any> {
    // Try to find the job in both queues
    let jobStatus = await this.bulkImportService.getJobStatus(jobId);
    
    if (!jobStatus) {
      jobStatus = await this.bulkExportService.getJobStatus(jobId);
    }

    if (!jobStatus) {
      throw new NotFoundException('Job not found');
    }

    return jobStatus;
  }

  @Post('jobs/:jobId/retry')
  @ApiOperation({ summary: 'Retry a failed job' })
  @ApiParam({ name: 'jobId', description: 'Bull queue job ID' })
  @ApiResponse({ status: 200, description: 'Job retried successfully' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async retryJob(
    @Param('jobId') jobId: string,
  ): Promise<{ message: string }> {
    // Try to retry in both queues
    let retried = await this.queueManagementService.retryJob('bulk-import', jobId);
    
    if (!retried) {
      retried = await this.queueManagementService.retryJob('bulk-export', jobId);
    }

    if (!retried) {
      throw new NotFoundException('Job not found');
    }

    return { message: 'Job retried successfully' };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get user bulk operation statistics' })
  @ApiResponse({ status: 200, description: 'User operation statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserStats(
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.progressTrackingService.getUserOperationStats(user.id);
  }

  @Get('queues/stats')
  @ApiOperation({ summary: 'Get queue statistics (admin only)' })
  @ApiResponse({ status: 200, description: 'Queue statistics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getQueueStats(): Promise<any> {
    return this.queueManagementService.getQueueStats();
  }

  @Get('queues/health')
  @ApiOperation({ summary: 'Get queue health status (admin only)' })
  @ApiResponse({ status: 200, description: 'Queue health information' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getQueueHealth(): Promise<any> {
    return this.queueManagementService.getQueueHealth();
  }

  @Get('queues/metrics')
  @ApiOperation({ summary: 'Get queue metrics for monitoring (admin only)' })
  @ApiResponse({ status: 200, description: 'Queue metrics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getQueueMetrics(): Promise<any> {
    return this.queueManagementService.getQueueMetrics();
  }

  @Post('queues/:queueName/pause')
  @ApiOperation({ summary: 'Pause a queue (admin only)' })
  @ApiParam({ name: 'queueName', description: 'Queue name (bulk-import or bulk-export)' })
  @ApiResponse({ status: 200, description: 'Queue paused successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async pauseQueue(
    @Param('queueName') queueName: string,
  ): Promise<{ message: string }> {
    await this.queueManagementService.pauseQueue(queueName);
    return { message: `Queue ${queueName} paused successfully` };
  }

  @Post('queues/:queueName/resume')
  @ApiOperation({ summary: 'Resume a queue (admin only)' })
  @ApiParam({ name: 'queueName', description: 'Queue name (bulk-import or bulk-export)' })
  @ApiResponse({ status: 200, description: 'Queue resumed successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async resumeQueue(
    @Param('queueName') queueName: string,
  ): Promise<{ message: string }> {
    await this.queueManagementService.resumeQueue(queueName);
    return { message: `Queue ${queueName} resumed successfully` };
  }

  @Delete('queues/:queueName/clean')
  @ApiOperation({ summary: 'Clean completed jobs from queue (admin only)' })
  @ApiParam({ name: 'queueName', description: 'Queue name (bulk-import or bulk-export)' })
  @ApiQuery({ name: 'grace', required: false, type: Number, description: 'Grace period in milliseconds (default: 24 hours)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum jobs to clean (default: 100)' })
  @ApiResponse({ status: 200, description: 'Jobs cleaned successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async cleanQueue(
    @Param('queueName') queueName: string,
    @Query('grace', new DefaultValuePipe(24 * 60 * 60 * 1000), ParseIntPipe) grace: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<{ message: string; cleaned: number }> {
    const cleaned = await this.queueManagementService.cleanQueue(queueName, grace, limit);
    return { 
      message: `Cleaned ${cleaned} jobs from queue ${queueName}`,
      cleaned,
    };
  }

  @Get('template/import')
  @ApiOperation({ summary: 'Download CSV import template' })
  @ApiResponse({ status: 200, description: 'CSV template file' })
  async downloadImportTemplate(@Res() res: Response): Promise<void> {
    const template = [
      'originalUrl,shortCode,customAlias,title,isActive,expiresAt,password,passwordHint,iosUrl,androidUrl,utmSource,utmMedium,utmCampaign,utmTerm,utmContent,metaPixelId,googleAnalyticsId,tiktokPixelId,tags,geoRules',
      'https://example.com,abc123,,Example Link,true,2024-12-31T23:59:59.999Z,,,,,campaign,social,summer2024,,,,,,"tag1,tag2","[{""countryCode"":""US"",""redirectUrl"":""https://us.example.com""}]"',
      'https://another-example.com,def456,my-alias,Another Example,true,,mypassword,Password hint,https://ios.example.com,https://android.example.com,newsletter,email,newsletter2024,promo,header,FB123,GA456,TT789,marketing,[]',
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bulk_import_template.csv"');
    res.send(template);
  }
}