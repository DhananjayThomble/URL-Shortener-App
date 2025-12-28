/**
 * Performance Monitoring Utilities
 * Provides tools for measuring and analyzing performance metrics
 */

import { performance } from 'perf_hooks';
import * as fs from 'fs';
import * as path from 'path';

export interface PerformanceMetrics {
  testName: string;
  timestamp: Date;
  duration: number;
  throughput: number;
  successRate: number;
  memoryUsage: {
    initial: NodeJS.MemoryUsage;
    peak: NodeJS.MemoryUsage;
    final: NodeJS.MemoryUsage;
  };
  responseTimeStats: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errorBreakdown: Record<string, number>;
  metadata: Record<string, any>;
}

export class PerformanceMonitor {
  private startTime: number;
  private endTime: number;
  private initialMemory: NodeJS.MemoryUsage;
  private peakMemory: NodeJS.MemoryUsage;
  private finalMemory: NodeJS.MemoryUsage;
  private responseTimes: number[] = [];
  private errors: Record<string, number> = {};
  private successCount = 0;
  private totalCount = 0;

  constructor(private testName: string) {
    this.reset();
  }

  reset(): void {
    this.startTime = 0;
    this.endTime = 0;
    this.initialMemory = process.memoryUsage();
    this.peakMemory = this.initialMemory;
    this.finalMemory = this.initialMemory;
    this.responseTimes = [];
    this.errors = {};
    this.successCount = 0;
    this.totalCount = 0;
  }

  start(): void {
    this.startTime = performance.now();
    this.initialMemory = process.memoryUsage();
    this.peakMemory = this.initialMemory;
  }

  end(): void {
    this.endTime = performance.now();
    this.finalMemory = process.memoryUsage();
  }

  recordResponse(responseTime: number, success: boolean, error?: string): void {
    this.responseTimes.push(responseTime);
    this.totalCount++;
    
    if (success) {
      this.successCount++;
    } else if (error) {
      this.errors[error] = (this.errors[error] || 0) + 1;
    }

    // Update peak memory if current usage is higher
    const currentMemory = process.memoryUsage();
    if (currentMemory.heapUsed > this.peakMemory.heapUsed) {
      this.peakMemory = currentMemory;
    }
  }

  recordBatchResponse(responses: Array<{ responseTime: number; success: boolean; error?: string }>): void {
    responses.forEach(response => {
      this.recordResponse(response.responseTime, response.success, response.error);
    });
  }

  getDuration(): number {
    return this.endTime - this.startTime;
  }

  getThroughput(): number {
    const durationSeconds = this.getDuration() / 1000;
    return this.totalCount / durationSeconds;
  }

  getSuccessRate(): number {
    return this.totalCount > 0 ? (this.successCount / this.totalCount) * 100 : 0;
  }

