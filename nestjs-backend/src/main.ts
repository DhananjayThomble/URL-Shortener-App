import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestTrackingInterceptor } from './common/interceptors/request-tracking.interceptor';
import { ApiVersioningInterceptor } from './common/interceptors/api-versioning.interceptor';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import { GracefulShutdownService } from './common/services/graceful-shutdown.service';
import { SwaggerConfig } from './config/swagger.config';
import { EnvironmentValidationService } from './config/environment-validation.service';
import { SecretsManagementService } from './config/secrets-management.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' 
      ? ['error', 'warn', 'log'] 
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  
  const configService = app.get(ConfigService);
  const envValidationService = app.get(EnvironmentValidationService);
  const secretsService = app.get(SecretsManagementService);
  const logger = new Logger('Bootstrap');
  
  // Get environment configuration
  const envConfig = envValidationService.getEnvironmentConfig();
  const securityConfig = envValidationService.getSecurityConfig();
  const featureFlags = envValidationService.getFeatureFlags();
  
  logger.log(`🌍 Starting application in ${envConfig.environment} mode`);

  // Validate secrets before startup
  try {
    secretsService.validateApplicationSecrets();
    secretsService.logSecretsAudit();
  } catch (error) {
    logger.error('Secrets validation failed:', error.message);
    if (envConfig.isProduction) {
      process.exit(1);
    }
  }

  // Enable graceful shutdown
  const gracefulShutdownService = app.get(GracefulShutdownService);
  app.enableShutdownHooks();

  // Security middleware (only if enabled)
  if (featureFlags.helmet) {
    app.use(helmet({
      contentSecurityPolicy: envConfig.isProduction ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      } : false,
      hsts: envConfig.isProduction ? {
        maxAge: securityConfig.headers.hstsMaxAge,
        includeSubDomains: true,
        preload: true,
      } : false,
    }));
  }

  // Compression middleware (only if enabled)
  if (featureFlags.compression) {
    app.use(compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024,
    }));
  }

  // Global configuration
  app.setGlobalPrefix(configService.get('apiPrefix', 'api/v1'));
  
  // Trust proxy in production (for proper IP detection behind load balancer)
  if (envConfig.isProduction) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  // Global pipes
  app.useGlobalPipes(
    new SanitizationPipe(),
    new CustomValidationPipe(),
  );

  // Global filters and interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    app.get(RequestTrackingInterceptor),
    new ApiVersioningInterceptor(),
  );

  // CORS configuration (only if enabled)
  if (featureFlags.cors) {
    const corsOrigin = securityConfig.cors.origin;
    app.enableCors({
      origin: envConfig.isProduction ? corsOrigin : true,
      credentials: securityConfig.cors.credentials,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Trace-ID'],
      exposedHeaders: ['X-Request-ID', 'X-Trace-ID'],
    });
  }

  // Enhanced Swagger documentation (only if enabled)
  if (featureFlags.swagger) {
    SwaggerConfig.setup(app, configService);
  }

  // Configure timeouts
  const port = configService.get('port', 3000);
  const server = await app.listen(port);
  
  const performanceConfig = configService.get('performance', {});
  server.keepAliveTimeout = performanceConfig.keepAliveTimeout || 5000;
  server.headersTimeout = (performanceConfig.keepAliveTimeout || 5000) + 1000;

  const baseUrl = configService.get('baseUrl', `http://localhost:${port}`);
  
  // Startup logging
  logger.log(`🚀 Application is running on: ${baseUrl}`);
  logger.log(`🌍 Environment: ${envConfig.environment}`);
  logger.log(`📊 Health checks: ${baseUrl}/health`);
  
  if (featureFlags.metrics) {
    logger.log(`📈 Metrics: ${baseUrl}/metrics`);
  }
  
  if (featureFlags.swagger && !envConfig.isProduction) {
    logger.log(`📚 API Documentation: ${baseUrl}/docs`);
  }

  // Log feature flags status
  logger.log('🎛️  Feature flags:');
  Object.entries(featureFlags).forEach(([key, value]) => {
    logger.log(`   ${key}: ${value ? '✅' : '❌'}`);
  });

  // Log startup completion
  logger.log('✅ Application startup completed successfully');
}

bootstrap();