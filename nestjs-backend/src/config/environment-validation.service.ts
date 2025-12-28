import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Joi from 'joi';

export interface EnvironmentVariables {
  // Application Configuration
  NODE_ENV: 'development' | 'staging' | 'production' | 'test';
  PORT: number;
  API_PREFIX: string;
  APP_VERSION: string;
  
  // Database Configuration
  DATABASE_URL: string;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USERNAME: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  
  // MongoDB Configuration
  MONGODB_URI: string;
  MONGODB_HOST: string;
  MONGODB_PORT: number;
  MONGODB_DATABASE: string;
  
  // Redis Configuration
  REDIS_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_DB: number;
  REDIS_KEY_PREFIX: string;
  
  // JWT Configuration
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRES_IN: string;
  JWT_ADMIN_EXPIRES_IN?: string;
  
  // Security Configuration
  BCRYPT_SALT_ROUNDS: number;
  SESSION_SECRET: string;
  CORS_ORIGIN?: string;
  CORS_CREDENTIALS?: boolean;
  
  // Cache Configuration
  CACHE_TTL_URL: number;
  CACHE_TTL_SESSION: number;
  CACHE_TTL_ANALYTICS: number;
  CACHE_TTL_METADATA?: number;
  CACHE_TTL_POPULAR?: number;
  CACHE_TTL_DEFAULT?: number;
  CACHE_ENABLE_COMPRESSION?: boolean;
  CACHE_ENABLE_WARMING?: boolean;
  CACHE_AUTO_OPTIMIZE?: boolean;
  CACHE_MAX_KEY_LENGTH?: number;
  CACHE_MAX_VALUE_SIZE?: number;
  
  // Rate Limiting Configuration
  RATE_LIMIT_TTL: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_AUTH_TTL?: number;
  RATE_LIMIT_AUTH_MAX?: number;
  RATE_LIMIT_URL_CREATION_TTL?: number;
  RATE_LIMIT_URL_CREATION_MAX?: number;
  RATE_LIMIT_URL_ACCESS_TTL?: number;
  RATE_LIMIT_URL_ACCESS_MAX?: number;
  
  // Performance Configuration
  ENABLE_COMPRESSION?: boolean;
  ENABLE_HELMET?: boolean;
  ENABLE_CORS?: boolean;
  MAX_REQUEST_SIZE?: string;
  REQUEST_TIMEOUT?: number;
  
  // Monitoring Configuration
  ENABLE_METRICS?: boolean;
  ENABLE_HEALTH_CHECKS?: boolean;
  ENABLE_DISTRIBUTED_TRACING?: boolean;
  METRICS_ENDPOINT_ENABLED?: boolean;
  HEALTH_CHECK_TIMEOUT?: number;
  ENABLE_PROMETHEUS_TRACING?: boolean;
  PROMETHEUS_METRICS_PORT?: number;
  
  // Logging Configuration
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug' | 'verbose';
  CLOUDWATCH_LOG_GROUP?: string;
  CLOUDWATCH_LOG_STREAM?: string;
  
  // AWS Configuration
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  
  // Email Configuration
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_SECURE?: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_FROM?: string;
  
  // Application URLs
  BASE_URL: string;
  FRONTEND_URL: string;
  BACKEND_URL?: string;
  
  // Feature Flags
  ENABLE_ANALYTICS?: boolean;
  ENABLE_CUSTOM_DOMAINS?: boolean;
  ENABLE_LINK_IN_BIO?: boolean;
  ENABLE_PASSWORD_PROTECTION?: boolean;
  ENABLE_EXPIRATION?: boolean;
  ENABLE_BULK_OPERATIONS?: boolean;
  ENABLE_SWAGGER?: boolean;
  
  // Security Headers
  HSTS_MAX_AGE?: number;
  CSP_POLICY?: string;
  