  getResponseTimeStats(): PerformanceMetrics['responseTimeStats'] {
    if (this.responseTimes.length === 0) {
      return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, time) => acc + time, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: this.getPercentile(sorted, 50),
      p95: this.getPercentile(sorted, 95),
      p99: this.getPercentile(sorted, 99),
    };
  }

  private getPercentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)];
  }

  getMetrics(metadata: Record<string, any> = {}): PerformanceMetrics {
    return {
      testName: this.testName,
      timestamp: new Date(),
      duration: this.getDuration(),
      throughput: this.getThroughput(),
      successRate: this.getSuccessRate(),
      memoryUsage: {
        initial: this.initialMemory,
        peak: this.peakMemory,
        final: this.finalMemory,
      },
      responseTimeStats: this.getResponseTimeStats(),
      errorBreakdown: { ...this.errors },
      metadata: {
        totalRequests: this.totalCount,
        successfulRequests: this.successCount,
        failedRequests: this.totalCount - this.successCount,
        ...metadata,
      },
    };
  }

  printSummary(): void {
    const metrics = this.getMetrics();
    const memoryDelta = (metrics.memoryUsage.final.heapUsed - metrics.memoryUsage.initial.heapUsed) / 1024 / 1024;
    const peakMemoryDelta = (metrics.memoryUsage.peak.heapUsed - metrics.memoryUsage.initial.heapUsed) / 1024 / 1024;

    console.log(`\\n=== ${this.testName} Performance Summary ===`);
    console.log(`Duration: ${metrics.duration.toFixed(2)}ms`);
    console.log(`Throughput: ${metrics.throughput.toFixed(2)} req/s`);
    console.log(`Success Rate: ${metrics.successRate.toFixed(2)}%`);
    console.log(`Total Requests: ${metrics.metadata.totalRequests}`);
    console.log(`Successful: ${metrics.metadata.successfulRequests}`);
    console.log(`Failed: ${metrics.metadata.failedRequests}`);
    
    console.log(`\\nResponse Time Statistics:`);
    console.log(`- Min: ${metrics.responseTimeStats.min.toFixed(2)}ms`);
    console.log(`- Max: ${metrics.responseTimeStats.max.toFixed(2)}ms`);
    console.log(`- Average: ${metrics.responseTimeStats.avg.toFixed(2)}ms`);
    console.log(`- P50: ${metrics.responseTimeStats.p50.toFixed(2)}ms`);
    console.log(`- P95: ${metrics.responseTimeStats.p95.toFixed(2)}ms`);
    console.log(`- P99: ${metrics.responseTimeStats.p99.toFixed(2)}ms`);
    
    console.log(`\\nMemory Usage:`);
    console.log(`- Initial: ${(metrics.memoryUsage.initial.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    console.log(`- Peak: ${(metrics.memoryUsage.peak.heapUsed / 1024 / 1024).toFixed(2)}MB (+${peakMemoryDelta.toFixed(2)}MB)`);
    console.log(`- Final: ${(metrics.memoryUsage.final.heapUsed / 1024 / 1024).toFixed(2)}MB (+${memoryDelta.toFixed(2)}MB)`);
    
    if (Object.keys(metrics.errorBreakdown).length > 0) {
      console.log(`\\nError Breakdown:`);
      Object.entries(metrics.errorBreakdown).forEach(([error, count]) => {
        console.log(`- ${error}: ${count}`);
      });
    }
    
    console.log(`===============================================\\n`);
  }
}

export class PerformanceReporter {
  private static readonly REPORTS_DIR = path.join(__dirname, '../reports');
  private static readonly PERFORMANCE_REPORT_FILE = path.join(this.REPORTS_DIR, 'performance-report.json');
  private static readonly BENCHMARK_HISTORY_FILE = path.join(this.REPORTS_DIR, 'benchmark-history.json');

  static async saveMetrics(metrics: PerformanceMetrics): Promise<void> {
    await this.ensureReportsDirectory();
    
    // Save to performance report
    let existingMetrics: PerformanceMetrics[] = [];
    if (fs.existsSync(this.PERFORMANCE_REPORT_FILE)) {
      const existingData = fs.readFileSync(this.PERFORMANCE_REPORT_FILE, 'utf8');
      existingMetrics = JSON.parse(existingData);
    }
    
    existingMetrics.push(metrics);
    
    // Keep only last 1000 entries to prevent file from growing too large
    if (existingMetrics.length > 1000) {
      existingMetrics = existingMetrics.slice(-1000);
    }
    
    fs.writeFileSync(this.PERFORMANCE_REPORT_FILE, JSON.stringify(existingMetrics, null, 2));
    
    // Update benchmark history for trend analysis
    await this.updateBenchmarkHistory(metrics);
  }

  private static async updateBenchmarkHistory(metrics: PerformanceMetrics): Promise<void> {
    let history: Record<string, PerformanceMetrics[]> = {};
    
    if (fs.existsSync(this.BENCHMARK_HISTORY_FILE)) {
      const existingData = fs.readFileSync(this.BENCHMARK_HISTORY_FILE, 'utf8');
      history = JSON.parse(existingData);
    }
    
    if (!history[metrics.testName]) {
      history[metrics.testName] = [];
    }
    
    history[metrics.testName].push(metrics);
    
    // Keep only last 50 entries per test
    if (history[metrics.testName].length > 50) {
      history[metrics.testName] = history[metrics.testName].slice(-50);
    }
    
    fs.writeFileSync(this.BENCHMARK_HISTORY_FILE, JSON.stringify(history, null, 2));
  }

  static async generateTrendReport(): Promise<string> {
    if (!fs.existsSync(this.BENCHMARK_HISTORY_FILE)) {
      return 'No benchmark history available';
    }
    
    const historyData = fs.readFileSync(this.BENCHMARK_HISTORY_FILE, 'utf8');
    const history: Record<string, PerformanceMetrics[]> = JSON.parse(historyData);
    
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {},
      trends: {},
    };
    
    Object.entries(history).forEach(([testName, metrics]) => {
      if (metrics.length < 2) return;
      
      const latest = metrics[metrics.length - 1];
      const previous = metrics[metrics.length - 2];
      
      const throughputTrend = ((latest.throughput - previous.throughput) / previous.throughput) * 100;
      const responseTimeTrend = ((latest.responseTimeStats.avg - previous.responseTimeStats.avg) / previous.responseTimeStats.avg) * 100;
      const successRateTrend = latest.successRate - previous.successRate;
      
      report.summary[testName] = {
        latestThroughput: latest.throughput,
        latestResponseTime: latest.responseTimeStats.avg,
        latestSuccessRate: latest.successRate,
        runsCount: metrics.length,
      };
      
      report.trends[testName] = {
        throughputTrend: throughputTrend.toFixed(2) + '%',
        responseTimeTrend: responseTimeTrend.toFixed(2) + '%',
        successRateTrend: successRateTrend.toFixed(2) + '%',
        improving: throughputTrend > 0 && responseTimeTrend < 0 && successRateTrend >= 0,
      };
    });
    
    return JSON.stringify(report, null, 2);
  }

  private static async ensureReportsDirectory(): Promise<void> {
    if (!fs.existsSync(this.REPORTS_DIR)) {
      fs.mkdirSync(this.REPORTS_DIR, { recursive: true });
    }
  }
}

export class LoadTestRunner {
  private monitor: PerformanceMonitor;
  
  constructor(testName: string) {
    this.monitor = new PerformanceMonitor(testName);
  }

  async runLoadTest<T>(
    testConfig: {
      concurrency: number;
      duration?: number;
      iterations?: number;
      rampUpTime?: number;
    },
    requestFunction: () => Promise<T>,
    validateResponse?: (response: T) => boolean
  ): Promise<PerformanceMetrics> {
    const { concurrency, duration, iterations, rampUpTime = 0 } = testConfig;
    
    this.monitor.start();
    
    if (duration) {
      await this.runDurationBasedTest(concurrency, duration, rampUpTime, requestFunction, validateResponse);
    } else if (iterations) {
      await this.runIterationBasedTest(concurrency, iterations, rampUpTime, requestFunction, validateResponse);
    } else {
      throw new Error('Either duration or iterations must be specified');
    }
    
    this.monitor.end();
    
    const metrics = this.monitor.getMetrics({
      concurrency,
      duration,
      iterations,
      rampUpTime,
    });
    
    await PerformanceReporter.saveMetrics(metrics);
    this.monitor.printSummary();
    
    return metrics;
  }

  private async runDurationBasedTest<T>(
    concurrency: number,
    duration: number,
    rampUpTime: number,
    requestFunction: () => Promise<T>,
    validateResponse?: (response: T) => boolean
  ): Promise<void> {
    const endTime = Date.now() + duration;
    const workers: Promise<void>[] = [];
    
    for (let i = 0; i < concurrency; i++) {
      const delay = rampUpTime > 0 ? (i * rampUpTime) / concurrency : 0;
      
      workers.push(
        this.runWorker(endTime, delay, requestFunction, validateResponse)
      );
    }
    
    await Promise.all(workers);
  }

  private async runIterationBasedTest<T>(
    concurrency: number,
    iterations: number,
    rampUpTime: number,
    requestFunction: () => Promise<T>,
    validateResponse?: (response: T) => boolean
  ): Promise<void> {
    const iterationsPerWorker = Math.ceil(iterations / concurrency);
    const workers: Promise<void>[] = [];
    
    for (let i = 0; i < concurrency; i++) {
      const delay = rampUpTime > 0 ? (i * rampUpTime) / concurrency : 0;
      const workerIterations = Math.min(iterationsPerWorker, iterations - (i * iterationsPerWorker));
      
      if (workerIterations > 0) {
        workers.push(
          this.runWorkerWithIterations(workerIterations, delay, requestFunction, validateResponse)
        );
      }
    }
    
    await Promise.all(workers);
  }

  private async runWorker<T>(
    endTime: number,
    delay: number,
    requestFunction: () => Promise<T>,
    validateResponse?: (response: T) => boolean
  ): Promise<void> {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    while (Date.now() < endTime) {
      const requestStart = performance.now();
      
      try {
        const response = await requestFunction();
        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;
        
        const success = validateResponse ? validateResponse(response) : true;
        this.monitor.recordResponse(responseTime, success);
      } catch (error) {
        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;
        
        this.monitor.recordResponse(responseTime, false, error.message);
      }
    }
  }

  private async runWorkerWithIterations<T>(
    iterations: number,
    delay: number,
    requestFunction: () => Promise<T>,
    validateResponse?: (response: T) => boolean
  ): Promise<void> {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    for (let i = 0; i < iterations; i++) {
      const requestStart = performance.now();
      
      try {
        const response = await requestFunction();
        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;
        
        const success = validateResponse ? validateResponse(response) : true;
        this.monitor.recordResponse(responseTime, success);
      } catch (error) {
        const requestEnd = performance.now();
        const responseTime = requestEnd - requestStart;
        
        this.monitor.recordResponse(responseTime, false, error.message);
      }
    }
  }
}