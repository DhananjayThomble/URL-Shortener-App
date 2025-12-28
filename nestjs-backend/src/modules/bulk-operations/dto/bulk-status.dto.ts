import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BulkOperationStatus, BulkOperationType, BulkOperationError, BulkOperationProgress } from '../schemas/bulk-operation.schema';

export class BulkOperationStatusDto {
  @ApiProperty({ description: 'Operation ID' })
  id: string;

  @ApiProperty({ description: 'User ID who initiated the operation' })
  userId: string;

  @ApiProperty({ description: 'Type of bulk operation', enum: BulkOperationType })
  type: BulkOperationType;

  @ApiProperty({ description: 'Current status of the operation', enum: BulkOperationStatus })
  status: BulkOperationStatus;

  @ApiProperty({ description: 'Bull queue job ID' })
  jobId: string;

  @ApiPropertyOptional({ description: 'Original filename of uploaded file' })
  originalFilename?: string;

  @ApiPropertyOptional({ description: 'File size in bytes' })
  fileSize?: number;

  @ApiProperty({ description: 'Progress information' })
  progress: BulkOperationProgress;

  @ApiProperty({ description: 'List of errors encountered', type: [Object] })
  errors: BulkOperationError[];

  @ApiPropertyOptional({ description: 'URL to download result file' })
  resultFileUrl?: string;

  @ApiPropertyOptional({ description: 'When the operation started' })
  startedAt?: Date;

  @ApiPropertyOptional({ description: 'When the operation completed' })
  completedAt?: Date;

  @ApiProperty({ description: 'When the operation was created' })
  createdAt: Date;

  @ApiProperty({ description: 'When the operation was last updated' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: Record<string, any>;
}

export class BulkOperationListDto {
  @ApiProperty({ description: 'List of bulk operations', type: [BulkOperationStatusDto] })
  operations: BulkOperationStatusDto[];

  @ApiProperty({ description: 'Total number of operations' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}