  // Database Pool Configuration
  DB_POOL_MIN?: number;
  DB_POOL_MAX?: number;
  DB_POOL_IDLE_TIMEOUT?: number;
  DB_POOL_ACQUIRE_TIMEOUT?: number;
  
  // Graceful Shutdown Configuration
  SHUTDOWN_TIMEOUT?: number;
  KEEP_ALIVE_TIMEOUT?: number;
}

@Injectable()
export class EnvironmentValidationService {
  private readonly logger = new Logger(EnvironmentValidationService.name);
  
  constructor(private configService: ConfigService) {}

  /**
   * Joi schema for environment variable validation
   */
  private readonly validationSchema = Joi.object({
    // Application Configuration
    NODE_ENV: Joi.string()
      .valid('development', 'staging', 'production', 'test')
      .default('development'),
    PORT: Joi.number().port().default(3000),
    API_PREFIX: Joi.string().default('api/v1'),
    APP_VERSION: Joi.string().default('1.0.0'),
    
    // Database Configuration
    DATABASE_URL: Joi.string().uri().required(),
    DATABASE_HOST: Joi.string().required(),
    DATABASE_PORT: Joi.number().port().default(5432),
    DATABASE_USERNAME: Joi.string().required(),
    DATABASE_PASSWORD: Joi.string().min(8).required(),
    DATABASE_NAME: Joi.string().required(),
    
    // MongoDB Configuration
    MONGODB_URI: Joi.string().uri().required(),
    MONGODB_HOST: Joi.string().required(),
    MONGODB_PORT: Joi.number().port().default(27017),
    MONGODB_DATABASE: Joi.string().required(),
    
    // Redis Configuration
    REDIS_URL: Joi.string().uri().required(),
    REDIS_HOST: Joi.string().required(),
    REDIS_PORT: Joi.number().port().default(6379),
    REDIS_PASSWORD: Joi.string().optional().allow(''),
    REDIS_DB: Joi.number().min(0).max(15).default(0),
    REDIS_KEY_PREFIX: Joi.string().default('urlshortener:'),
    
    // JWT Configuration
    JWT_SECRET: Joi.string().min(32).required(),
    JWT_EXPIRES_IN: Joi.string().default('15m'),
    JWT_REFRESH_SECRET: Joi.string().min(32).required(),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
    JWT_ADMIN_EXPIRES_IN: Joi.string().default('8h'),
    
    // Security Configuration
    BCRYPT_SALT_ROUNDS: Joi.number().min(10).max(15).default(12),
    SESSION_SECRET: Joi.string().min(32).required(),
    CORS_ORIGIN: Joi.string().optional(),
    CORS_CREDENTIALS: Joi.boolean().default(true),
    
    // Cache Configuration
    CACHE_TTL_URL: Joi.number().min(0).default(3600),
    CACHE_TTL_SESSION: Joi.number().min(0).default(900),
    CACHE_TTL_ANALYTICS: Joi.number().min(0).default(300),
    CACHE_TTL_METADATA: Joi.number().min(0).default(86400),
    CACHE_TTL_POPULAR: Joi.number().min(0).default(1800),
    CACHE_TTL_DEFAULT: Joi.number().min(0).default(3600),
    CACHE_ENABLE_COMPRESSION: Joi.boolean().default(true),
    CACHE_ENABLE_WARMING: Joi.boolean().default(true),
    CACHE_AUTO_OPTIMIZE: Joi.boolean().default(true),
    CACHE_MAX_KEY_LENGTH: Joi.number().min(1).default(250),
    CACHE_MAX_VALUE_SIZE: Joi.number().min(1).default(1048576),
    
    // Rate Limiting Configuration
    RATE_LIMIT_TTL: Joi.number().min(0).default(60000),
    RATE_LIMIT_MAX: Joi.number().min(0).default(100),
    RATE_LIMIT_AUTH_TTL: Joi.number().min(0).default(900000),
    RATE_LIMIT_AUTH_MAX: Joi.number().min(0).default(5),
    RATE_LIMIT_URL_CREATION_TTL: Joi.number().min(0).default(60000),
    RATE_LIMIT_URL_CREATION_MAX: Joi.number().min(0).default(10),
    RATE_LIMIT_URL_ACCESS_TTL: Joi.number().min(0).default(60000),
    RATE_LIMIT_URL_ACCESS_MAX: Joi.number().min(0).default(100),
    
    // Performance Configuration
    ENABLE_COMPRESSION: Joi.boolean().default(true),
    ENABLE_HELMET: Joi.boolean().default(true),
    ENABLE_CORS: Joi.boolean().default(true),
    MAX_REQUEST_SIZE: Joi.string().default('10mb'),
    REQUEST_TIMEOUT: Joi.number().min(1000).default(30000),
    
    // Monitoring Configuration
    ENABLE_METRICS: Joi.boolean().default(true),
    ENABLE_HEALTH_CHECKS: Joi.boolean().default(true),
    ENABLE_DISTRIBUTED_TRACING: Joi.boolean().default(false),
    METRICS_ENDPOINT_ENABLED: Joi.boolean().default(true),
    HEALTH_CHECK_TIMEOUT: Joi.number().min(1000).default(5000),
    ENABLE_PROMETHEUS_TRACING: Joi.boolean().default(false),
    PROMETHEUS_METRICS_PORT: Joi.number().port().default(9090),
    
    // Logging Configuration
    LOG_LEVEL: Joi.string()
      .valid('error', 'warn', 'info', 'debug', 'verbose')
      .default('info'),
    CLOUDWATCH_LOG_GROUP: Joi.string().optional(),
    CLOUDWATCH_LOG_STREAM: Joi.string().optional(),
    
    // AWS Configuration
    AWS_REGION: Joi.string().optional(),
    AWS_ACCESS_KEY_ID: Joi.string().optional(),
    AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
    
    // Email Configuration
    SMTP_HOST: Joi.string().optional(),
    SMTP_PORT: Joi.number().port().optional(),
    SMTP_SECURE: Joi.boolean().default(false),
    SMTP_USER: Joi.string().optional(),
    SMTP_PASS: Joi.string().optional(),
    EMAIL_FROM: Joi.string().email().optional(),
    
    // Application URLs
    BASE_URL: Joi.string().uri().required(),
    FRONTEND_URL: Joi.string().uri().required(),
    BACKEND_URL: Joi.string().uri().optional(),
    
    // Feature Flags
    ENABLE_ANALYTICS: Joi.boolean().default(true),
    ENABLE_CUSTOM_DOMAINS: Joi.boolean().default(false),
    ENABLE_LINK_IN_BIO: Joi.boolean().default(true),
    ENABLE_PASSWORD_PROTECTION: Joi.boolean().default(true),
    ENABLE_EXPIRATION: Joi.boolean().default(true),
    ENABLE_BULK_OPERATIONS: Joi.boolean().default(true),
    ENABLE_SWAGGER: Joi.boolean().default(false),
    
    // Security Headers
    HSTS_MAX_AGE: Joi.number().min(0).default(31536000),
    CSP_POLICY: Joi.string().optional(),
    
    // Database Pool Configuration
    DB_POOL_MIN: Joi.number().min(1).default(2),
    DB_POOL_MAX: Joi.number().min(1).default(10),
    DB_POOL_IDLE_TIMEOUT: Joi.number().min(1000).default(30000),
    DB_POOL_ACQUIRE_TIMEOUT: Joi.number().min(1000).default(60000),
    
    // Graceful Shutdown Configuration
    SHUTDOWN_TIMEOUT: Joi.number().min(1000).default(10000),
    KEEP_ALIVE_TIMEOUT: Joi.number().min(1000).default(5000),
  });

