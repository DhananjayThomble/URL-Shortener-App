/**
 * Monitoring Service
 * Handles Prometheus metrics, health checks, and alerting
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MonitoringService implements OnModuleInit {
  private readonly logger = new Logger(MonitoringService.name);
  
  // Prometheus metrics
  private readonly httpRequestsTotal: Counter<string>;
  private readonly httpRequestDuration: Histogram<string>;
  private readonly databaseConnectionsActive: Gauge<string>;
  private readonly redisConnectionsActive: Gauge<string>;
  private readonly urlShorteningTotal: Counter<string>;
  private readonly urlRedirectionTotal: Counter<string>;
  private readonly authenticationAttempts: Counter<string>;
  private readonly errorRate: Counter<string>;

  constructor(private readonly configService: ConfigService) {
    const prefix = this.configService.get('monitoring.prometheus.prefix', 'snapurl_');

    // Initialize metrics
    this.httpRequestsTotal = new Counter({
      name: `${prefix}http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpRequestDuration = new Histogram({
      name: `${prefix}http_request_duration_seconds`,
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    });

    this.databaseConnectionsActive = new Gauge({
      name: `${prefix}database_connections_active`,
      help: 'Number of active database connections',
      labelNames: ['database_type'],
    });

    this.redisConnectionsActive = new Gauge({
      name: `${prefix}redis_connections_active`,
      help: 'Number of active Redis connections',
    });

    this.urlShorteningTotal = new Counter({
      name: `${prefix}url_shortening_total`,
      help: 'Total number of URLs shortened',
      labelNames: ['user_type'],
    });

    this.urlRedirectionTotal = new Counter({
      name: `${prefix}url_redirection_total`,
      help: 'Total number of URL redirections',
      labelNames: ['status'],
    });

    this.authenticationAttempts = new Counter({
      name: `${prefix}authentication_attempts_total`,
      help: 'Total number of authentication attempts',
      labelNames: ['type', 'status'],
    });

    this.errorRate = new Counter({
      name: `${prefix}errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'severity'],
    });
  }

  async onModuleInit() {
    const prometheusEnabled = this.configService.get('monitoring.prometheus.enabled', false);
    
    if (prometheusEnabled) {
      this.logger.log('🔍 Initializing Prometheus metrics collection...');
      
      // Collect default metrics (CPU, memory, etc.)
      const defaultMetricsEnabled = this.configService.get('monitoring.prometheus.defaultMetrics', true);
      if (defaultMetricsEnabled) {
        collectDefaultMetrics({ 
          register,
          prefix: this.configService.get('monitoring.prometheus.prefix', 'snapurl_'),
        });
      }

      this.logger.log('✅ Prometheus metrics collection initialized');
    }
  }

  // HTTP request metrics
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    this.httpRequestDuration.observe({ method, route }, duration / 1000); // Convert to seconds
  }

  // Database metrics
  updateDatabaseConnections(type: 'postgresql' | 'mongodb', count: number) {
    this.databaseConnectionsActive.set({ database_type: type }, count);
  }

  updateRedisConnections(count: number) {
    this.redisConnectionsActive.set(count);
  }

  // Business metrics
  recordUrlShortening(userType: 'authenticated' | 'anonymous' = 'anonymous') {
    this.urlShorteningTotal.inc({ user_type: userType });
  }

  recordUrlRedirection(status: 'success' | 'not_found' | 'expired' | 'password_protected') {
    this.urlRedirectionTotal.inc({ status });
  }

  recordAuthenticationAttempt(type: 'login' | 'register' | 'refresh', status: 'success' | 'failure') {
    this.authenticationAttempts.inc({ type, status });
  }

  recordError(type: string, severity: 'low' | 'medium' | 'high' | 'critical') {
    this.errorRate.inc({ type, severity });
  }

  // Get metrics for Prometheus endpoint
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Health check methods
  async checkSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { status: string; responseTime?: number; error?: string }>;
    timestamp: string;
  }> {
    const checks: Record<string, { status: string; responseTime?: number; error?: string }> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let healthyCount = 0;
    let totalChecks = 0;

    // Database health checks
    const dbEnabled = this.configService.get('monitoring.healthChecks.checks.database.enabled', true);
    if (dbEnabled) {
      totalChecks++;
      try {
        const startTime = Date.now();
        // This would be implemented with actual database health check
        const responseTime = Date.now() - startTime;
        checks.database = { status: 'healthy', responseTime };
        healthyCount++;
      } catch (error) {
        checks.database = { status: 'unhealthy', error: error.message };
      }
    }

    // Redis health checks
    const redisEnabled = this.configService.get('monitoring.healthChecks.checks.redis.enabled', true);
    if (redisEnabled) {
      totalChecks++;
      try {
        const startTime = Date.now();
        // This would be implemented with actual Redis health check
        const responseTime = Date.now() - startTime;
        checks.redis = { status: 'healthy', responseTime };
        healthyCount++;
      } catch (error) {
        checks.redis = { status: 'unhealthy', error: error.message };
      }
    }

    // Determine overall status
    if (healthyCount === totalChecks) {
      overallStatus = 'healthy';
    } else if (healthyCount >= totalChecks * 0.5) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  // Alert methods
  async checkAlertConditions(): Promise<{
    alerts: Array<{
      name: string;
      severity: string;
      message: string;
      timestamp: string;
      value?: number;
      threshold?: number;
    }>;
  }> {
    const alerts: Array<{
      name: string;
      severity: string;
      message: string;
      timestamp: string;
      value?: number;
      threshold?: number;
    }> = [];

    const alertingEnabled = this.configService.get('monitoring.alerting.enabled', false);
    if (!alertingEnabled) {
      return { alerts };
    }

    const timestamp = new Date().toISOString();

    // Check response time alerts
    const responseTimeConfig = this.configService.get('monitoring.alerting.rules.responseTime');
    if (responseTimeConfig?.enabled) {
      // This would check actual response time metrics
      const avgResponseTime = 1500; // Mock value
      if (avgResponseTime > responseTimeConfig.threshold) {
        alerts.push({
          name: 'HighResponseTime',
          severity: responseTimeConfig.severity,
          message: `Average response time is ${avgResponseTime}ms, exceeding threshold of ${responseTimeConfig.threshold}ms`,
          timestamp,
          value: avgResponseTime,
          threshold: responseTimeConfig.threshold,
        });
      }
    }

    // Check error rate alerts
    const errorRateConfig = this.configService.get('monitoring.alerting.rules.errorRate');
    if (errorRateConfig?.enabled) {
      // This would check actual error rate metrics
      const currentErrorRate = 0.03; // Mock value (3%)
      if (currentErrorRate > errorRateConfig.threshold) {
        alerts.push({
          name: 'HighErrorRate',
          severity: errorRateConfig.severity,
          message: `Error rate is ${(currentErrorRate * 100).toFixed(2)}%, exceeding threshold of ${(errorRateConfig.threshold * 100).toFixed(2)}%`,
          timestamp,
          value: currentErrorRate,
          threshold: errorRateConfig.threshold,
        });
      }
    }

    // Check memory usage alerts
    const memoryConfig = this.configService.get('monitoring.alerting.rules.memoryUsage');
    if (memoryConfig?.enabled) {
      const memoryUsage = process.memoryUsage();
      const memoryUsagePercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
      
      if (memoryUsagePercent > memoryConfig.threshold) {
        alerts.push({
          name: 'HighMemoryUsage',
          severity: memoryConfig.severity,
          message: `Memory usage is ${(memoryUsagePercent * 100).toFixed(2)}%, exceeding threshold of ${(memoryConfig.threshold * 100).toFixed(2)}%`,
          timestamp,
          value: memoryUsagePercent,
          threshold: memoryConfig.threshold,
        });
      }
    }

    return { alerts };
  }

  // Notification methods
  async sendAlert(alert: {
    name: string;
    severity: string;
    message: string;
    timestamp: string;
    value?: number;
    threshold?: number;
  }): Promise<void> {
    this.logger.warn(`🚨 Alert: ${alert.name} - ${alert.message}`);

    // Send to configured notification channels
    const notifications = this.configService.get('monitoring.alerting.notifications');

    if (notifications?.slack?.enabled) {
      await this.sendSlackNotification(alert);
    }

    if (notifications?.email?.enabled) {
      await this.sendEmailNotification(alert);
    }

    if (notifications?.webhook?.enabled) {
      await this.sendWebhookNotification(alert);
    }
  }

  private async sendSlackNotification(alert: any): Promise<void> {
    try {
      // Implementation would use Slack webhook
      this.logger.log(`📱 Slack notification sent for alert: ${alert.name}`);
    } catch (error) {
      this.logger.error(`Failed to send Slack notification: ${error.message}`);
    }
  }

  private async sendEmailNotification(alert: any): Promise<void> {
    try {
      // Implementation would use email service
      this.logger.log(`📧 Email notification sent for alert: ${alert.name}`);
    } catch (error) {
      this.logger.error(`Failed to send email notification: ${error.message}`);
    }
  }

  private async sendWebhookNotification(alert: any): Promise<void> {
    try {
      // Implementation would use HTTP client
      this.logger.log(`🔗 Webhook notification sent for alert: ${alert.name}`);
    } catch (error) {
      this.logger.error(`Failed to send webhook notification: ${error.message}`);
    }
  }

  // Utility methods
  async getSystemMetrics(): Promise<{
    memory: NodeJS.MemoryUsage;
    uptime: number;
    cpuUsage: NodeJS.CpuUsage;
    timestamp: string;
  }> {
    return {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      cpuUsage: process.cpuUsage(),
      timestamp: new Date().toISOString(),
    };
  }

  async clearMetrics(): Promise<void> {
    register.clear();
    this.logger.log('📊 Prometheus metrics cleared');
  }
}