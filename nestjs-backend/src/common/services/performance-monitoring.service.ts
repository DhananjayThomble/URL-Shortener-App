import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CachingService } from './caching.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as process from 'process';

export interface PerformanceMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
  };
  memory: {
    used: number;
    free: number;
    total: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  database: {
    activeConnections: number;
    idleConnections: number;
    totalConnections: number;
    slowQueries: number;
    avgQueryTime: number;
  };
  cache: {
    hitRate: number;
    memoryUsage: number;
    keyCount: number;
  };
  http: {
    requestsPerSecond: number;
    avgResponseTime: number;
    errorRate: number;
    activeConnections: number;
  };
  gc: {
    collections: number;
    duration: number;
    reclaimedMemory: number;
  };
}

export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration: number; // seconds
  enabled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

@Injectable()
export class PerformanceMonitoringService implements OnModuleInit {
  private readonly logger = new Logger(PerformanceMonitoringService.name);
  private readonly metricsHistory: PerformanceMetrics[] = [];
  private readonly maxHistorySize: number;
  private readonly alertRules: Map<string, AlertRule> = new Map();
  private readonly activeAlerts: Map<string, Alert> = new Map();
  private readonly httpMetrics = {
    requestCount: 0,
    totalResponseTime: 0,
    errorCount: 0,
    activeConnections: 0,
  };
  private readonly slowQueryThreshold: number;
  private readonly slowQueries: Array<{ query: string; duration: number; timestamp: Date }> = [];
  private gcStats = {
    collections: 0,
    duration: 0,
    reclaimedMemory: 0,
  };

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cachingService: CachingService,
    private readonly configService: ConfigService,
  ) {
    this.maxHistorySize = parseInt(
      this.configService.get('PERFORMANCE_HISTORY_SIZE', '1000'),
      10,
    );
    this.slowQueryThreshold = parseInt(
      this.configService.get('SLOW_QUERY_THRESHOLD_MS', '1000'),
      10,
    );
    this.setupGCMonitoring();
    this.setupDefaultAlertRules();
  }

  async onModuleInit() {
    this.logger.log('Performance monitoring service initialized');
    await this.startMonitoring();
  }

  /**
   * Start performance monitoring
   */
  async startMonitoring(): Promise<void> {
    this.logger.log('Starting performance monitoring...');
    
    // Initial metrics collection
    await this.collectMetrics();
    
    this.logger.log('Performance monitoring started');
  }

  /**
   * Collect performance metrics
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async collectMetrics(): Promise<PerformanceMetrics> {
    try {
      const metrics: PerformanceMetrics = {
        timestamp: new Date(),
        cpu: await this.getCPUMetrics(),
        memory: this.getMemoryMetrics(),
        database: await this.getDatabaseMetrics(),
        cache: await this.getCacheMetrics(),
        http: this.getHTTPMetrics(),
        gc: this.getGCMetrics(),
      };

      // Store metrics
      this.storeMetrics(metrics);
      
      // Check alert rules
      await this.checkAlertRules(metrics);
      
      // Log critical metrics
      this.logCriticalMetrics(metrics);

      return metrics;
    } catch (error) {
      this.logger.error('Failed to collect performance metrics:', error);
      throw error;
    }
  }

  /**
   * Get current performance metrics
   */
  async getCurrentMetrics(): Promise<PerformanceMetrics> {
    return this.collectMetrics();
  }

  /**
   * Get metrics history
   */
  getMetricsHistory(limit?: number): PerformanceMetrics[] {
    const history = [...this.metricsHistory];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get metrics for a specific time range
   */
  getMetricsInRange(startTime: Date, endTime: Date): PerformanceMetrics[] {
    return this.metricsHistory.filter(
      metrics => metrics.timestamp >= startTime && metrics.timestamp <= endTime,
    );
  }

  /**
   * Record HTTP request metrics
   */
  recordHTTPRequest(responseTime: number, statusCode: number): void {
    this.httpMetrics.requestCount++;
    this.httpMetrics.totalResponseTime += responseTime;
    
    if (statusCode >= 400) {
      this.httpMetrics.errorCount++;
    }
  }

  /**
   * Record slow query
   */
  recordSlowQuery(query: string, duration: number): void {
    this.slowQueries.push({
      query,
      duration,
      timestamp: new Date(),
    });

    // Keep only recent slow queries
    if (this.slowQueries.length > 100) {
      this.slowQueries.shift();
    }

    this.logger.warn(`Slow query detected (${duration}ms): ${query.substring(0, 100)}...`);
  }

  /**
   * Get slow queries
   */
  getSlowQueries(limit: number = 10): Array<{ query: string; duration: number; timestamp: Date }> {
    return this.slowQueries
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.log(`Added alert rule: ${rule.name}`);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    this.logger.log(`Removed alert rule: ${ruleId}`);
  }

  /**
   * Get all alert rules
   */
  getAlertRules(): AlertRule[] {
    return Array.from(this.alertRules.values());
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
  }

  /**
   * Get alert history
   */
  getAlertHistory(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Resolve alert
   */
  resolveAlert(alertId: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedAt = new Date();
      this.logger.log(`Resolved alert: ${alert.ruleName}`);
    }
  }

  /**
   * Get system health score
   */
  getHealthScore(): number {
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    if (!latestMetrics) return 100;

    let score = 100;

    // CPU health (weight: 25%)
    if (latestMetrics.cpu.usage > 80) score -= 25;
    else if (latestMetrics.cpu.usage > 60) score -= 15;
    else if (latestMetrics.cpu.usage > 40) score -= 5;

    // Memory health (weight: 25%)
    const memoryUsage = (latestMetrics.memory.used / latestMetrics.memory.total) * 100;
    if (memoryUsage > 90) score -= 25;
    else if (memoryUsage > 75) score -= 15;
    else if (memoryUsage > 60) score -= 5;

    // Database health (weight: 25%)
    if (latestMetrics.database.avgQueryTime > 1000) score -= 25;
    else if (latestMetrics.database.avgQueryTime > 500) score -= 15;
    else if (latestMetrics.database.avgQueryTime > 200) score -= 5;

    // HTTP health (weight: 25%)
    if (latestMetrics.http.errorRate > 10) score -= 25;
    else if (latestMetrics.http.errorRate > 5) score -= 15;
    else if (latestMetrics.http.errorRate > 2) score -= 5;

    return Math.max(0, score);
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    healthScore: number;
    activeAlerts: number;
    slowQueries: number;
    avgResponseTime: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
  } {
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];
    
    return {
      healthScore: this.getHealthScore(),
      activeAlerts: this.getActiveAlerts().length,
      slowQueries: this.slowQueries.length,
      avgResponseTime: latestMetrics?.http.avgResponseTime || 0,
      errorRate: latestMetrics?.http.errorRate || 0,
      memoryUsage: latestMetrics ? (latestMetrics.memory.used / latestMetrics.memory.total) * 100 : 0,
      cpuUsage: latestMetrics?.cpu.usage || 0,
    };
  }

  /**
   * Get CPU metrics
   */
  private async getCPUMetrics(): Promise<{ usage: number; loadAverage: number[] }> {
    const cpus = os.cpus();
    const loadAverage = os.loadavg();
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);

    return {
      usage,
      loadAverage,
    };
  }

  /**
   * Get memory metrics
   */
  private getMemoryMetrics(): PerformanceMetrics['memory'] {
    const memUsage = process.memoryUsage();
    
    return {
      used: os.totalmem() - os.freemem(),
      free: os.freemem(),
      total: os.totalmem(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    };
  }

  /**
   * Get database metrics
   */
  private async getDatabaseMetrics(): Promise<PerformanceMetrics['database']> {
    try {
      // Get connection pool stats
      const driver = this.dataSource.driver;
      const pool = (driver as any).master || (driver as any).pool;
      
      const activeConnections = pool?.totalCount || 0;
      const idleConnections = pool?.idleCount || 0;
      const totalConnections = activeConnections + idleConnections;

      // Calculate average query time from slow queries
      const recentSlowQueries = this.slowQueries.filter(
        q => Date.now() - q.timestamp.getTime() < 300000, // Last 5 minutes
      );
      
      const avgQueryTime = recentSlowQueries.length > 0
        ? recentSlowQueries.reduce((sum, q) => sum + q.duration, 0) / recentSlowQueries.length
        : 0;

      return {
        activeConnections,
        idleConnections,
        totalConnections,
        slowQueries: recentSlowQueries.length,
        avgQueryTime,
      };
    } catch (error) {
      this.logger.warn('Failed to get database metrics:', error);
      return {
        activeConnections: 0,
        idleConnections: 0,
        totalConnections: 0,
        slowQueries: 0,
        avgQueryTime: 0,
      };
    }
  }

  /**
   * Get cache metrics
   */
  private async getCacheMetrics(): Promise<PerformanceMetrics['cache']> {
    try {
      const cacheStats = this.cachingService.getStats();
      const cacheInfo = await this.cachingService.getCacheInfo();
      
      return {
        hitRate: cacheStats.hitRate,
        memoryUsage: cacheInfo.memory.used_memory || 0,
        keyCount: cacheInfo.keyspace.keys || 0,
      };
    } catch (error) {
      this.logger.warn('Failed to get cache metrics:', error);
      return {
        hitRate: 0,
        memoryUsage: 0,
        keyCount: 0,
      };
    }
  }

  /**
   * Get HTTP metrics
   */
  private getHTTPMetrics(): PerformanceMetrics['http'] {
    const avgResponseTime = this.httpMetrics.requestCount > 0
      ? this.httpMetrics.totalResponseTime / this.httpMetrics.requestCount
      : 0;
    
    const errorRate = this.httpMetrics.requestCount > 0
      ? (this.httpMetrics.errorCount / this.httpMetrics.requestCount) * 100
      : 0;

    // Reset counters for next interval
    const metrics = {
      requestsPerSecond: this.httpMetrics.requestCount / 30, // 30-second intervals
      avgResponseTime,
      errorRate,
      activeConnections: this.httpMetrics.activeConnections,
    };

    this.httpMetrics.requestCount = 0;
    this.httpMetrics.totalResponseTime = 0;
    this.httpMetrics.errorCount = 0;

    return metrics;
  }

  /**
   * Get garbage collection metrics
   */
  private getGCMetrics(): PerformanceMetrics['gc'] {
    const metrics = { ...this.gcStats };
    
    // Reset GC stats for next interval
    this.gcStats.collections = 0;
    this.gcStats.duration = 0;
    this.gcStats.reclaimedMemory = 0;

    return metrics;
  }

  /**
   * Store metrics in history
   */
  private storeMetrics(metrics: PerformanceMetrics): void {
    this.metricsHistory.push(metrics);
    
    // Keep history size under limit
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }
  }

  /**
   * Check alert rules against current metrics
   */
  private async checkAlertRules(metrics: PerformanceMetrics): Promise<void> {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      const value = this.getMetricValue(metrics, rule.metric);
      const shouldAlert = this.evaluateAlertCondition(value, rule.operator, rule.threshold);

      if (shouldAlert) {
        await this.triggerAlert(rule, value);
      } else {
        // Check if we should resolve an existing alert
        const existingAlert = Array.from(this.activeAlerts.values())
          .find(alert => alert.ruleId === rule.id && !alert.resolved);
        
        if (existingAlert) {
          this.resolveAlert(existingAlert.id);
        }
      }
    }
  }

  /**
   * Get metric value by path
   */
  private getMetricValue(metrics: PerformanceMetrics, metricPath: string): number {
    const parts = metricPath.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Evaluate alert condition
   */
  private evaluateAlertCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * Trigger alert
   */
  private async triggerAlert(rule: AlertRule, value: number): Promise<void> {
    const alertId = `${rule.id}-${Date.now()}`;
    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      message: `${rule.description} (${value} ${rule.operator} ${rule.threshold})`,
      value,
      threshold: rule.threshold,
      timestamp: new Date(),
      resolved: false,
    };

    this.activeAlerts.set(alertId, alert);
    
    this.logger.warn(`ALERT [${rule.severity.toUpperCase()}]: ${alert.message}`);
    
    // Store alert in cache for external monitoring systems
    await this.cachingService.set(`alert:${alertId}`, alert, { ttl: 86400 });
  }

  /**
   * Log critical metrics
   */
  private logCriticalMetrics(metrics: PerformanceMetrics): void {
    const memoryUsage = (metrics.memory.used / metrics.memory.total) * 100;
    
    if (metrics.cpu.usage > 80 || memoryUsage > 90 || metrics.http.errorRate > 10) {
      this.logger.warn('Critical performance metrics detected:', {
        cpu: `${metrics.cpu.usage.toFixed(1)}%`,
        memory: `${memoryUsage.toFixed(1)}%`,
        errorRate: `${metrics.http.errorRate.toFixed(1)}%`,
        avgResponseTime: `${metrics.http.avgResponseTime.toFixed(0)}ms`,
      });
    }
  }

  /**
   * Setup garbage collection monitoring
   */
  private setupGCMonitoring(): void {
    if (global.gc) {
      const originalGC = global.gc;
      global.gc = () => {
        const start = Date.now();
        const memBefore = process.memoryUsage().heapUsed;
        
        originalGC();
        
        const duration = Date.now() - start;
        const memAfter = process.memoryUsage().heapUsed;
        const reclaimedMemory = memBefore - memAfter;
        
        this.gcStats.collections++;
        this.gcStats.duration += duration;
        this.gcStats.reclaimedMemory += reclaimedMemory;
      };
    }
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high-cpu-usage',
        name: 'High CPU Usage',
        metric: 'cpu.usage',
        operator: 'gt',
        threshold: 80,
        duration: 300,
        enabled: true,
        severity: 'high',
        description: 'CPU usage is above 80%',
      },
      {
        id: 'high-memory-usage',
        name: 'High Memory Usage',
        metric: 'memory.used',
        operator: 'gt',
        threshold: 0.9, // 90% of total memory
        duration: 300,
        enabled: true,
        severity: 'high',
        description: 'Memory usage is above 90%',
      },
      {
        id: 'high-error-rate',
        name: 'High Error Rate',
        metric: 'http.errorRate',
        operator: 'gt',
        threshold: 5,
        duration: 180,
        enabled: true,
        severity: 'medium',
        description: 'HTTP error rate is above 5%',
      },
      {
        id: 'slow-response-time',
        name: 'Slow Response Time',
        metric: 'http.avgResponseTime',
        operator: 'gt',
        threshold: 1000,
        duration: 300,
        enabled: true,
        severity: 'medium',
        description: 'Average response time is above 1000ms',
      },
      {
        id: 'database-slow-queries',
        name: 'Database Slow Queries',
        metric: 'database.slowQueries',
        operator: 'gt',
        threshold: 10,
        duration: 300,
        enabled: true,
        severity: 'medium',
        description: 'Too many slow database queries',
      },
    ];

    defaultRules.forEach(rule => this.addAlertRule(rule));
  }
}