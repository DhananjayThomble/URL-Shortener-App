import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BulkOperationDocument = BulkOperation & Document;

export enum BulkOperationType {
  IMPORT = 'import',
  EXPORT = 'export',
}

export enum BulkOperationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface BulkOperationError {
  row?: number;
  field?: string;
  message: string;
  value?: any;
}

export interface BulkOperationProgress {
  totalRecords: number;
  processedRecords: number;
  successfulRecords: number;
  failedRecords: number;
  percentage: number;
}

@Schema({ timestamps: true })
export class BulkOperation {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: BulkOperationType })
  type: BulkOperationType;

  @Prop({ required: true, enum: BulkOperationStatus, default: BulkOperationStatus.PENDING })
  status: BulkOperationStatus;

  @Prop({ required: true })
  jobId: string;

  @Prop()
  filename?: string;

  @Prop()
  originalFilename?: string;

  @Prop()
  fileSize?: number;

  @Prop()
  mimeType?: string;

  @Prop({ type: Object })
  progress: BulkOperationProgress;

  @Prop({ type: [Object] })
  errors: BulkOperationError[];

  @Prop()
  resultFileUrl?: string;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

export const BulkOperationSchema = SchemaFactory.createForClass(BulkOperation);

// Indexes for efficient querying
BulkOperationSchema.index({ userId: 1, createdAt: -1 });
BulkOperationSchema.index({ jobId: 1 });
BulkOperationSchema.index({ status: 1 });