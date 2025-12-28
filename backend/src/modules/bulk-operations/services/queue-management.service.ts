import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ProgressTrackingService } from './progress-tracking.service';
import { BulkOperationStatus } from '../schemas/bulk-operation.schema';

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface JobInfo {
  id: string | number;
  name: string;
  data: any;
  progress: number;
  attemptsMade: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
  delay?: number;
  timestamp: number;
}

@Injectable()
export class QueueManagementService {
  private readonly logger = new Logger(QueueManagementService.name);

  constructor(
    @InjectQueue('bulk-import') private importQueue: Queue,
    @InjectQueue('bulk-export') private exportQueue: Queue,
    private progressTrackingService: ProgressTrackingService,
  ) {}

  /**
   * Get statistics for all queues
   */
  async getQueueStats(): Promise<QueueStats[]> {
    const queues = [
      { name: 'bulk-import', queue: this.importQueue },
      { name: 'bulk-export', queue: this.exportQueue },
    ];

    const stats: QueueStats[] = [];

    for (const { name, queue } of queues) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      stats.push({
        name,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: await queue.isPaused(),
      });
    }

    return stats;
  }

  /**
   * Get detailed information about jobs in a queue
   */
  async getQueueJobs(
    queueName: string,
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' = 'active',
    start: number = 0,
    end: number = 10
  ): Promise<JobInfo[]> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    let jobs: Job[] = [];

    switch (status) {
      case 'waiting':
        jobs = await queue.getWaiting(start, end);
        break;
      case 'active':
        jobs = await queue.getActive(start, end);
        break;
      case 'completed':
        jobs = await queue.getCompleted(start, end);
        break;
      case 'failed':
        jobs = await queue.getFailed(start, end);
        break;
      case 'delayed':
        jobs = await queue.getDelayed(start, end);
        break;
    }

    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress(),
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      delay: job.opts?.delay,
      timestamp: job.timestamp,
    }));
  }

  /**
   * Get specific job information
   */
  async getJob(queueName: string, jobId: string | number): Promise<JobInfo | null> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress(),
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      delay: job.opts?.delay,
      timestamp: job.timestamp,
    };
  }

  /**
   * Cancel a job
   */
  async cancelJob(queueName: string, jobId: string | number): Promise<boolean> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return false;
    }

    // Cancel the job
    await job.remove();

    // Update operation status if it exists
    try {
      const operation = await this.progressTrackingService.getOperationByJobId(jobId.toString());
      if (operation) {
        await this.progressTrackingService.cancelOperation(operation._id.toString());
      }
    } catch (error) {
      this.logger.warn(`Failed to update operation status for cancelled job ${jobId}:`, error);
    }

    this.logger.log(`Job ${jobId} cancelled in queue ${queueName}`);
    return true;
  }

  /**
   * Retry a failed job
   */
  async retryJob(queueName: string, jobId: string | number): Promise<boolean> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      return false;
    }

    // Retry the job
    await job.retry();

    // Update operation status if it exists
    try {
      const operation = await this.progressTrackingService.getOperationByJobId(jobId.toString());
      if (operation && operation.status === BulkOperationStatus.FAILED) {
        await this.progressTrackingService.updateStatus(
          operation._id.toString(),
          BulkOperationStatus.PENDING
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to update operation status for retried job ${jobId}:`, error);
    }

    this.logger.log(`Job ${jobId} retried in queue ${queueName}`);
    return true;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    this.logger.log(`Queue ${queueName} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    this.logger.log(`Queue ${queueName} resumed`);
  }

  /**
   * Clean completed jobs from a queue
   */
  async cleanQueue(
    queueName: string,
    grace: number = 24 * 60 * 60 * 1000, // 24 hours
    limit: number = 100
  ): Promise<number> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const cleaned = await queue.clean(grace, 'completed', limit);
    this.logger.log(`Cleaned ${cleaned.length} completed jobs from queue ${queueName}`);
    return cleaned.length;
  }

  /**
   * Clean failed jobs from a queue
   */
  async cleanFailedJobs(
    queueName: string,
    grace: number = 7 * 24 * 60 * 60 * 1000, // 7 days
    limit: number = 100
  ): Promise<number> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const cleaned = await queue.clean(grace, 'failed', limit);
    this.logger.log(`Cleaned ${cleaned.length} failed jobs from queue ${queueName}`);
    return cleaned.length;
  }

  /**
   * Get queue health status
   */
  async getQueueHealth(): Promise<{
    healthy: boolean;
    issues: string[];
    stats: QueueStats[];
  }> {
    const stats = await this.getQueueStats();
    const issues: string[] = [];
    let healthy = true;

    for (const stat of stats) {
      // Check for too many failed jobs
      if (stat.failed > 50) {
        issues.push(`Queue ${stat.name} has ${stat.failed} failed jobs`);
        healthy = false;
      }

      // Check for too many waiting jobs
      if (stat.waiting > 1000) {
        issues.push(`Queue ${stat.name} has ${stat.waiting} waiting jobs`);
        healthy = false;
      }

      // Check if queue is paused
      if (stat.paused) {
        issues.push(`Queue ${stat.name} is paused`);
        healthy = false;
      }
    }

    return { healthy, issues, stats };
  }

  /**
   * Scheduled cleanup of old jobs
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledCleanup(): Promise<void> {
    this.logger.log('Starting scheduled queue cleanup');

    try {
      const queues = ['bulk-import', 'bulk-export'];
      
      for (const queueName of queues) {
        // Clean completed jobs older than 24 hours
        const completedCleaned = await this.cleanQueue(queueName, 24 * 60 * 60 * 1000, 1000);
        
        // Clean failed jobs older than 7 days
        const failedCleaned = await this.cleanFailedJobs(queueName, 7 * 24 * 60 * 60 * 1000, 1000);
        
        this.logger.log(`Queue ${queueName}: cleaned ${completedCleaned} completed, ${failedCleaned} failed jobs`);
      }

      // Also cleanup old bulk operations
      const operationsCleaned = await this.progressTrackingService.cleanupOldOperations(30);
      this.logger.log(`Cleaned up ${operationsCleaned} old bulk operations`);

    } catch (error) {
      this.logger.error('Scheduled cleanup failed:', error);
    }
  }

  /**
   * Get queue instance by name
   */
  private getQueue(queueName: string): Queue | null {
    switch (queueName) {
      case 'bulk-import':
        return this.importQueue;
      case 'bulk-export':
        return this.exportQueue;
      default:
        return null;
    }
  }

  /**
   * Add job with custom options
   */
  async addJob(
    queueName: string,
    jobName: string,
    data: any,
    options?: JobOptions
  ): Promise<Job> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return queue.add(jobName, data, options);
  }

  /**
   * Get queue metrics for monitoring
   */
  async getQueueMetrics(): Promise<{
    totalJobs: number;
    activeJobs: number;
    waitingJobs: number;
    completedJobs: number;
    failedJobs: number;
    throughput: {
      completedLastHour: number;
      failedLastHour: number;
    };
  }> {
    const stats = await this.getQueueStats();
    
    const totalActive = stats.reduce((sum, stat) => sum + stat.active, 0);
    const totalWaiting = stats.reduce((sum, stat) => sum + stat.waiting, 0);
    const totalCompleted = stats.reduce((sum, stat) => sum + stat.completed, 0);
    const totalFailed = stats.reduce((sum, stat) => sum + stat.failed, 0);

    // Get throughput metrics (simplified - would need more sophisticated tracking in production)
    const completedLastHour = Math.floor(totalCompleted * 0.1); // Placeholder
    const failedLastHour = Math.floor(totalFailed * 0.05); // Placeholder

    return {
      totalJobs: totalActive + totalWaiting + totalCompleted + totalFailed,
      activeJobs: totalActive,
      waitingJobs: totalWaiting,
      completedJobs: totalCompleted,
      failedJobs: totalFailed,
      throughput: {
        completedLastHour,
        failedLastHour,
      },
    };
  }
}