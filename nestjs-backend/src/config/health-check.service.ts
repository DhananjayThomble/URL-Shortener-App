import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { InjectConnection as InjectMongoConnection } from '@nestjs/mongoose';
import { Connection as TypeOrmConnection } from 'typeorm';
import { Connection as MongooseConnection } from 'mongoose';
import { RedisService } from './redis.service';

export interface DatabaseHealthStatus {
  postgresql: {
    status: 'healthy' | 'unhealthy';
    responseTime?: number;
    error?: string;
    details?: {
      isConnected: boolean;
      database: string;
      host: string;
      port: number;
    };
  };
  mongodb: {
    status: 'healthy' | 'unhealthy';
    responseTime?: number;
    error?: string;
    details?: {
      readyState: number;
      database: string;
      host: string;
      port: number;
    };
  };
  redis: {
    status: 'healthy' | 'unhealthy';
    responseTime?: number;
    error?: string;
    details?: {
      main: boolean;
      cache: boolean;
      session: boolean;
    };
  };
  overall: 'healthy' | 'degraded' | 'unhealthy';
}

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  constructor(
    @InjectConnection() private readonly postgresConnection: TypeOrmConnection,
    @InjectConnection() private readonly mongoConnection: MongooseConnection,
    // Temporarily comment out Redis dependency to get the app running
    // private readonly redisService: RedisService,
  ) {}

  async checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
    const [postgresql, mongodb, redis] = await Promise.all([
      this.checkPostgreSQLHealth(),
      this.checkMongoDBHealth(),
      this.checkRedisHealth(),
    ]);

    const overall = this.determineOverallHealth(postgresql, mongodb, redis);

    return {
      postgresql,
      mongodb,
      redis,
      overall,
    };
  }

  private async checkPostgreSQLHealth() {
    const startTime = Date.now();
    
    try {
      // Test connection with a simple query
      const result = await this.postgresConnection.query('SELECT 1 as health_check');
      const responseTime = Date.now() - startTime;

      if (result && result.length > 0 && result[0].health_check === 1) {
        return {
          status: 'healthy' as const,
          responseTime,
          details: {
            isConnected: this.postgresConnection.isConnected,
            database: (this.postgresConnection.options as any).database as string,
            host: (this.postgresConnection.options as any).host as string,
            port: (this.postgresConnection.options as any).port as number,
          },
        };
      } else {
        throw new Error('Unexpected query result');
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error('PostgreSQL health check failed:', error);
      
      return {
        status: 'unhealthy' as const,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          isConnected: this.postgresConnection.isConnected,
          database: (this.postgresConnection.options as any).database as string,
          host: (this.postgresConnection.options as any).host as string,
          port: (this.postgresConnection.options as any).port as number,
        },
      };
    }
  }

  private async checkMongoDBHealth() {
    const startTime = Date.now();
    
    try {
      // Test connection with admin command
      const adminDb = this.mongoConnection.db.admin();
      const result = await adminDb.ping();
      const responseTime = Date.now() - startTime;

      if (result && result.ok === 1) {
        return {
          status: 'healthy' as const,
          responseTime,
          details: {
            readyState: this.mongoConnection.readyState,
            database: this.mongoConnection.db.databaseName,
            host: this.mongoConnection.host,
            port: this.mongoConnection.port,
          },
        };
      } else {
        throw new Error('Ping command failed');
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error('MongoDB health check failed:', error);
      
      return {
        status: 'unhealthy' as const,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          readyState: this.mongoConnection.readyState,
          database: this.mongoConnection.db.databaseName,
          host: this.mongoConnection.host,
          port: this.mongoConnection.port,
        },
      };
    }
  }

  private async checkRedisHealth() {
    const startTime = Date.now();
    
    try {
      const healthStatus = await this.redisService.healthCheck();
      const responseTime = Date.now() - startTime;

      const allHealthy = healthStatus.main && healthStatus.cache && healthStatus.session;

      return {
        status: allHealthy ? 'healthy' as const : 'unhealthy' as const,
        responseTime,
        details: healthStatus,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error('Redis health check failed:', error);
      
      return {
        status: 'unhealthy' as const,
        responseTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          main: false,
          cache: false,
          session: false,
        },
      };
    }
  }

  private determineOverallHealth(
    postgresql: { status: string },
    mongodb: { status: string },
    redis: { status: string },
  ): 'healthy' | 'degraded' | 'unhealthy' {
    const healthyCount = [postgresql, mongodb, redis].filter(
      service => service.status === 'healthy'
    ).length;

    if (healthyCount === 3) {
      return 'healthy';
    } else if (healthyCount >= 2) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  async checkIndividualService(service: 'postgresql' | 'mongodb' | 'redis') {
    switch (service) {
      case 'postgresql':
        return this.checkPostgreSQLHealth();
      case 'mongodb':
        return this.checkMongoDBHealth();
      case 'redis':
        return this.checkRedisHealth();
      default:
        throw new Error(`Unknown service: ${service}`);
    }
  }

  // Utility method for monitoring and alerting
  async getHealthSummary(): Promise<{
    healthy: boolean;
    services: Record<string, boolean>;
    timestamp: string;
  }> {
    const health = await this.checkDatabaseHealth();
    
    return {
      healthy: health.overall === 'healthy',
      services: {
        postgresql: health.postgresql.status === 'healthy',
        mongodb: health.mongodb.status === 'healthy',
        redis: health.redis.status === 'healthy',
      },
      timestamp: new Date().toISOString(),
    };
  }
}