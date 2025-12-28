import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService as TerminusHealthService,
  TypeOrmHealthIndicator,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { HealthCheckService } from '../../../config/health-check.service';
import { LoggingService } from '../services/logging.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: TerminusHealthService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly mongo: MongooseHealthIndicator,
    private readonly healthCheckService: HealthCheckService,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get overall system health status' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'System is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        info: { type: 'object' },
        error: { type: 'object' },
        details: { type: 'object' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'System is unhealthy',
  })
  @HealthCheck()
  async check() {
    const result = await this.health.check([
      () => this.db.pingCheck('postgresql'),
      () => this.mongo.pingCheck('mongodb'),
      async () => {
        const redisHealth = await this.healthCheckService.checkIndividualService('redis');
        if (redisHealth.status === 'healthy') {
          return { redis: { status: 'up' } };
        }
        throw new Error(redisHealth.error || 'Redis is unhealthy');
      },
    ]);

    // Log health check result
    this.loggingService.logHealthCheck(result);

    return result;
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Get detailed health status for all services' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Detailed health information',
  })
  async getDetailedHealth() {
    const healthStatus = await this.healthCheckService.checkDatabaseHealth();
    
    // Log detailed health check
    this.loggingService.logDetailedHealthCheck(healthStatus);

    return {
      timestamp: new Date().toISOString(),
      status: healthStatus.overall,
      services: {
        postgresql: {
          status: healthStatus.postgresql.status,
          responseTime: healthStatus.postgresql.responseTime,
          details: healthStatus.postgresql.details,
          error: healthStatus.postgresql.error,
        },
        mongodb: {
          status: healthStatus.mongodb.status,
          responseTime: healthStatus.mongodb.responseTime,
          details: healthStatus.mongodb.details,
          error: healthStatus.mongodb.error,
        },
        redis: {
          status: healthStatus.redis.status,
          responseTime: healthStatus.redis.responseTime,
          details: healthStatus.redis.details,
          error: healthStatus.redis.error,
        },
      },
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Kubernetes readiness probe endpoint' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service is ready to accept traffic',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Service is not ready',
  })
  async readiness() {
    const healthSummary = await this.healthCheckService.getHealthSummary();
    
    if (healthSummary.healthy) {
      return {
        status: 'ready',
        timestamp: healthSummary.timestamp,
      };
    }

    throw new Error('Service not ready');
  }

  @Get('live')
  @ApiOperation({ summary: 'Kubernetes liveness probe endpoint' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service is alive',
  })
  async liveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }

  @Get('external')
  @ApiOperation({ summary: 'Check external service dependencies' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'External services health status',
  })
  async checkExternalServices() {
    // This would check external services like GeoIP, Email service, etc.
    // For now, we'll return a placeholder
    const externalServices = {
      geoip: await this.checkGeoIPService(),
      email: await this.checkEmailService(),
    };

    const allHealthy = Object.values(externalServices).every(
      service => service.status === 'healthy'
    );

    return {
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: externalServices,
    };
  }

  private async checkGeoIPService(): Promise<{ status: string; responseTime?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      // Simulate GeoIP service check
      // In a real implementation, this would make an actual request to the GeoIP service
      await new Promise(resolve => setTimeout(resolve, 10));
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkEmailService(): Promise<{ status: string; responseTime?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      // Simulate Email service check
      // In a real implementation, this would verify email service connectivity
      await new Promise(resolve => setTimeout(resolve, 5));
      
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}