/**
 * Production Configuration Service
 * Manages production-specific configuration validation and setup
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProductionConfigService implements OnModuleInit {
  private readonly logger = new Logger(ProductionConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    if (this.isProduction()) {
      await this.validateProductionConfig();
      this.logProductionSettings();
    }
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private async validateProductionConfig(): Promise<void> {
    this.logger.log('🔍 Validating production configuration...');

    const errors: string[] = [];

    // Validate critical environment variables
    const requiredEnvVars = [
      'JWT_SECRET',
      'POSTGRES_PASSWORD',
      'MONGODB_URI',
      'REDIS_PASSWORD',
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        errors.push(`Missing required environment variable: ${envVar}`);
      }
    }

    // Validate JWT secret strength
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters long in production');
    }

    // Validate database configurations
    await this.validateDatabaseConfig(errors);

    // Validate security settings
    this.validateSecurityConfig(errors);

    // Validate external service configurations
    this.validateExternalServices(errors);

    if (errors.length > 0) {
      this.logger.error('❌ Production configuration validation failed:');
      errors.forEach(error => this.logger.error(`  - ${error}`));
      throw new Error('Production configuration validation failed');
    }

    this.logger.log('✅ Production configuration validation passed');
  }

  private async validateDatabaseConfig(errors: string[]): Promise<void> {
    // PostgreSQL validation
    const pgHost = this.configService.get('production.database.postgresql.host');
    const pgPassword = this.configService.get('production.database.postgresql.password');
    
    if (!pgPassword) {
      errors.push('PostgreSQL password is required in production');
    }

    if (pgHost === 'localhost' && this.isProduction()) {
      this.logger.warn('⚠️  PostgreSQL host is localhost in production - consider using a managed database');
    }

    // MongoDB validation
    const mongoUri = this.configService.get('production.database.mongodb.uri');
    if (!mongoUri || mongoUri.includes('localhost')) {
      this.logger.warn('⚠️  MongoDB URI contains localhost in production - consider using a managed database');
    }

    // Redis validation
    const redisHost = this.configService.get('production.database.redis.host');
    const redisPassword = this.configService.get('production.database.redis.password');
    
    if (!redisPassword) {
      errors.push('Redis password is required in production');
    }

    if (redisHost === 'localhost' && this.isProduction()) {
      this.logger.warn('⚠️  Redis host is localhost in production - consider using a managed Redis service');
    }
  }

  private validateSecurityConfig(errors: string[]): void {
    // CORS validation
    const corsOrigin = this.configService.get('production.security.cors.origin');
    if (!corsOrigin || corsOrigin.includes('*')) {
      errors.push('CORS origin must be explicitly set in production (no wildcards)');
    }

    // Rate limiting validation
    const rateLimitMax = this.configService.get('production.security.rateLimit.max');
    if (!rateLimitMax || rateLimitMax > 1000) {
      this.logger.warn('⚠️  Rate limit max is very high or not set - consider lowering for production');
    }

    // SSL/TLS validation
    const postgresSSL = this.configService.get('production.database.postgresql.ssl');
    if (!postgresSSL) {
      this.logger.warn('⚠️  PostgreSQL SSL is not enabled - consider enabling for production');
    }

    const mongoSSL = this.configService.get('production.database.mongodb.options.ssl');
    if (!mongoSSL) {
      this.logger.warn('⚠️  MongoDB SSL is not enabled - consider enabling for production');
    }
  }

  private validateExternalServices(errors: string[]): void {
    // Email service validation
    const emailProvider = this.configService.get('production.services.email.provider');
    if (emailProvider === 'smtp') {
      const smtpHost = this.configService.get('production.services.email.smtp.host');
      const smtpUser = this.configService.get('production.services.email.smtp.auth.user');
      
      if (!smtpHost || !smtpUser) {
        errors.push('SMTP configuration is incomplete (missing host or user)');
      }
    }

    // Monitoring validation
    const sentryEnabled = this.configService.get('production.services.monitoring.sentry.enabled');
    const sentryDsn = this.configService.get('production.services.monitoring.sentry.dsn');
    
    if (sentryEnabled && !sentryDsn) {
      errors.push('Sentry is enabled but DSN is not configured');
    }

    // Storage validation
    const storageProvider = this.configService.get('production.services.storage.provider');
    if (storageProvider === 's3') {
      const s3Bucket = this.configService.get('production.services.storage.s3.bucket');
      const s3AccessKey = this.configService.get('production.services.storage.s3.accessKeyId');
      
      if (!s3Bucket || !s3AccessKey) {
        errors.push('S3 storage configuration is incomplete');
      }
    }
  }

  private logProductionSettings(): void {
    this.logger.log('🚀 Production configuration summary:');
    
    // Database settings
    const pgHost = this.configService.get('production.database.postgresql.host');
    const pgSSL = this.configService.get('production.database.postgresql.ssl');
    this.logger.log(`  📊 PostgreSQL: ${pgHost} (SSL: ${pgSSL ? 'enabled' : 'disabled'})`);
    
    const mongoUri = this.configService.get('production.database.mongodb.uri');
    const mongoSSL = this.configService.get('production.database.mongodb.options.ssl');
    this.logger.log(`  📄 MongoDB: ${mongoUri?.replace(/\/\/.*@/, '//***@')} (SSL: ${mongoSSL ? 'enabled' : 'disabled'})`);
    
    const redisHost = this.configService.get('production.database.redis.host');
    const redisCluster = this.configService.get('production.database.redis.cluster');
    this.logger.log(`  🔴 Redis: ${redisHost} (Cluster: ${redisCluster ? 'enabled' : 'disabled'})`);

    // Security settings
    const corsOrigin = this.configService.get('production.security.cors.origin');
    this.logger.log(`  🔒 CORS Origins: ${Array.isArray(corsOrigin) ? corsOrigin.join(', ') : corsOrigin}`);
    
    const rateLimitMax = this.configService.get('production.security.rateLimit.max');
    const rateLimitWindow = this.configService.get('production.security.rateLimit.windowMs');
    this.logger.log(`  🚦 Rate Limit: ${rateLimitMax} requests per ${rateLimitWindow / 1000}s`);

    // External services
    const emailProvider = this.configService.get('production.services.email.provider');
    this.logger.log(`  📧 Email Provider: ${emailProvider}`);
    
    const geoipProvider = this.configService.get('production.services.geoip.provider');
    this.logger.log(`  🌍 GeoIP Provider: ${geoipProvider}`);
    
    const storageProvider = this.configService.get('production.services.storage.provider');
    this.logger.log(`  💾 Storage Provider: ${storageProvider}`);

    // Monitoring
    const sentryEnabled = this.configService.get('production.services.monitoring.sentry.enabled');
    const prometheusEnabled = this.configService.get('production.services.monitoring.prometheus.enabled');
    this.logger.log(`  📈 Monitoring: Sentry ${sentryEnabled ? 'enabled' : 'disabled'}, Prometheus ${prometheusEnabled ? 'enabled' : 'disabled'}`);

    // Feature flags
    const features = this.configService.get('production.features');
    const enabledFeatures = Object.entries(features || {})
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature);
    this.logger.log(`  🎛️  Enabled Features: ${enabledFeatures.join(', ')}`);

    // Performance settings
    const clusteringEnabled = this.configService.get('production.performance.clustering.enabled');
    const workers = this.configService.get('production.performance.clustering.workers');
    this.logger.log(`  ⚡ Clustering: ${clusteringEnabled ? `enabled (${workers || 'auto'} workers)` : 'disabled'}`);
  }

  // Helper methods for accessing production configuration
  getDatabaseConfig(type: 'postgresql' | 'mongodb' | 'redis') {
    return this.configService.get(`production.database.${type}`);
  }

  getServiceConfig(service: string) {
    return this.configService.get(`production.services.${service}`);
  }

  getSecurityConfig() {
    return this.configService.get('production.security');
  }

  getAppConfig() {
    return this.configService.get('production.app');
  }

  getLoggingConfig() {
    return this.configService.get('production.logging');
  }

  getPerformanceConfig() {
    return this.configService.get('production.performance');
  }

  getFeatureFlags() {
    return this.configService.get('production.features');
  }

  getHealthConfig() {
    return this.configService.get('production.health');
  }

  isFeatureEnabled(feature: string): boolean {
    return this.configService.get(`production.features.${feature}`, false);
  }

  // Environment-specific configuration getters
  getJwtConfig() {
    return this.configService.get('production.security.jwt');
  }

  getCorsConfig() {
    return this.configService.get('production.security.cors');
  }

  getRateLimitConfig() {
    return this.configService.get('production.security.rateLimit');
  }

  getHelmetConfig() {
    return this.configService.get('production.security.helmet');
  }

  // Monitoring configuration
  getMonitoringConfig() {
    return this.configService.get('production.services.monitoring');
  }

  getSentryConfig() {
    return this.configService.get('production.services.monitoring.sentry');
  }

  getPrometheusConfig() {
    return this.configService.get('production.services.monitoring.prometheus');
  }

  // Storage configuration
  getStorageConfig() {
    return this.configService.get('production.services.storage');
  }

  // Email configuration
  getEmailConfig() {
    return this.configService.get('production.services.email');
  }

  // GeoIP configuration
  getGeoIPConfig() {
    return this.configService.get('production.services.geoip');
  }
}