import { Controller, Get, Header, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MetricsService } from '../services/metrics.service';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  @ApiOperation({ summary: 'Get Prometheus metrics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Prometheus metrics in text format',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example: '# HELP http_requests_total Total number of HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",route="/health",status_code="200"} 1',
        },
      },
    },
  })
  async getPrometheusMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }

  @Get('json')
  @ApiOperation({ summary: 'Get metrics in JSON format' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Metrics in JSON format',
    schema: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', format: 'date-time' },
        metrics: { type: 'array' },
      },
    },
  })
  async getMetricsJson() {
    return this.metricsService.getMetricsJson();
  }

  @Get('business')
  @ApiOperation({ summary: 'Get business-specific metrics' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Business metrics aggregated for dashboard use',
    schema: {
      type: 'object',
      properties: {
        timestamp: { type: 'string', format: 'date-time' },
        metrics: {
          type: 'object',
          properties: {
            urls: {
              type: 'object',
              properties: {
                created: { type: 'number' },
                clicks: { type: 'number' },
              },
            },
            users: {
              type: 'object',
              properties: {
                active: { type: 'number' },
                authAttempts: { type: 'number' },
              },
            },
            system: {
              type: 'object',
              properties: {
                httpRequests: { type: 'number' },
                errors: { type: 'number' },
              },
            },
          },
        },
      },
    },
  })
  async getBusinessMetrics() {
    return this.metricsService.getBusinessMetrics();
  }

  @Get('health')
  @ApiOperation({ summary: 'Check metrics service health' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Metrics service health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        metricsCount: { type: 'number', example: 25 },
      },
    },
  })
  async getMetricsHealth() {
    return this.metricsService.healthCheck();
  }
}