import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { PerformanceMonitoringService, AlertRule } from '../services/performance-monitoring.service';
import { HttpCache } from '../interceptors/http-cache.interceptor';

@ApiTags('performance')
@Controller('performance')
export class PerformanceController {
  constructor(
    private readonly performanceMonitoringService: PerformanceMonitoringService,
  ) {}

  @Get('metrics')
  @HttpCache({ type: 'analytics', maxAge: 30, private: true })
  @ApiOperation({ summary: 'Get current performance metrics' })
  @ApiResponse({ status: 200, description: 'Current performance metrics' })
  async getCurrentMetrics() {
    return this.performanceMonitoringService.getCurrentMetrics();
  }

  @Get('metrics/history')
  @HttpCache({ type: 'analytics', maxAge: 60, private: true })
  @ApiOperation({ summary: 'Get performance metrics history' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limit number of records' })
  @ApiResponse({ status: 200, description: 'Performance metrics history' })
  getMetricsHistory(@Query('limit') limit?: number) {
    return {
      metrics: this.performanceMonitoringService.getMetricsHistory(limit),
      total: this.performanceMonitoringService.getMetricsHistory().length,
    };
  }

  @Get('metrics/range')
  @HttpCache({ type: 'analytics', maxAge: 300, private: true })
  @ApiOperation({ summary: 'Get performance metrics for date range' })
  @ApiQuery({ name: 'start', required: true, type: String, description: 'Start date (ISO string)' })
  @ApiQuery({ name: 'end', required: true, type: String, description: 'End date (ISO string)' })
  @ApiResponse({ status: 200, description: 'Performance metrics for date range' })
  getMetricsInRange(
    @Query('start') start: string,
    @Query('end') end: string,
  ) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    return {
      metrics: this.performanceMonitoringService.getMetricsInRange(startDate, endDate),
      range: { start: startDate, end: endDate },
    };
  }

  @Get('health-score')
  @HttpCache({ type: 'analytics', maxAge: 30, private: true })
  @ApiOperation({ summary: 'Get system health score' })
  @ApiResponse({ status: 200, description: 'System health score (0-100)' })
  getHealthScore() {
    return {
      score: this.performanceMonitoringService.getHealthScore(),
      timestamp: new Date(),
    };
  }

  @Get('summary')
  @HttpCache({ type: 'analytics', maxAge: 60, private: true })
  @ApiOperation({ summary: 'Get performance summary' })
  @ApiResponse({ status: 200, description: 'Performance summary' })
  getPerformanceSummary() {
    return this.performanceMonitoringService.getPerformanceSummary();
  }

  @Get('slow-queries')
  @HttpCache({ type: 'analytics', maxAge: 300, private: true })
  @ApiOperation({ summary: 'Get slow database queries' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Limit number of queries' })
  @ApiResponse({ status: 200, description: 'Slow database queries' })
  getSlowQueries(@Query('limit') limit?: number) {
    return {
      queries: this.performanceMonitoringService.getSlowQueries(limit),
    };
  }

  @Get('alerts')
  @HttpCache({ type: 'analytics', maxAge: 30, private: true })
  @ApiOperation({ summary: 'Get active alerts' })
  @ApiResponse({ status: 200, description: 'Active performance alerts' })
  getActiveAlerts() {
    return {
      alerts: this.performanceMonitoringService.getActiveAlerts(),
    };
  }

  @Get('alerts/history')
  @HttpCache({ type: 'analytics', maxAge: 300, private: true })
  @ApiOperation({ summary: 'Get alert history' })
  @ApiResponse({ status: 200, description: 'Alert history' })
  getAlertHistory() {
    return {
      alerts: this.performanceMonitoringService.getAlertHistory(),
    };
  }

  @Get('alert-rules')
  @HttpCache({ type: 'analytics', maxAge: 600, private: true })
  @ApiOperation({ summary: 'Get alert rules' })
  @ApiResponse({ status: 200, description: 'Alert rules configuration' })
  getAlertRules() {
    return {
      rules: this.performanceMonitoringService.getAlertRules(),
    };
  }

  @Post('alert-rules')
  @ApiOperation({ summary: 'Add new alert rule' })
  @ApiResponse({ status: 201, description: 'Alert rule created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid alert rule configuration' })
  addAlertRule(@Body() rule: AlertRule) {
    this.performanceMonitoringService.addAlertRule(rule);
    return {
      message: 'Alert rule added successfully',
      rule,
    };
  }

  @Delete('alert-rules/:ruleId')
  @ApiOperation({ summary: 'Remove alert rule' })
  @ApiParam({ name: 'ruleId', description: 'Alert rule ID' })
  @ApiResponse({ status: 200, description: 'Alert rule removed successfully' })
  @ApiResponse({ status: 404, description: 'Alert rule not found' })
  @HttpCode(HttpStatus.OK)
  removeAlertRule(@Param('ruleId') ruleId: string) {
    this.performanceMonitoringService.removeAlertRule(ruleId);
    return {
      message: 'Alert rule removed successfully',
      ruleId,
    };
  }

  @Post('alerts/:alertId/resolve')
  @ApiOperation({ summary: 'Resolve alert' })
  @ApiParam({ name: 'alertId', description: 'Alert ID' })
  @ApiResponse({ status: 200, description: 'Alert resolved successfully' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  @HttpCode(HttpStatus.OK)
  resolveAlert(@Param('alertId') alertId: string) {
    this.performanceMonitoringService.resolveAlert(alertId);
    return {
      message: 'Alert resolved successfully',
      alertId,
      resolvedAt: new Date(),
    };
  }

  @Get('metrics/prometheus')
  @ApiOperation({ summary: 'Get metrics in Prometheus format' })
  @ApiResponse({ status: 200, description: 'Metrics in Prometheus format', type: String })
  async getPrometheusMetrics() {
    const metrics = await this.performanceMonitoringService.getCurrentMetrics();
    
    // Convert metrics to Prometheus format
    const prometheusMetrics = this.convertToPrometheusFormat(metrics);
    
    return prometheusMetrics;
  }

  @Get('dashboard')
  @HttpCache({ type: 'analytics', maxAge: 60, private: true })
  @ApiOperation({ summary: 'Get dashboard data' })
  @ApiResponse({ status: 200, description: 'Performance dashboard data' })
  async getDashboardData() {
    const [currentMetrics, summary, activeAlerts, slowQueries] = await Promise.all([
      this.performanceMonitoringService.getCurrentMetrics(),
      this.performanceMonitoringService.getPerformanceSummary(),
      this.performanceMonitoringService.getActiveAlerts(),
      this.performanceMonitoringService.getSlowQueries(5),
    ]);

    return {
      current: currentMetrics,
      summary,
      alerts: activeAlerts,
      slowQueries,
      timestamp: new Date(),
    };
  }

  /**
   * Convert metrics to Prometheus format
   */
  private convertToPrometheusFormat(metrics: any): string {
    const lines: string[] = [];
    const timestamp = Date.now();

    // CPU metrics
    lines.push(`# HELP cpu_usage_percent CPU usage percentage`);
    lines.push(`# TYPE cpu_usage_percent gauge`);
    lines.push(`cpu_usage_percent ${metrics.cpu.usage} ${timestamp}`);

    // Memory metrics
    lines.push(`# HELP memory_used_bytes Memory used in bytes`);
    lines.push(`# TYPE memory_used_bytes gauge`);
    lines.push(`memory_used_bytes ${metrics.memory.used} ${timestamp}`);

    lines.push(`# HELP memory_total_bytes Total memory in bytes`);
    lines.push(`# TYPE memory_total_bytes gauge`);
    lines.push(`memory_total_bytes ${metrics.memory.total} ${timestamp}`);

    // HTTP metrics
    lines.push(`# HELP http_requests_per_second HTTP requests per second`);
    lines.push(`# TYPE http_requests_per_second gauge`);
    lines.push(`http_requests_per_second ${metrics.http.requestsPerSecond} ${timestamp}`);

    lines.push(`# HELP http_response_time_ms Average HTTP response time in milliseconds`);
    lines.push(`# TYPE http_response_time_ms gauge`);
    lines.push(`http_response_time_ms ${metrics.http.avgResponseTime} ${timestamp}`);

    lines.push(`# HELP http_error_rate_percent HTTP error rate percentage`);
    lines.push(`# TYPE http_error_rate_percent gauge`);
    lines.push(`http_error_rate_percent ${metrics.http.errorRate} ${timestamp}`);

    // Database metrics
    lines.push(`# HELP database_connections_active Active database connections`);
    lines.push(`# TYPE database_connections_active gauge`);
    lines.push(`database_connections_active ${metrics.database.activeConnections} ${timestamp}`);

    lines.push(`# HELP database_query_time_ms Average database query time in milliseconds`);
    lines.push(`# TYPE database_query_time_ms gauge`);
    lines.push(`database_query_time_ms ${metrics.database.avgQueryTime} ${timestamp}`);

    // Cache metrics
    lines.push(`# HELP cache_hit_rate_percent Cache hit rate percentage`);
    lines.push(`# TYPE cache_hit_rate_percent gauge`);
    lines.push(`cache_hit_rate_percent ${metrics.cache.hitRate} ${timestamp}`);

    return lines.join('\n');
  }
}