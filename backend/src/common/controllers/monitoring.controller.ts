import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { HealthService } from '../services/health.service';
import { MetricsService } from '../services/metrics.service';

@ApiTags('Monitoring')
@Controller()
export class MonitoringController {
  constructor(
    private healthService: HealthService,
    private metricsService: MetricsService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Get comprehensive health status' })
  @ApiResponse({ status: 200, description: 'Health status retrieved successfully' })
  async getHealth() {
    return this.healthService.getHealthStatus();
  }

  @Get('health/simple')
  @ApiOperation({ summary: 'Get simple health status for load balancers' })
  @ApiResponse({ status: 200, description: 'Simple health status' })
  async getSimpleHealth() {
    return this.healthService.getSimpleHealth();
  }

  @Get('health/ready')
  @ApiOperation({ summary: 'Get readiness status' })
  @ApiResponse({ status: 200, description: 'Readiness status' })
  async getReadiness() {
    return this.healthService.getReadinessStatus();
  }

  @Get('health/live')
  @ApiOperation({ summary: 'Get liveness status' })
  @ApiResponse({ status: 200, description: 'Liveness status' })
  async getLiveness() {
    return this.healthService.getLivenessStatus();
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Get Prometheus-compatible metrics' })
  @ApiResponse({ 
    status: 200, 
    description: 'Metrics in Prometheus exposition format',
    content: {
      'text/plain': {
        example: `# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/urls",status="200"} 42

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds{method="GET",route="/api/urls",status="200"} 0.123`
      }
    }
  })
  async getMetrics(): Promise<string> {
    // Update system metrics before returning
    this.metricsService.updateSystemMetrics();
    
    return this.metricsService.getPrometheusMetrics();
  }

  @Get('metrics/json')
  @ApiOperation({ summary: 'Get metrics in JSON format' })
  @ApiResponse({ status: 200, description: 'Metrics in JSON format' })
  async getMetricsJson() {
    this.metricsService.updateSystemMetrics();
    
    return {
      metrics: this.metricsService.getAllMetrics(),
      summary: this.metricsService.getMetricsSummary(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('info')
  @ApiOperation({ summary: 'Get application information' })
  @ApiResponse({ status: 200, description: 'Application information' })
  async getInfo() {
    return {
      name: 'NestJS URL Shortener',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      uptime: process.uptime(),
      pid: process.pid,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}