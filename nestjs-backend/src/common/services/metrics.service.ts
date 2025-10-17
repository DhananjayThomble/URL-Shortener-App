import { Injectable, Logger } from '@nestjs/common';

export interface MetricValue {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
  help?: string;
  type?: 'counter' | 'gauge' | 'histogram' | 'summary';
}

export interface PrometheusMetrics {
  [metricName: string]: {
    type: string;
    help: string;
    values: Array<{
      value: number;
      labels?: Record<string, string>;
    }>;
  };
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private metrics = new Map<string, MetricValue>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();

  // Counter methods
  incrementCounter(name: string, labels?: Record<string, string>, value = 1): void {
    const key = this.generateKey(name, labels);
    const currentValue = this.counters.get(key) || 0;
    this.counters.set(key, currentValue + value);
    
    this.setMetric({
      name,
      value: currentValue + value,
      labels,
      type: 'counter',
      timestamp: Date.now(),
    });
  }

  // Gauge methods
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.generateKey(name, labels);
    this.gauges.set(key, value);
    
    this.setMetric({
      name,
      value,
      labels,
      type: 'gauge',
      timestamp: Date.now(),
    });
  }

  incrementGauge(name: string, labels?: Record<string, string>, value = 1): void {
    const key = this.generateKey(name, labels);
    const currentValue = this.gauges.get(key) || 0;
    this.setGauge(name, currentValue + value, labels);
  }

  decrementGauge(name: string, labels?: Record<string, string>, value = 1): void {
    const key = this.generateKey(name, labels);
    const currentValue = this.gauges.get(key) || 0;
    this.setGauge(name, currentValue - value, labels);
  }

  // Histogram methods
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.generateKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    this.histograms.set(key, values);
    
    this.setMetric({
      name,
      value,
      labels,
      type: 'histogram',
      timestamp: Date.now(),
    });
  }

  // Generic metric setter
  setMetric(metric: MetricValue): void {
    const key = this.generateKey(metric.name, metric.labels);
    this.metrics.set(key, {
      ...metric,
      timestamp: metric.timestamp || Date.now(),
    });
  }

  // Get specific metric
  getMetric(name: string, labels?: Record<string, string>): MetricValue | undefined {
    const key = this.generateKey(name, labels);
    return this.metrics.get(key);
  }

  // Get all metrics
  getAllMetrics(): MetricValue[] {
    return Array.from(this.metrics.values());
  }

  // Get metrics in Prometheus format
  getPrometheusMetrics(): string {
    const metricsMap = new Map<string, PrometheusMetrics[string]>();
    
    // Group metrics by name
    for (const metric of this.metrics.values()) {
      if (!metricsMap.has(metric.name)) {
        metricsMap.set(metric.name, {
          type: metric.type || 'gauge',
          help: metric.help || `Metric ${metric.name}`,
          values: [],
        });
      }
      
      metricsMap.get(metric.name)!.values.push({
        value: metric.value,
        labels: metric.labels,
      });
    }

    // Format as Prometheus exposition format
    let output = '';
    
    for (const [name, metricData] of metricsMap) {
      output += `# HELP ${name} ${metricData.help}\n`;
      output += `# TYPE ${name} ${metricData.type}\n`;
      
      for (const valueData of metricData.values) {
        const labelsStr = valueData.labels 
          ? '{' + Object.entries(valueData.labels)
              .map(([key, value]) => `${key}="${value}"`)
              .join(',') + '}'
          : '';
        
        output += `${name}${labelsStr} ${valueData.value}\n`;
      }
      
      output += '\n';
    }
    
    return output;
  }

  // Application-specific metrics
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    const labels = { method, route, status: statusCode.toString() };
    
    // Increment request counter
    this.incrementCounter('http_requests_total', labels);
    
    // Record request duration
    this.observeHistogram('http_request_duration_seconds', duration / 1000, labels);
    
    // Track error rate
    if (statusCode >= 400) {
      this.incrementCounter('http_requests_errors_total', labels);
    }
  }

  recordDatabaseQuery(database: string, operation: string, duration: number, success: boolean): void {
    const labels = { database, operation, success: success.toString() };
    
    this.incrementCounter('database_queries_total', labels);
    this.observeHistogram('database_query_duration_seconds', duration / 1000, labels);
    
    if (!success) {
      this.incrementCounter('database_queries_errors_total', labels);
    }
  }

  recordCacheOperation(operation: string, hit: boolean, duration: number): void {
    const labels = { operation, result: hit ? 'hit' : 'miss' };
    
    this.incrementCounter('cache_operations_total', labels);
    this.observeHistogram('cache_operation_duration_seconds', duration / 1000, labels);
  }

  recordUrlCreation(userId: string, success: boolean): void {
    const labels = { success: success.toString() };
    
    this.incrementCounter('urls_created_total', labels);
    
    if (success) {
      this.incrementGauge('active_urls_total');
    }
  }

  recordUrlAccess(shortCode: string, success: boolean): void {
    const labels = { success: success.toString() };
    
    this.incrementCounter('url_accesses_total', labels);
    
    if (success) {
      this.incrementCounter('url_clicks_total', { short_code: shortCode });
    }
  }

  recordUserRegistration(success: boolean): void {
    const labels = { success: success.toString() };
    
    this.incrementCounter('user_registrations_total', labels);
    
    if (success) {
      this.incrementGauge('active_users_total');
    }
  }

  recordAuthAttempt(type: 'login' | 'refresh', success: boolean): void {
    const labels = { type, success: success.toString() };
    
    this.incrementCounter('auth_attempts_total', labels);
    
    if (!success) {
      this.incrementCounter('auth_failures_total', labels);
    }
  }

  // System metrics
  updateSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Memory metrics
    this.setGauge('nodejs_memory_heap_used_bytes', memoryUsage.heapUsed);
    this.setGauge('nodejs_memory_heap_total_bytes', memoryUsage.heapTotal);
    this.setGauge('nodejs_memory_external_bytes', memoryUsage.external);
    this.setGauge('nodejs_memory_rss_bytes', memoryUsage.rss);
    
    // CPU metrics (in microseconds)
    this.setGauge('nodejs_cpu_user_seconds_total', cpuUsage.user / 1000000);
    this.setGauge('nodejs_cpu_system_seconds_total', cpuUsage.system / 1000000);
    
    // Process metrics
    this.setGauge('nodejs_process_uptime_seconds', process.uptime());
    this.setGauge('nodejs_process_pid', process.pid);
  }

  // Clear old metrics (useful for cleanup)
  clearMetrics(olderThanMs = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    
    for (const [key, metric] of this.metrics) {
      if (metric.timestamp && metric.timestamp < cutoff) {
        this.metrics.delete(key);
      }
    }
  }

  // Reset all metrics
  resetAllMetrics(): void {
    this.metrics.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }

  // Get metrics summary
  getMetricsSummary(): {
    totalMetrics: number;
    counters: number;
    gauges: number;
    histograms: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  } {
    const allMetrics = Array.from(this.metrics.values());
    const timestamps = allMetrics
      .map(m => m.timestamp)
      .filter(t => t !== undefined) as number[];
    
    return {
      totalMetrics: this.metrics.size,
      counters: this.counters.size,
      gauges: this.gauges.size,
      histograms: this.histograms.size,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
    };
  }

  private generateKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    
    return `${name}{${labelStr}}`;
  }
}