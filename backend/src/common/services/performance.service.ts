import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PerformanceMetrics {
  responseTime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  activeConnections: number;
  requestsPerSecond: number;
  errorRate: number;
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private requestCount = 0;
  private errorCount = 0;
  private startTime = Date.now();
  private lastResetTime = Date.now();

  constructor(private configService: ConfigService) {}

  trackRequest(): void {
    this.requestCount++;
  }

  trackError(): void {
    this.errorCount++;
  }

  getMetrics(): PerformanceMetrics {
    const now = Date.now();
    const uptime = now - this.startTime;
    const timeSinceReset = now - this.lastResetTime;
    
    return {
      responseTime: 0, // Would be calculated from request interceptor
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      activeConnections: 0, // Would be tracked from connection pool
      requestsPerSecond: this.requestCount / (timeSinceReset / 1000),
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
    };
  }

  resetCounters(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.lastResetTime = Date.now();
  }

  getHealthScore(): number {
    const metrics = this.getMetrics();
    let score = 100;

    // Deduct points for high memory usage
    const memoryUsageMB = metrics.memoryUsage.heapUsed / 1024 / 1024;
    if (memoryUsageMB > 500) score -= 20;
    else if (memoryUsageMB > 200) score -= 10;

    // Deduct points for high error rate
    if (metrics.errorRate > 5) score -= 30;
    else if (metrics.errorRate > 1) score -= 15;

    // Deduct points for low RPS (might indicate issues)
    if (metrics.requestsPerSecond < 1 && this.requestCount > 10) score -= 10;

    return Math.max(0, score);
  }

  getOptimizationRecommendations(): string[] {
    const metrics = this.getMetrics();
    const recommendations: string[] = [];

    const memoryUsageMB = metrics.memoryUsage.heapUsed / 1024 / 1024;
    if (memoryUsageMB > 500) {
      recommendations.push('High memory usage detected. Consider implementing memory optimization strategies.');
    }

    if (metrics.errorRate > 5) {
      recommendations.push('High error rate detected. Review error handling and logging.');
    }

    if (metrics.requestsPerSecond > 100) {
      recommendations.push('High request volume. Consider implementing additional caching strategies.');
    }

    const heapUsedRatio = metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal;
    if (heapUsedRatio > 0.8) {
      recommendations.push('Heap usage is high. Consider garbage collection optimization.');
    }

    return recommendations;
  }

  formatMemoryUsage(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async measureAsyncOperation<T>(
    operation: () => Promise<T>,
    operationName: string,
  ): Promise<{ result: T; duration: number }> {
    const startTime = process.hrtime.bigint();
    
    try {
      const result = await operation();
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      
      this.logger.debug(`${operationName} completed in ${duration.toFixed(2)}ms`);
      
      return { result, duration };
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      
      this.logger.error(`${operationName} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }

  measureSyncOperation<T>(
    operation: () => T,
    operationName: string,
  ): { result: T; duration: number } {
    const startTime = process.hrtime.bigint();
    
    try {
      const result = operation();
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      
      this.logger.debug(`${operationName} completed in ${duration.toFixed(2)}ms`);
      
      return { result, duration };
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;
      
      this.logger.error(`${operationName} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }
}