  /**
   * Validate environment variables
   */
  validate(config: Record<string, unknown>): EnvironmentVariables {
    const { error, value } = this.validationSchema.validate(config, {
      allowUnknown: true,
      abortEarly: false,
    });

    if (error) {
      const errorMessages = error.details.map((detail: Joi.ValidationErrorItem) => detail.message);
      this.logger.error('Environment validation failed:', errorMessages);
      throw new Error(`Environment validation failed: ${errorMessages.join(', ')}`);
    }

    return value;
  }

  /**
   * Validate production-specific requirements
   */
  validateProductionRequirements(): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    
    if (nodeEnv === 'production') {
      this.validateProductionSecrets();
      this.validateProductionUrls();
      this.validateProductionSecurity();
      this.validateProductionPerformance();
    }
  }

  /**
   * Validate production secrets
   */
  private validateProductionSecrets(): void {
    const secrets = [
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'SESSION_SECRET',
      'DATABASE_PASSWORD',
    ];

    const weakSecrets = secrets.filter(secret => {
      const value = this.configService.get<string>(secret);
      return !value || 
             value.includes('CHANGE_ME') || 
             value.includes('dev-') || 
             value.includes('test-') ||
             value.length < 32;
    });

    if (weakSecrets.length > 0) {
      throw new Error(
        `Production deployment requires strong secrets for: ${weakSecrets.join(', ')}`
      );
    }
  }

  /**
   * Validate production URLs
   */
  private validateProductionUrls(): void {
    const urls = ['BASE_URL', 'FRONTEND_URL'];
    
    const invalidUrls = urls.filter(urlKey => {
      const url = this.configService.get<string>(urlKey);
      return !url || 
             url.includes('localhost') || 
             url.includes('127.0.0.1') ||
             !url.startsWith('https://');
    });

    if (invalidUrls.length > 0) {
      throw new Error(
        `Production deployment requires HTTPS URLs for: ${invalidUrls.join(', ')}`
      );
    }
  }

  /**
   * Validate production security settings
   */
  private validateProductionSecurity(): void {
    const bcryptRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS');
    if (bcryptRounds < 12) {
      throw new Error('Production deployment requires BCRYPT_SALT_ROUNDS >= 12');
    }

    const corsOrigin = this.configService.get<string>('CORS_ORIGIN');
    if (!corsOrigin || corsOrigin === '*') {
      throw new Error('Production deployment requires specific CORS_ORIGIN (not *)');
    }
  }

  /**
   * Validate production performance settings
   */
  private validateProductionPerformance(): void {
    const compressionEnabled = this.configService.get<boolean>('ENABLE_COMPRESSION');
    if (!compressionEnabled) {
      this.logger.warn('Compression is disabled in production - this may impact performance');
    }

    const helmetEnabled = this.configService.get<boolean>('ENABLE_HELMET');
    if (!helmetEnabled) {
      this.logger.warn('Helmet is disabled in production - this may impact security');
    }

    const dbPoolMax = this.configService.get<number>('DB_POOL_MAX');
    if (dbPoolMax < 5) {
      this.logger.warn('Database pool size is low for production - consider increasing DB_POOL_MAX');
    }
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentConfig(): {
    environment: string;
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
    isStaging: boolean;
  } {
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
    
    return {
      environment: nodeEnv,
      isDevelopment: nodeEnv === 'development',
      isProduction: nodeEnv === 'production',
      isTest: nodeEnv === 'test',
      isStaging: nodeEnv === 'staging',
    };
  }

  /**
   * Get database configuration
   */
  getDatabaseConfig() {
    return {
      postgres: {
        url: this.configService.get<string>('DATABASE_URL'),
        host: this.configService.get<string>('DATABASE_HOST'),
        port: this.configService.get<number>('DATABASE_PORT'),
        username: this.configService.get<string>('DATABASE_USERNAME'),
        password: this.configService.get<string>('DATABASE_PASSWORD'),
        database: this.configService.get<string>('DATABASE_NAME'),
        pool: {
          min: this.configService.get<number>('DB_POOL_MIN', 2),
          max: this.configService.get<number>('DB_POOL_MAX', 10),
          idleTimeout: this.configService.get<number>('DB_POOL_IDLE_TIMEOUT', 30000),
          acquireTimeout: this.configService.get<number>('DB_POOL_ACQUIRE_TIMEOUT', 60000),
        },
      },
      mongodb: {
        uri: this.configService.get<string>('MONGODB_URI'),
        host: this.configService.get<string>('MONGODB_HOST'),
        port: this.configService.get<number>('MONGODB_PORT'),
        database: this.configService.get<string>('MONGODB_DATABASE'),
      },
      redis: {
        url: this.configService.get<string>('REDIS_URL'),
        host: this.configService.get<string>('REDIS_HOST'),
        port: this.configService.get<number>('REDIS_PORT'),
        password: this.configService.get<string>('REDIS_PASSWORD'),
        db: this.configService.get<number>('REDIS_DB', 0),
        keyPrefix: this.configService.get<string>('REDIS_KEY_PREFIX', 'urlshortener:'),
      },
    };
  }

  /**
   * Get security configuration
   */
  getSecurityConfig() {
    return {
      jwt: {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m'),
        refreshSecret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        refreshExpiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
        adminExpiresIn: this.configService.get<string>('JWT_ADMIN_EXPIRES_IN', '8h'),
      },
      bcrypt: {
        saltRounds: this.configService.get<number>('BCRYPT_SALT_ROUNDS', 12),
      },
      session: {
        secret: this.configService.get<string>('SESSION_SECRET'),
      },
      cors: {
        origin: this.configService.get<string>('CORS_ORIGIN'),
        credentials: this.configService.get<boolean>('CORS_CREDENTIALS', true),
      },
      headers: {
        hstsMaxAge: this.configService.get<number>('HSTS_MAX_AGE', 31536000),
        cspPolicy: this.configService.get<string>('CSP_POLICY'),
      },
    };
  }

  /**
   * Get feature flags
   */
  getFeatureFlags() {
    return {
      analytics: this.configService.get<boolean>('ENABLE_ANALYTICS', true),
      customDomains: this.configService.get<boolean>('ENABLE_CUSTOM_DOMAINS', false),
      linkInBio: this.configService.get<boolean>('ENABLE_LINK_IN_BIO', true),
      passwordProtection: this.configService.get<boolean>('ENABLE_PASSWORD_PROTECTION', true),
      expiration: this.configService.get<boolean>('ENABLE_EXPIRATION', true),
      bulkOperations: this.configService.get<boolean>('ENABLE_BULK_OPERATIONS', true),
      swagger: this.configService.get<boolean>('ENABLE_SWAGGER', false),
      metrics: this.configService.get<boolean>('ENABLE_METRICS', true),
      healthChecks: this.configService.get<boolean>('ENABLE_HEALTH_CHECKS', true),
      distributedTracing: this.configService.get<boolean>('ENABLE_DISTRIBUTED_TRACING', false),
      compression: this.configService.get<boolean>('ENABLE_COMPRESSION', true),
      helmet: this.configService.get<boolean>('ENABLE_HELMET', true),
      cors: this.configService.get<boolean>('ENABLE_CORS', true),
    };
  }

  /**
   * Log configuration summary (without sensitive data)
   */
  logConfigurationSummary(): void {
    const env = this.getEnvironmentConfig();
    const features = this.getFeatureFlags();
    
    this.logger.log('=== Configuration Summary ===');
    this.logger.log(`Environment: ${env.environment}`);
    this.logger.log(`Port: ${this.configService.get('PORT')}`);
    this.logger.log(`Log Level: ${this.configService.get('LOG_LEVEL')}`);
    this.logger.log(`Base URL: ${this.configService.get('BASE_URL')}`);
    this.logger.log('=== Feature Flags ===');
    Object.entries(features).forEach(([key, value]) => {
      this.logger.log(`${key}: ${value}`);
    });
    this.logger.log('=== End Configuration Summary ===');
  }
}