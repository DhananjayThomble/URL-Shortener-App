import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  Post,
  Body,
  Delete,
  Put,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { ApiAnalyticsService } from '../services/api-analytics.service';
import { AdvancedRateLimitingService } from '../services/advanced-rate-limiting.service';
import { EnhancedJwtAuthGuard } from '../../modules/auth/guards/enhanced-jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { RateLimit, RateLimitPresets } from '../guards/comprehensive-rate-limit.guard';
import { UserRole } from '../../modules/users/entities/user.entity';

@ApiTags('api-analytics')
@Controller('api-analytics')
@UseGuards(EnhancedJwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.DEVELOPER)
@RateLimit(RateLimitPresets.ANALYTICS)
export class ApiAnalyticsController {
  constructor(
    private readonly analyticsService: ApiAnalyticsService,
    private readonly rateLimitService: AdvancedRateLimitingService,
  ) {}

  @Get('usage-stats')
  @ApiOperation({
    summary: 'Get API usage statistics',
    description: 'Retrieve comprehensive API usage statistics for a specified time range',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    type: String,
    description: 'Start date in ISO format (YYYY-MM-DD)',
    example: '2024-01-01',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    type: String,
    description: 'End date in ISO format (YYYY-MM-DD)',
    example: '2024-01-31',
  })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    enum: ['hour', 'day'],
    description: 'Group results by hour or day',
    example: 'day',
  })
  @ApiResponse({
    status: 200,
    description: 'API usage statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalRequests: { type: 'number', example: 10000 },
        successfulRequests: { type: 'number', example: 9500 },
        errorRequests: { type: 'number', example: 500 },
        averageResponseTime: { type: 'number', example: 150.5 },
        requestsPerSecond: { type: 'number', example: 5.2 },
        topEndpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              endpoint: { type: 'string', example: '/api/v1/enhanced-links' },
              count: { type: 'number', example: 2500 },
              avgResponseTime: { type: 'number', example: 120.3 },
            },
          },
        },
        statusCodeDistribution: {
          type: 'object',
          example: { '200': 8000, '201': 1500, '400': 300, '500': 200 },
        },
        timeSeriesData: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', format: 'date-time' },
              requests: { type: 'number' },
              errors: { type: 'number' },
              avgResponseTime: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getUsageStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'hour' | 'day' = 'day',
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.analyticsService.getApiUsageStats(start, end, groupBy);
  }

  @Get('endpoint-analytics/:endpoint')
  @ApiOperation({
    summary: 'Get analytics for specific endpoint',
    description: 'Retrieve detailed analytics for a specific API endpoint',
  })
  @ApiParam({
    name: 'endpoint',
    description: 'URL-encoded endpoint path',
    example: '%2Fapi%2Fv1%2Fenhanced-links',
  })
  @ApiQuery({
    name: 'method',
    required: true,
    type: String,
    description: 'HTTP method',
    example: 'POST',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    type: String,
    description: 'Start date in ISO format',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    type: String,
    description: 'End date in ISO format',
  })
  @ApiResponse({
    status: 200,
    description: 'Endpoint analytics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string' },
        method: { type: 'string' },
        totalRequests: { type: 'number' },
        successRate: { type: 'number' },
        averageResponseTime: { type: 'number' },
        p95ResponseTime: { type: 'number' },
        p99ResponseTime: { type: 'number' },
        errorRate: { type: 'number' },
        rateLimitRate: { type: 'number' },
        topUsers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getEndpointAnalytics(
    @Param('endpoint') endpoint: string,
    @Query('method') method: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const decodedEndpoint = decodeURIComponent(endpoint);
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.analyticsService.getEndpointAnalytics(decodedEndpoint, method, start, end);
  }

  @Get('real-time-metrics')
  @ApiOperation({
    summary: 'Get real-time API metrics',
    description: 'Retrieve current real-time API performance metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Real-time metrics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        requestsPerMinute: { type: 'number', example: 45 },
        activeUsers: { type: 'number', example: 12 },
        errorRate: { type: 'number', example: 2.5 },
        averageResponseTime: { type: 'number', example: 125.3 },
        topEndpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              endpoint: { type: 'string' },
              rpm: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getRealTimeMetrics() {
    return this.analyticsService.getRealTimeMetrics();
  }

  @Get('rate-limits')
  @ApiOperation({
    summary: 'Get rate limit information',
    description: 'Retrieve current rate limit configurations and usage',
  })
  @ApiResponse({
    status: 200,
    description: 'Rate limit information retrieved successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          endpoint: { type: 'string' },
          method: { type: 'string' },
          windowMs: { type: 'number' },
          maxRequests: { type: 'number' },
          currentRequests: { type: 'number' },
          resetTime: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async getRateLimits() {
    return this.rateLimitService.getEndpointRateLimits();
  }

  @Get('rate-limit-analytics')
  @ApiOperation({
    summary: 'Get rate limiting analytics',
    description: 'Retrieve analytics about rate limiting events and patterns',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    type: String,
    description: 'Start date in ISO format',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    type: String,
    description: 'End date in ISO format',
  })
  @ApiQuery({
    name: 'groupBy',
    required: false,
    enum: ['hour', 'day'],
    description: 'Group results by hour or day',
    example: 'day',
  })
  @ApiResponse({
    status: 200,
    description: 'Rate limit analytics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        totalRequests: { type: 'number' },
        blockedRequests: { type: 'number' },
        topBlockedKeys: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              count: { type: 'number' },
            },
          },
        },
        timeSeriesData: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string', format: 'date-time' },
              requests: { type: 'number' },
              blocked: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getRateLimitAnalytics(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('groupBy') groupBy: 'hour' | 'day' = 'day',
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.rateLimitService.getRateLimitAnalytics({ start, end }, groupBy);
  }

  @Put('rate-limit-config/:endpoint/:method')
  @ApiOperation({
    summary: 'Update rate limit configuration',
    description: 'Update rate limiting configuration for a specific endpoint',
  })
  @ApiParam({
    name: 'endpoint',
    description: 'URL-encoded endpoint path',
  })
  @ApiParam({
    name: 'method',
    description: 'HTTP method',
  })
  @ApiResponse({
    status: 200,
    description: 'Rate limit configuration updated successfully',
  })
  async updateRateLimitConfig(
    @Param('endpoint') endpoint: string,
    @Param('method') method: string,
    @Body() config: {
      windowMs?: number;
      maxRequests?: number;
      message?: string;
    },
  ) {
    const decodedEndpoint = decodeURIComponent(endpoint);
    await this.rateLimitService.updateRateLimitConfig(decodedEndpoint, method, config);
    
    return {
      message: 'Rate limit configuration updated successfully',
      endpoint: decodedEndpoint,
      method,
      config,
    };
  }

  @Post('rate-limit-reset/:key')
  @ApiOperation({
    summary: 'Reset rate limit for key',
    description: 'Reset rate limiting counter for a specific key',
  })
  @ApiParam({
    name: 'key',
    description: 'Rate limit key to reset',
  })
  @ApiResponse({
    status: 200,
    description: 'Rate limit reset successfully',
  })
  async resetRateLimit(
    @Param('key') key: string,
    @Body() body: { windowMs: number },
  ) {
    await this.rateLimitService.resetRateLimit(key, body.windowMs);
    
    return {
      message: 'Rate limit reset successfully',
      key,
    };
  }

  @Post('cleanup-analytics')
  @ApiOperation({
    summary: 'Cleanup old analytics data',
    description: 'Remove analytics data older than specified retention period',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics cleanup completed successfully',
  })
  async cleanupAnalytics(
    @Body() body: { retentionDays?: number },
  ) {
    const retentionDays = body.retentionDays || 30;
    await this.analyticsService.cleanupOldData(retentionDays);
    
    return {
      message: 'Analytics cleanup completed successfully',
      retentionDays,
    };
  }

  @Get('dashboard-summary')
  @ApiOperation({
    summary: 'Get dashboard summary',
    description: 'Retrieve summary statistics for the API analytics dashboard',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        today: {
          type: 'object',
          properties: {
            totalRequests: { type: 'number' },
            errorRate: { type: 'number' },
            averageResponseTime: { type: 'number' },
            rateLimitedRequests: { type: 'number' },
          },
        },
        yesterday: {
          type: 'object',
          properties: {
            totalRequests: { type: 'number' },
            errorRate: { type: 'number' },
            averageResponseTime: { type: 'number' },
            rateLimitedRequests: { type: 'number' },
          },
        },
        trends: {
          type: 'object',
          properties: {
            requestsChange: { type: 'number' },
            errorRateChange: { type: 'number' },
            responseTimeChange: { type: 'number' },
          },
        },
        alerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['error_rate', 'response_time', 'rate_limit'] },
              message: { type: 'string' },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  })
  async getDashboardSummary() {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000);

    const [todayStats, yesterdayStats] = await Promise.all([
      this.analyticsService.getApiUsageStats(today, today, 'day'),
      this.analyticsService.getApiUsageStats(yesterday, yesterday, 'day'),
    ]);

    const requestsChange = yesterdayStats.totalRequests > 0 
      ? ((todayStats.totalRequests - yesterdayStats.totalRequests) / yesterdayStats.totalRequests) * 100
      : 0;

    const todayErrorRate = todayStats.totalRequests > 0 
      ? (todayStats.errorRequests / todayStats.totalRequests) * 100 
      : 0;
    const yesterdayErrorRate = yesterdayStats.totalRequests > 0 
      ? (yesterdayStats.errorRequests / yesterdayStats.totalRequests) * 100 
      : 0;
    const errorRateChange = yesterdayErrorRate > 0 
      ? ((todayErrorRate - yesterdayErrorRate) / yesterdayErrorRate) * 100 
      : 0;

    const responseTimeChange = yesterdayStats.averageResponseTime > 0 
      ? ((todayStats.averageResponseTime - yesterdayStats.averageResponseTime) / yesterdayStats.averageResponseTime) * 100 
      : 0;

    // Generate alerts based on thresholds
    const alerts = [];
    if (todayErrorRate > 5) {
      alerts.push({
        type: 'error_rate',
        message: `High error rate detected: ${todayErrorRate.toFixed(2)}%`,
        severity: todayErrorRate > 10 ? 'high' : 'medium',
        timestamp: new Date().toISOString(),
      });
    }

    if (todayStats.averageResponseTime > 1000) {
      alerts.push({
        type: 'response_time',
        message: `High average response time: ${todayStats.averageResponseTime.toFixed(0)}ms`,
        severity: todayStats.averageResponseTime > 2000 ? 'high' : 'medium',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      today: {
        totalRequests: todayStats.totalRequests,
        errorRate: todayErrorRate,
        averageResponseTime: todayStats.averageResponseTime,
        rateLimitedRequests: 0, // Would need to track this separately
      },
      yesterday: {
        totalRequests: yesterdayStats.totalRequests,
        errorRate: yesterdayErrorRate,
        averageResponseTime: yesterdayStats.averageResponseTime,
        rateLimitedRequests: 0,
      },
      trends: {
        requestsChange,
        errorRateChange,
        responseTimeChange,
      },
      alerts,
    };
  }
}