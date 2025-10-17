import { Controller, Get, Delete, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { CacheService } from '../services/cache.service';
import { CacheManagerService } from '../services/cache-manager.service';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { UserRole } from '../../modules/users/entities/user.entity';

@ApiTags('Cache Management')
@Controller('cache')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class CacheController {
  constructor(
    private cacheService: CacheService,
    private cacheManagerService: CacheManagerService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Check cache health status' })
  @ApiResponse({ status: 200, description: 'Cache health status' })
  async getHealthStatus() {
    const isHealthy = await this.cacheService.healthCheck();
    const metrics = await this.cacheManagerService.getMetrics();
    
    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      metrics,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  @ApiResponse({ status: 200, description: 'Cache statistics' })
  async getStats() {
    const stats = await this.cacheService.getStats();
    const metrics = await this.cacheManagerService.getMetrics();
    const size = await this.cacheManagerService.getCacheSize();
    
    return {
      redis: stats,
      performance: metrics,
      size,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('size')
  @ApiOperation({ summary: 'Get cache size information' })
  @ApiResponse({ status: 200, description: 'Cache size information' })
  async getCacheSize() {
    return this.cacheManagerService.getCacheSize();
  }

  @Delete('clear')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Clear cache (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  async clearCache(@Query('pattern') pattern?: string) {
    const clearedCount = await this.cacheManagerService.clearCache(pattern);
    
    return {
      message: pattern 
        ? `Cache cleared with pattern: ${pattern}` 
        : 'Entire cache cleared',
      clearedCount,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('optimize')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Optimize cache performance (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache optimization completed' })
  async optimizeCache() {
    await this.cacheManagerService.optimizeCache();
    
    return {
      message: 'Cache optimization completed',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('warm')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Warm cache with popular data (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache warming completed' })
  async warmCache() {
    await this.cacheManagerService.preloadPopularUrls();
    
    return {
      message: 'Cache warming completed',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('validate')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Validate cache health (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cache health validation results' })
  async validateHealth() {
    const isHealthy = await this.cacheManagerService.validateCacheHealth();
    const metrics = await this.cacheManagerService.getMetrics();
    
    return {
      isHealthy,
      metrics,
      recommendations: this.generateRecommendations(metrics),
      timestamp: new Date().toISOString(),
    };
  }

  private generateRecommendations(metrics: any): string[] {
    const recommendations: string[] = [];
    
    if (metrics.hitRate < 70) {
      recommendations.push('Consider cache warming to improve hit rate');
    }
    
    if (metrics.keyCount > 100000) {
      recommendations.push('High key count detected - consider cleanup or TTL optimization');
    }
    
    if (metrics.hitRate > 95) {
      recommendations.push('Excellent cache performance - consider increasing TTL for better efficiency');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Cache performance is optimal');
    }
    
    return recommendations;
  }
}