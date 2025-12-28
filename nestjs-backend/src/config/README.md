# Environment Configuration System

This directory contains the comprehensive environment configuration system for the NestJS URL Shortener application.

## Overview

The environment configuration system provides:
- **Environment-specific configurations** for development, staging, production, and test
- **Comprehensive validation** using Joi schemas
- **Secrets management** with encryption and security auditing
- **Production readiness checks** to ensure secure deployment
- **Feature flags** for enabling/disabling functionality per environment

## Files

### Core Configuration Files

- **`environment.module.ts`** - Main configuration module that integrates all environment services
- **`environment-validation.service.ts`** - Joi-based validation service for environment variables
- **`environment-configs.ts`** - Environment-specific configuration factories
- **`secrets-management.service.ts`** - Secrets validation, encryption, and security auditing

### Environment Files

- **`.env.development`** - Development environment variables
- **`.env.staging`** - Staging environment variables  
- **`.env.test`** - Test environment variables
- **`.env.production`** - Production environment variables (not in repo)
- **`.env.example`** - Example environment file with all variables

### Validation Scripts

- **`validate-env.js`** - Environment validation script
- **`test-production-readiness.js`** - Production readiness testing
- **`test-env-validation.js`** - Simple validation test

## Usage

### 1. Environment Module Integration

The `EnvironmentModule` is imported in `app.module.ts` and provides global configuration:

```typescript
import { EnvironmentModule } from './config/environment.module';

@Module({
  imports: [
    EnvironmentModule, // Must be first
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. Using Configuration in Services

```typescript
import { ConfigService } from '@nestjs/config';
import { EnvironmentValidationService } from './config/environment-validation.service';

@Injectable()
export class MyService {
  constructor(
    private configService: ConfigService,
    private envValidationService: EnvironmentValidationService,
  ) {}

  getConfig() {
    // Get environment-specific config
    const envConfig = this.envValidationService.getEnvironmentConfig();
    const dbConfig = this.envValidationService.getDatabaseConfig();
    const securityConfig = this.envValidationService.getSecurityConfig();
    const featureFlags = this.envValidationService.getFeatureFlags();
    
    // Get individual values
    const port = this.configService.get('port', 3000);
    const baseUrl = this.configService.get('baseUrl');
  }
}
```

### 3. Environment-Specific Configurations

Each environment has its own configuration factory:

- **Development**: Relaxed security, debug logging, local databases
- **Staging**: Production-like with some debugging enabled
- **Production**: Strict security, minimal logging, optimized performance
- **Test**: Fast execution, in-memory/test databases, minimal features

### 4. Validation and Security

The system automatically:
- Validates all environment variables using Joi schemas
- Checks production security requirements
- Audits secrets for weakness
- Logs configuration summaries (without sensitive data)

## Environment Variables

### Required Variables

```bash
# Application
NODE_ENV=development|staging|production|test
PORT=3000
BASE_URL=https://api.example.com
FRONTEND_URL=https://example.com

# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
MONGODB_URI=mongodb://host:27017/db
REDIS_URL=redis://host:6379

# Security
JWT_SECRET=your-32-char-minimum-secret
JWT_REFRESH_SECRET=your-32-char-minimum-refresh-secret
SESSION_SECRET=your-32-char-minimum-session-secret
```

### Optional Variables

```bash
# Logging
LOG_LEVEL=info|debug|warn|error
CLOUDWATCH_LOG_GROUP=url-shortener
CLOUDWATCH_LOG_STREAM=nestjs-app

# Features
ENABLE_SWAGGER=true|false
ENABLE_METRICS=true|false
ENABLE_COMPRESSION=true|false

# Performance
CACHE_TTL_URL=3600
RATE_LIMIT_MAX=100
DB_POOL_MAX=20
```

## Production Deployment

### 1. Environment Validation

Before deployment, run validation:

```bash
npm run validate:env
```

### 2. Production Readiness Test

Test production configuration:

```bash
npm run test:prod-ready
```

### 3. Security Requirements

For production deployment:
- All secrets must be 32+ characters
- No development/test patterns in secrets
- HTTPS URLs required
- Specific CORS origins (not *)
- Strong bcrypt salt rounds (12+)

### 4. Secrets Management

Generate new secrets:

```typescript
const secretsService = app.get(SecretsManagementService);
const newSecrets = secretsService.rotateSecrets();
```

Audit existing secrets:

```typescript
secretsService.logSecretsAudit();
```

## Feature Flags

Control functionality per environment:

```typescript
const features = envValidationService.getFeatureFlags();

if (features.swagger) {
  // Setup Swagger documentation
}

if (features.metrics) {
  // Enable metrics collection
}

if (features.compression) {
  // Enable response compression
}
```

## Configuration Hierarchy

Environment files are loaded in order of precedence:

1. `.env.${NODE_ENV}` (highest priority)
2. `.env.local`
3. `.env`
4. Default values in configuration factories

## Error Handling

The system provides comprehensive error handling:

- **Validation Errors**: Clear messages about missing/invalid variables
- **Production Checks**: Specific requirements for production deployment
- **Security Audits**: Warnings about weak secrets or configurations
- **Startup Failures**: Application won't start with invalid configuration

## Development Workflow

1. Copy `.env.example` to `.env.development`
2. Update variables for your local setup
3. Run `npm run validate:env` to check configuration
4. Start development server with `npm run start:dev`

## Staging Deployment

1. Create `.env.staging` with staging-specific values
2. Set `NODE_ENV=staging`
3. Run validation and readiness tests
4. Deploy to staging environment

## Production Deployment

1. Set production environment variables (never commit `.env.production`)
2. Set `NODE_ENV=production`
3. Run `npm run test:prod-ready`
4. Deploy with validated configuration

## Monitoring

The configuration system provides:
- Startup configuration logging
- Feature flag status reporting
- Security audit results
- Environment-specific behavior logging

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Check `.env.example` for required variables
   - Run `npm run validate:env` for detailed errors

2. **Weak Secrets in Production**
   - Generate new secrets with `SecretsManagementService.rotateSecrets()`
   - Ensure secrets are 32+ characters and don't contain dev/test patterns

3. **TypeScript Compilation Errors**
   - Ensure all dependencies are installed
   - Check for missing type definitions

4. **Configuration Not Loading**
   - Verify environment file exists and is readable
   - Check file naming (`.env.${NODE_ENV}`)
   - Ensure `EnvironmentModule` is imported first in `AppModule`

### Debug Configuration

Enable debug logging to troubleshoot:

```bash
LOG_LEVEL=debug npm run start:dev
```

This will show detailed configuration loading and validation information.