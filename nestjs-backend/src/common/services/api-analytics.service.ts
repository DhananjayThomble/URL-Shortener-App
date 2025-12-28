import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';

export interface ApiUsageEvent {
  timestamp: Date;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  userId?: string;
  userAgent?: string;
  ip?: string;
  apiVersion?: string;
  requestId?: string;
  errorCode?: string;
  rateLimited?: boolean;
}

export interface ApiUsageStats {
  totalRequests: number;
  successfulRequests: number;
  errorRequests: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  topEndpoints: Array<{ endpoint: string; count: number; avgResponseTime: number }>;
  statusCodeDistribution: Record<number, number>;
  errorDistribution: Record<string, number>;
  userDistribution: Array<{ userId: string; count: number }>;
  timeSeriesData: Array<{
    timestamp: Date;
    requests: number;
    errors: number;
    avgResponseTime: number;
  }>;
}

export interface EndpointAnalytics {
  endpoint: string;
  method: string;
  totalRequests: number;
  successRate: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  rateLimitRate: number;
  topUsers: Array<{ userId: string; count: number }>;
  recentErrors: Array<{
    timestamp: Date;
    statusCode: number;
    errorCode: string;
    userId?: string;
  }>;
}

// MongoDB schema for API usage events
export interface ApiUsageEventDocument extends ApiUsageEvent, Document {}

@Injectable()
export class ApiAnalyticsService {
  private readonly logger = new Logger(ApiAnalyticsService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    // @InjectModel('ApiUsageEvent') private readonly apiUsageModel: Model<ApiUsageEventDocument>,
  ) {}

