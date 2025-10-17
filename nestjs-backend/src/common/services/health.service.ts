import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Repository } from 'typeorm';
import { Model } from 'mongoose';

import { User } from '../../modules/users/entities/user.entity';
import { Url, UrlDocument } from '../../modules/urls/schemas/url.schema';
import { CacheService } from './cache.service';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: {
      postgres: {
        status: 'healthy' | 'unhealthy';
        responseTime?: number;
        error?: string;
      };
      mongodb: {
        status: 'healthy' | 'unhealthy';
        responseTime?: number;
        error?: string;
      };
    };
    cache: {
      redis: {
        status: 'healthy' | 'unhealthy';
        responseTime?: number;
        memory?: string;
        keys?: number;
        error?: string;
      };
    };
    external: {
      [serviceName: string]: {
        status: 'healthy' | 'unhealthy';
        responseTime?: number;
        error?: string;
      };
    };
  };
  metrics: {
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
    requests: {
      total: number;
      errors: number;
      avgResponseTime: number;
    };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private startTime = Date.now();
  private requestMetrics = {
    total: 0,
    errors: 0,
    totalResponseTime: 0,
  };

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectModel(Url.name)
    private urlModel: Model<UrlDocument>,
    private cacheService: CacheService,
  ) {}

  async getHealthStatus(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    // Check all services in parallel
    const [postgresHealth, mongoHealth, cacheHealth] = await Promise.allSettled([
      this.checkPostgresHealth(),
      this.checkMongoHealth(),
      this.checkCacheHealth(),
    ]);

    // Determine overall status
    const services = {
      database: {
        postgres: this.getResultValue(postgresHealth, { status: 'unhealthy', error: 'Connection failed' }),
        mongodb: this.getResultValue(mongoHealth, { status: 'unhealthy', error: 'Connection failed' }),
      },
      cache: {
        redis: this.getResultValue(cacheHealth, { status: 'unhealthy', error: 'Connection failed' }),
      },
      external: {},
    };

    const overallStatus = this.determineOverallStatus(services);
    const metrics = await this.getSystemMetrics();

    return {
      status: overallStatus,
      timestamp,
      uptime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services,
      metrics,
    };
  }

  async checkPostgresHealth(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.userRepository.query('SELECT 1');
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      this.logger.error('PostgreSQL health check failed:', error);
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async checkMongoHealth(): Promise<{ status: 'healthy' | 'unhealthy'; responseTime?: number; error?: string }> {
    const startTime = Date.now();
    
    try {
      await this.urlModel.findOne().limit(1).lean();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
      };
    } catch (error) {
      this.logger.error('MongoDB health check failed:', error);
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async checkCacheHealth(): Promise<{
    status: 'healthy' | 'unhealthy';
    responseTime?: number;
    memory?: string;
    keys?: number;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      const isHealthy = await this.cacheService.healthCheck();
      const responseTime = Date.now() - startTime;
      
      if (!isHealthy) {
        return {
          status: 'unhealthy',
          responseTime,
          error: 'Redis ping failed',
        };
      }

      const stats = await this.cacheService.getStats();
      
      return {
        status: 'healthy',
        responseTime,
        memory: stats.memory,
        keys: stats.keys,
      };
    } catch (error) {
      this.logger.error('Redis health check failed:', error);
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  async getSystemMetrics(): Promise<HealthStatus['metrics']> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        percentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
      },
      cpu: {
        usage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // Convert to milliseconds
      },
      requests: {
        total: this.requestMetrics.total,
        errors: this.requestMetrics.errors,
        avgResponseTime: this.requestMetrics.total > 0 
          ? Math.round(this.requestMetrics.totalResponseTime / this.requestMetrics.total)
          : 0,
      },
    };
  }

  // Simple health check for load balancers
  async getSimpleHealth(): Promise<{ status: string; timestamp: string }> {
    try {
      // Quick checks for critical services
      const [postgresOk, mongoOk, cacheOk] = await Promise.all([
        this.quickPostgresCheck(),
        this.quickMongoCheck(),
        this.quickCacheCheck(),
      ]);

      const status = postgresOk && mongoOk && cacheOk ? 'ok' : 'error';
      
      return {
        status,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Simple health check failed:', error);
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Readiness check - determines if the application is ready to serve traffic
  async getReadinessStatus(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
    const checks = {
      postgres: await this.quickPostgresCheck(),
      mongodb: await this.quickMongoCheck(),
      cache: await this.quickCacheCheck(),
    };

    const ready = Object.values(checks).every(check => check === true);

    return { ready, checks };
  }

  // Liveness check - determines if the application is alive
  async getLivenessStatus(): Promise<{ alive: boolean; uptime: number }> {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    return {
      alive: true, // If we can respond, we're alive
      uptime,
    };
  }

  // Record request metrics
  recordRequest(responseTime: number, isError = false): void {
    this.requestMetrics.total++;
    this.requestMetrics.totalResponseTime += responseTime;
    
    if (isError) {
      this.requestMetrics.errors++;
    }
  }

  // Reset metrics (useful for testing or periodic resets)
  resetMetrics(): void {
    this.requestMetrics = {
      total: 0,
      errors: 0,
      totalResponseTime: 0,
    };
  }

  private async quickPostgresCheck(): Promise<boolean> {
    try {
      await this.userRepository.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async quickMongoCheck(): Promise<boolean> {
    try {
      await this.urlModel.findOne().limit(1).lean();
      return true;
    } catch {
      return false;
    }
  }

  private async quickCacheCheck(): Promise<boolean> {
    try {
      return await this.cacheService.healthCheck();
    } catch {
      return false;
    }
  }

  private getResultValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
    return result.status === 'fulfilled' ? result.value : fallback;
  }

  private determineOverallStatus(services: HealthStatus['services']): 'healthy' | 'unhealthy' | 'degraded' {
    const criticalServices = [
      services.database.postgres.status,
      services.database.mongodb.status,
    ];

    const nonCriticalServices = [
      services.cache.redis.status,
    ];

    // If any critical service is down, overall status is unhealthy
    if (criticalServices.some(status => status === 'unhealthy')) {
      return 'unhealthy';
    }

    // If any non-critical service is down, overall status is degraded
    if (nonCriticalServices.some(status => status === 'unhealthy')) {
      return 'degraded';
    }

    return 'healthy';
  }
}