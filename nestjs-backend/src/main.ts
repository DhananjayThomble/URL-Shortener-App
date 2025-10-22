import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { RequestTrackingInterceptor } from './common/interceptors/request-tracking.interceptor';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { SanitizationPipe } from './common/pipes/sanitization.pipe';
import { GracefulShutdownService } from './common/services/graceful-shutdown.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' 
      ? ['error', 'warn', 'log'] 
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const isProduction = configService.get('NODE_ENV') === 'production';

  // Enable graceful shutdown
  const gracefulShutdownService = app.get(GracefulShutdownService);
  app.enableShutdownHooks();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: isProduction ? {
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
    hsts: isProduction ? {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    } : false,
  }));

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

  // Global configuration - exclude redirect routes from API prefix
  app.setGlobalPrefix(configService.get('API_PREFIX', 'api/v1'), {
    exclude: [{ path: ':shortCode', method: RequestMethod.GET }],
  });
  
  // Trust proxy in production (for proper IP detection behind load balancer)
  if (isProduction) {
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
  );

  // CORS configuration
  const corsOrigins = configService.get('CORS_ORIGIN', 'http://localhost:3001').split(',');
  app.enableCors({
    origin: isProduction ? corsOrigins : true,
    credentials: configService.get('CORS_CREDENTIALS', 'true') === 'true',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Trace-ID'],
    exposedHeaders: ['X-Request-ID', 'X-Trace-ID'],
  });

  // Swagger documentation (disabled in production for security)
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('URL Shortener API')
      .setDescription('Enterprise URL Shortener built with NestJS')
      .setVersion(configService.get('APP_VERSION', '1.0.0'))
      .addBearerAuth()
      .addTag('auth', 'Authentication endpoints')
      .addTag('urls', 'URL management endpoints')
      .addTag('users', 'User management endpoints')
      .addTag('admin', 'Admin endpoints')
      .addTag('analytics', 'Analytics endpoints')
      .addTag('monitoring', 'Health checks and metrics')
      .addTag('cache', 'Cache management')
      .addServer(configService.get('BASE_URL', 'http://localhost:3000'))
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    });
  }

  // Configure timeouts
  const server = await app.listen(configService.get('PORT', 3000));
  server.keepAliveTimeout = configService.get('KEEP_ALIVE_TIMEOUT', 5000);
  server.headersTimeout = configService.get('KEEP_ALIVE_TIMEOUT', 5000) + 1000;

  const port = configService.get('PORT', 3000);
  const baseUrl = configService.get('BASE_URL', `http://localhost:${port}`);
  
  logger.log(`🚀 Application is running on: ${baseUrl}`);
  logger.log(`🌍 Environment: ${configService.get('NODE_ENV', 'development')}`);
  logger.log(`📊 Health checks: ${baseUrl}/health`);
  logger.log(`📈 Metrics: ${baseUrl}/metrics`);
  
  if (!isProduction) {
    logger.log(`📚 API Documentation: ${baseUrl}/docs`);
  }

  // Log startup completion
  logger.log('✅ Application startup completed successfully');
}

bootstrap();