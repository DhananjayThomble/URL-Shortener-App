import { Injectable, Logger } from '@nestjs/common';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // HTTP Request Metrics
  private readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
  });

  private readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  });

  // Business Metrics
  private readonly urlsCreatedTotal = new Counter({
    name: 'urls_created_total',
    help: 'Total number of URLs created',
    labelNames: ['user_id', 'has_custom_alias'],
  });

  private readonly urlClicksTotal = new Counter({
    name: 'url_clicks_total',
    help: 'Total number of URL clicks',
    labelNames: ['url_id', 'device_type', 'country'],
  });

  private readonly activeUsersGauge = new Gauge({
    name: 'active_users_current',
    help: 'Current number of active users',
  });

  private readonly bioPageViewsTotal = new Counter({
    name: 'bio_page_views_total',
    help: 'Total number of bio page views',
    labelNames: ['username'],
  });

  // Database Metrics
  private readonly databaseConnectionsActive = new Gauge({
    name: 'database_connections_active',
    help: 'Number of active database connections',
    labelNames: ['database_type'],
  });

  private readonly databaseQueryDuration = new Histogram({
    name: 'database_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['database_type', 'operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  });

  // Cache Metrics
  private readonly cacheHitsTotal = new Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['cache_type', 'key_pattern'],
  });

  private readonly cacheMissesTotal = new Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['cache_type', 'key_pattern'],
  });

  // System Resource Metrics
  private readonly memoryUsageBytes = new Gauge({
    name: 'memory_usage_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type'],
  });

  private readonly cpuUsagePercent = new Gauge({
    name: 'cpu_usage_percent',
    help: 'CPU usage percentage',
  });

  // Error Metrics
  private readonly errorsTotal = new Counter({
    name: 'errors_total',
    help: 'Total number of errors',
    labelNames: ['error_type', 'module', 'severity'],
  });

  // Authentication Metrics
  private readonly authAttemptsTotal = new Counter({
    name: 'auth_attempts_total',
    help: 'Total number of authentication attempts',
    labelNames: ['type', 'success'],
  });

  private readonly rateLimitHitsTotal = new Counter({
    name: 'rate_limit_hits_total',
    help: 'Total number of rate limit hits',
    labelNames: ['endpoint', 'user_id'],
  });

  constructor() {
    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register });
    
    // Start collecting system metrics
    this.startSystemMetricsCollection();
    
    this.logger.log('Metrics service initialized with Prometheus integration');
  }

  // HTTP Request Metrics
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe(
      { method, route, status_code: statusCode.toString() },
      duration / 1000 // Convert to seconds
    );
  }

  // Business Metrics
  recordUrlCreation(userId: string, hasCustomAlias: boolean) {
    this.urlsCreatedTotal.inc({
      user_id: userId,
      has_custom_alias: hasCustomAlias.toString(),
    });
  }

  recordUrlClick(urlId: string, deviceType: string, country: string) {
    this.urlClicksTotal.inc({
      url_id: urlId,
      device_type: deviceType,
      country: country || 'unknown',
    });
  }

  updateActiveUsers(count: number) {
    this.activeUsersGauge.set(count);
  }

  recordBioPageView(username: string) {
    this.bioPageViewsTotal.inc({ username });
  }

  // Database Metrics
  updateDatabaseConnections(databaseType: string, count: number) {
    this.databaseConnectionsActive.set({ database_type: databaseType }, count);
  }

  recordDatabaseQuery(databaseType: string, operation: string, duration: number) {
    this.databaseQueryDuration.observe(
      { database_type: databaseType, operation },
      duration / 1000 // Convert to seconds
    );
  }

  // Cache Metrics
  recordCacheHit(cacheType: string, keyPattern: string) {
    this.cacheHitsTotal.inc({ cache_type: cacheType, key_pattern: keyPattern });
  }

  recordCacheMiss(cacheType: string, keyPattern: string) {
    this.cacheMissesTotal.inc({ cache_type: cacheType, key_pattern: keyPattern });
  }

  // Error Metrics
  recordError(errorType: string, module: string, severity: 'low' | 'medium' | 'high' | 'critical') {
    this.errorsTotal.inc({ error_type: errorType, module, severity });
  }

  // Authentication Metrics
  recordAuthAttempt(type: 'login' | 'register' | 'refresh', success: boolean) {
    this.authAttemptsTotal.inc({ type, success: success.toString() });
  }

  recordRateLimitHit(endpoint: string, userId?: string) {
    this.rateLimitHitsTotal.inc({
      endpoint,
      user_id: userId || 'anonymous',
    });
  }

  // Get metrics for Prometheus scraping
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Get metrics in JSON format for internal use
  async getMetricsJson(): Promise<any> {
    const metrics = await register.getMetricsAsJSON();
    return {
      timestamp: new Date().toISOString(),
      metrics,
    };
  }

  // Custom business metrics aggregation
  async getBusinessMetrics(): Promise<any> {
    const metrics = await register.getMetricsAsJSON();
    
    const businessMetrics = {
      urls: {
        created: this.getMetricValue(metrics, 'urls_created_total'),
        clicks: this.getMetricValue(metrics, 'url_clicks_total'),
      },
      users: {
        active: this.getMetricValue(metrics, 'active_users_current'),
        authAttempts: this.getMetricValue(metrics, 'auth_attempts_total'),
      },
      bioPages: {
        views: this.getMetricValue(metrics, 'bio_page_views_total'),
      },
      system: {
        httpRequests: this.getMetricValue(metrics, 'http_requests_total'),
        errors: this.getMetricValue(metrics, 'errors_total'),
        rateLimitHits: this.getMetricValue(metrics, 'rate_limit_hits_total'),
      },
      database: {
        connections: this.getMetricValue(metrics, 'database_connections_active'),
        queryDuration: this.getMetricValue(metrics, 'database_query_duration_seconds'),
      },
      cache: {
        hits: this.getMetricValue(metrics, 'cache_hits_total'),
        misses: this.getMetricValue(metrics, 'cache_misses_total'),
      },
    };

    return {
      timestamp: new Date().toISOString(),
      metrics: businessMetrics,
    };
  }

  private getMetricValue(metrics: any[], metricName: string): any {
    const metric = metrics.find(m => m.name === metricName);
    return metric ? metric.values : null;
  }

  private startSystemMetricsCollection() {
    // Update system metrics every 30 seconds
    setInterval(() => {
      this.updateSystemMetrics();
    }, 30000);

    // Initial collection
    this.updateSystemMetrics();
  }

  private updateSystemMetrics() {
    try {
      const memUsage = process.memoryUsage();
      
      this.memoryUsageBytes.set({ type: 'rss' }, memUsage.rss);
      this.memoryUsageBytes.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.memoryUsageBytes.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.memoryUsageBytes.set({ type: 'external' }, memUsage.external);

      // CPU usage would require additional libraries for accurate measurement
      // For now, we'll use a placeholder
      this.cpuUsagePercent.set(Math.random() * 100); // This should be replaced with actual CPU monitoring
    } catch (error) {
      this.logger.error('Failed to update system metrics:', error);
    }
  }

  // Reset all metrics (useful for testing)
  resetMetrics() {
    register.clear();
    this.logger.log('All metrics have been reset');
  }

  // Health check for metrics service
  async healthCheck(): Promise<{ status: string; metricsCount: number }> {
    try {
      const metrics = await register.getMetricsAsJSON();
      return {
        status: 'healthy',
        metricsCount: metrics.length,
      };
    } catch (error) {
      this.logger.error('Metrics health check failed:', error);
      return {
        status: 'unhealthy',
        metricsCount: 0,
      };
    }
  }
}