  /**
   * Record API usage event
   */
  async recordApiUsage(event: ApiUsageEvent): Promise<void> {
    try {
      // Store in Redis for real-time analytics
      const eventKey = `api_usage:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      await this.redis.setex(eventKey, 86400, JSON.stringify(event)); // 24 hours TTL

      // Update real-time counters
      const dateKey = new Date().toISOString().split('T')[0];
      const hourKey = new Date().toISOString().substring(0, 13);
      const endpointKey = `${event.method}:${event.endpoint}`;

      const pipeline = this.redis.pipeline();

      // Daily stats
      pipeline.hincrby(`api_stats:daily:${dateKey}`, 'total_requests', 1);
      pipeline.hincrby(`api_stats:daily:${dateKey}`, `status_${event.statusCode}`, 1);
      pipeline.zincrby(`api_endpoints:daily:${dateKey}`, 1, endpointKey);
      
      if (event.userId) {
        pipeline.zincrby(`api_users:daily:${dateKey}`, 1, event.userId);
      }

      if (event.errorCode) {
        pipeline.zincrby(`api_errors:daily:${dateKey}`, 1, event.errorCode);
      }

      if (event.rateLimited) {
        pipeline.hincrby(`api_stats:daily:${dateKey}`, 'rate_limited', 1);
      }

      // Hourly stats for more granular analytics
      pipeline.hincrby(`api_stats:hourly:${hourKey}`, 'total_requests', 1);
      pipeline.hincrby(`api_stats:hourly:${hourKey}`, 'total_response_time', event.responseTime);

      // Response time tracking (for percentiles)
      pipeline.zadd(`api_response_times:${endpointKey}:${dateKey}`, event.responseTime, `${Date.now()}`);
      pipeline.expire(`api_response_times:${endpointKey}:${dateKey}`, 86400 * 7); // 7 days

      await pipeline.exec();

      // Store in MongoDB for long-term analytics (async)
      // this.storeInMongoDB(event).catch(error => {
      //   this.logger.error('Failed to store API usage in MongoDB', error);
      // });

    } catch (error) {
      this.logger.error('Failed to record API usage', error);
    }
  }

  /**
   * Get API usage statistics for a time range
   */
  async getApiUsageStats(
    startDate: Date,
    endDate: Date,
    groupBy: 'hour' | 'day' = 'day',
  ): Promise<ApiUsageStats> {
    try {
      const stats: ApiUsageStats = {
        totalRequests: 0,
        successfulRequests: 0,
        errorRequests: 0,
        averageResponseTime: 0,
        requestsPerSecond: 0,
        topEndpoints: [],
        statusCodeDistribution: {},
        errorDistribution: {},
        userDistribution: [],
        timeSeriesData: [],
      };

      const dateKeys = this.generateDateKeys(startDate, endDate, groupBy);

      for (const dateKey of dateKeys) {
        const keyPrefix = groupBy === 'hour' ? 'hourly' : 'daily';
        const dailyStats = await this.redis.hgetall(`api_stats:${keyPrefix}:${dateKey}`);
        
        if (Object.keys(dailyStats).length > 0) {
          const totalRequests = parseInt(dailyStats.total_requests || '0', 10);
          const totalResponseTime = parseInt(dailyStats.total_response_time || '0', 10);
          
          stats.totalRequests += totalRequests;
          
          // Aggregate status codes
          Object.keys(dailyStats).forEach(key => {
            if (key.startsWith('status_')) {
              const statusCode = parseInt(key.replace('status_', ''), 10);
              const count = parseInt(dailyStats[key], 10);
              stats.statusCodeDistribution[statusCode] = (stats.statusCodeDistribution[statusCode] || 0) + count;
              
              if (statusCode >= 200 && statusCode < 400) {
                stats.successfulRequests += count;
              } else {
                stats.errorRequests += count;
              }
            }
          });

          // Time series data
          stats.timeSeriesData.push({
            timestamp: this.parseKeyToDate(dateKey, groupBy),
            requests: totalRequests,
            errors: parseInt(dailyStats.errors || '0', 10),
            avgResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
          });
        }
      }

      // Calculate derived metrics
      const totalTime = (endDate.getTime() - startDate.getTime()) / 1000;
      stats.requestsPerSecond = totalTime > 0 ? stats.totalRequests / totalTime : 0;
      
      const totalResponseTime = stats.timeSeriesData.reduce((sum, data) => 
        sum + (data.avgResponseTime * data.requests), 0);
      stats.averageResponseTime = stats.totalRequests > 0 ? totalResponseTime / stats.totalRequests : 0;

      // Get top endpoints
      stats.topEndpoints = await this.getTopEndpoints(startDate, endDate);
      
      // Get error distribution
      stats.errorDistribution = await this.getErrorDistribution(startDate, endDate);
      
      // Get user distribution
      stats.userDistribution = await this.getUserDistribution(startDate, endDate);

      return stats;
    } catch (error) {
      this.logger.error('Failed to get API usage stats', error);
      throw error;
    }
  }

  /**
   * Get analytics for a specific endpoint
   */
  async getEndpointAnalytics(
    endpoint: string,
    method: string,
    startDate: Date,
    endDate: Date,
  ): Promise<EndpointAnalytics> {
    try {
      const endpointKey = `${method}:${endpoint}`;
      const dateKeys = this.generateDateKeys(startDate, endDate, 'day');

      let totalRequests = 0;
      let successfulRequests = 0;
      let totalResponseTime = 0;
      const responseTimes: number[] = [];

      // Aggregate data across date range
      for (const dateKey of dateKeys) {
        const count = await this.redis.zscore(`api_endpoints:daily:${dateKey}`, endpointKey);
        if (count) {
          totalRequests += parseInt(count.toString(), 10);
        }

        // Get response times for percentile calculation
        const times = await this.redis.zrange(`api_response_times:${endpointKey}:${dateKey}`, 0, -1, 'WITHSCORES');
        for (let i = 1; i < times.length; i += 2) {
          responseTimes.push(parseFloat(times[i]));
        }
      }

      // Calculate percentiles
      responseTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(responseTimes.length * 0.95);
      const p99Index = Math.floor(responseTimes.length * 0.99);

      const analytics: EndpointAnalytics = {
        endpoint,
        method,
        totalRequests,
        successRate: totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0,
        averageResponseTime: responseTimes.length > 0 ? 
          responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0,
        p95ResponseTime: responseTimes[p95Index] || 0,
        p99ResponseTime: responseTimes[p99Index] || 0,
        errorRate: totalRequests > 0 ? ((totalRequests - successfulRequests) / totalRequests) * 100 : 0,
        rateLimitRate: 0, // Would need to calculate from rate limit events
        topUsers: await this.getTopUsersForEndpoint(endpointKey, startDate, endDate),
        recentErrors: await this.getRecentErrorsForEndpoint(endpointKey, startDate, endDate),
      };

      return analytics;
    } catch (error) {
      this.logger.error('Failed to get endpoint analytics', error);
      throw error;
    }
  }

  /**
   * Get real-time API metrics
   */
  async getRealTimeMetrics(): Promise<{
    requestsPerMinute: number;
    activeUsers: number;
    errorRate: number;
    averageResponseTime: number;
    topEndpoints: Array<{ endpoint: string; rpm: number }>;
  }> {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
      
      // Get metrics from the last minute
      const minuteKey = now.toISOString().substring(0, 16); // YYYY-MM-DDTHH:MM
      const stats = await this.redis.hgetall(`api_stats:minute:${minuteKey}`);

      return {
        requestsPerMinute: parseInt(stats.total_requests || '0', 10),
        activeUsers: parseInt(stats.active_users || '0', 10),
        errorRate: parseInt(stats.error_rate || '0', 10),
        averageResponseTime: parseInt(stats.avg_response_time || '0', 10),
        topEndpoints: [], // Would need to implement minute-level endpoint tracking
      };
    } catch (error) {
      this.logger.error('Failed to get real-time metrics', error);
      return {
        requestsPerMinute: 0,
        activeUsers: 0,
        errorRate: 0,
        averageResponseTime: 0,
        topEndpoints: [],
      };
    }
  }

  /**
   * Clean up old analytics data
   */
  async cleanupOldData(retentionDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const pattern = 'api_*';
      const keys = await this.redis.keys(pattern);

      for (const key of keys) {
        // Extract date from key and check if it's older than retention period
        const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          const keyDate = new Date(dateMatch[1]);
          if (keyDate < cutoffDate) {
            await this.redis.del(key);
          }
        }
      }

      this.logger.log(`Cleaned up API analytics data older than ${retentionDays} days`);
    } catch (error) {
      this.logger.error('Failed to cleanup old analytics data', error);
    }
  }

  private generateDateKeys(startDate: Date, endDate: Date, groupBy: 'hour' | 'day'): string[] {
    const keys: string[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      if (groupBy === 'day') {
        keys.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      } else {
        keys.push(current.toISOString().substring(0, 13));
        current.setHours(current.getHours() + 1);
      }
    }

    return keys;
  }

  private parseKeyToDate(key: string, groupBy: 'hour' | 'day'): Date {
    if (groupBy === 'day') {
      return new Date(key);
    } else {
      return new Date(key + ':00:00.000Z');
    }
  }

  private async getTopEndpoints(startDate: Date, endDate: Date): Promise<Array<{ endpoint: string; count: number; avgResponseTime: number }>> {
    const dateKeys = this.generateDateKeys(startDate, endDate, 'day');
    const endpointCounts: Record<string, number> = {};

    for (const dateKey of dateKeys) {
      const endpoints = await this.redis.zrevrange(`api_endpoints:daily:${dateKey}`, 0, -1, 'WITHSCORES');
      for (let i = 0; i < endpoints.length; i += 2) {
        const endpoint = endpoints[i];
        const count = parseInt(endpoints[i + 1], 10);
        endpointCounts[endpoint] = (endpointCounts[endpoint] || 0) + count;
      }
    }

    return Object.entries(endpointCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, count]) => ({
        endpoint,
        count,
        avgResponseTime: 0, // Would need to calculate from response time data
      }));
  }

  private async getErrorDistribution(startDate: Date, endDate: Date): Promise<Record<string, number>> {
    const dateKeys = this.generateDateKeys(startDate, endDate, 'day');
    const errorCounts: Record<string, number> = {};

    for (const dateKey of dateKeys) {
      const errors = await this.redis.zrevrange(`api_errors:daily:${dateKey}`, 0, -1, 'WITHSCORES');
      for (let i = 0; i < errors.length; i += 2) {
        const errorCode = errors[i];
        const count = parseInt(errors[i + 1], 10);
        errorCounts[errorCode] = (errorCounts[errorCode] || 0) + count;
      }
    }

    return errorCounts;
  }

  private async getUserDistribution(startDate: Date, endDate: Date): Promise<Array<{ userId: string; count: number }>> {
    const dateKeys = this.generateDateKeys(startDate, endDate, 'day');
    const userCounts: Record<string, number> = {};

    for (const dateKey of dateKeys) {
      const users = await this.redis.zrevrange(`api_users:daily:${dateKey}`, 0, -1, 'WITHSCORES');
      for (let i = 0; i < users.length; i += 2) {
        const userId = users[i];
        const count = parseInt(users[i + 1], 10);
        userCounts[userId] = (userCounts[userId] || 0) + count;
      }
    }

    return Object.entries(userCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([userId, count]) => ({ userId, count }));
  }

  private async getTopUsersForEndpoint(endpointKey: string, startDate: Date, endDate: Date): Promise<Array<{ userId: string; count: number }>> {
    // This would require more detailed tracking per endpoint
    return [];
  }

  private async getRecentErrorsForEndpoint(endpointKey: string, startDate: Date, endDate: Date): Promise<Array<{
    timestamp: Date;
    statusCode: number;
    errorCode: string;
    userId?: string;
  }>> {
    // This would require storing detailed error information
    return [];
  }

  // private async storeInMongoDB(event: ApiUsageEvent): Promise<void> {
  //   try {
  //     const document = new this.apiUsageModel(event);
  //     await document.save();
  //   } catch (error) {
  //     this.logger.error('Failed to store API usage event in MongoDB', error);
  //   }
  // }
}