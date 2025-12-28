import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BulkOperation, BulkOperationDocument, BulkOperationStatus, BulkOperationProgress, BulkOperationError } from '../schemas/bulk-operation.schema';

@Injectable()
export class ProgressTrackingService {
  constructor(
    @InjectModel(BulkOperation.name)
    private bulkOperationModel: Model<BulkOperationDocument>,
  ) {}

  /**
   * Create a new bulk operation record
   */
  async createOperation(operationData: Partial<BulkOperation>): Promise<BulkOperationDocument> {
    const operation = new this.bulkOperationModel({
      ...operationData,
      progress: {
        totalRecords: 0,
        processedRecords: 0,
        successfulRecords: 0,
        failedRecords: 0,
        percentage: 0,
      },
      errors: [],
    });

    return operation.save();
  }

  /**
   * Update operation status
   */
  async updateStatus(operationId: string, status: BulkOperationStatus): Promise<void> {
    const updateData: any = { status };

    if (status === BulkOperationStatus.PROCESSING) {
      updateData.startedAt = new Date();
    } else if (status === BulkOperationStatus.COMPLETED || status === BulkOperationStatus.FAILED) {
      updateData.completedAt = new Date();
    }

    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      updateData
    );
  }

  /**
   * Update operation progress
   */
  async updateProgress(
    operationId: string,
    progress: Partial<BulkOperationProgress>
  ): Promise<void> {
    const operation = await this.bulkOperationModel.findById(operationId);
    if (!operation) {
      throw new Error(`Operation ${operationId} not found`);
    }

    const updatedProgress = {
      ...operation.progress,
      ...progress,
    };

    // Calculate percentage
    if (updatedProgress.totalRecords > 0) {
      updatedProgress.percentage = Math.round(
        (updatedProgress.processedRecords / updatedProgress.totalRecords) * 100
      );
    }

    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { progress: updatedProgress }
    );
  }

  /**
   * Add error to operation
   */
  async addError(operationId: string, error: BulkOperationError): Promise<void> {
    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { $push: { errors: error } }
    );
  }

  /**
   * Add multiple errors to operation
   */
  async addErrors(operationId: string, errors: BulkOperationError[]): Promise<void> {
    if (errors.length === 0) return;

    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { $push: { errors: { $each: errors } } }
    );
  }

  /**
   * Set result file URL
   */
  async setResultFileUrl(operationId: string, fileUrl: string): Promise<void> {
    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { resultFileUrl: fileUrl }
    );
  }

  /**
   * Get operation by ID
   */
  async getOperation(operationId: string): Promise<BulkOperationDocument | null> {
    return this.bulkOperationModel.findById(operationId);
  }

  /**
   * Get operation by job ID
   */
  async getOperationByJobId(jobId: string): Promise<BulkOperationDocument | null> {
    return this.bulkOperationModel.findOne({ jobId });
  }

  /**
   * Get operations for a user with pagination
   */
  async getUserOperations(
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{
    operations: BulkOperationDocument[];
    total: number;
    totalPages: number;
  }> {
    const skip = (page - 1) * limit;

    const [operations, total] = await Promise.all([
      this.bulkOperationModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.bulkOperationModel.countDocuments({ userId }),
    ]);

    return {
      operations,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Delete old completed operations (cleanup)
   */
  async cleanupOldOperations(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.bulkOperationModel.deleteMany({
      status: { $in: [BulkOperationStatus.COMPLETED, BulkOperationStatus.FAILED] },
      completedAt: { $lt: cutoffDate },
    });

    return result.deletedCount;
  }

  /**
   * Cancel operation
   */
  async cancelOperation(operationId: string): Promise<void> {
    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { 
        status: BulkOperationStatus.CANCELLED,
        completedAt: new Date(),
      }
    );
  }

  /**
   * Update metadata
   */
  async updateMetadata(operationId: string, metadata: Record<string, any>): Promise<void> {
    await this.bulkOperationModel.updateOne(
      { _id: operationId },
      { $set: { metadata } }
    );
  }

  /**
   * Get operation statistics for a user
   */
  async getUserOperationStats(userId: string): Promise<{
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
  }> {
    const stats = await this.bulkOperationModel.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const stat of stats) {
      result[stat._id as keyof typeof result] = stat.count;
      result.total += stat.count;
    }

    return result;
  }
}