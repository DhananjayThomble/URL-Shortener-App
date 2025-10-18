# Production Readiness Guide

This guide helps ensure your NestJS URL Shortener application is ready for production deployment.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Production Readiness Tests
```bash
# Test against local development server
npm run test:prod-ready

# Test against specific environment
BASE_URL=https://your-production-url.com npm run test:prod-ready

# Test with custom API prefix
BASE_URL=https://your-app.com API_PREFIX=api/v2 npm run test:prod-ready
```

## Test Categories

### 🏥 Health Check Endpoints
- **Basic Health**: `/health` - General application health
- **Readiness**: `/health/ready` - Application ready to serve traffic
- **Liveness**: `/health/live` - Application is alive and responsive

### 🔒 Security Headers
Tests for essential security headers:
- `X-Frame-Options` - Prevents clickjacking
- `X-Content-Type-Options` - Prevents MIME sniffing
- `X-XSS-Protection` - XSS protection
- `Strict-Transport-Security` - HTTPS enforcement
- `Content-Security-Policy` - Content security

### 🌐 API Endpoints
- API base endpoint accessibility
- Authentication endpoint validation
- Proper error responses

### 🚦 Rate Limiting
- Tests rate limiting configuration
- Validates 429 responses for excessive requests

### 🔄 CORS Configuration
- Cross-Origin Resource Sharing headers
- Proper CORS policy implementation

### 📦 Response Compression
- Gzip/Brotli compression enabled
- Proper content-encoding headers

### ⚡ Performance
- Response time measurements
- Performance thresholds:
  - **Excellent**: < 100ms
  - **Good**: < 500ms
  - **Acceptable**: < 1000ms
  - **Slow**: > 1000ms

### 📚 Documentation
- Swagger/OpenAPI documentation availability
- Production vs development configuration

### 📊 Metrics and Monitoring
- Prometheus metrics endpoint
- Monitoring data format validation

### ⚙️ Environment Configuration
- Production mode validation
- Required environment variables check

## Environment Variables

### Required Variables
```bash
# Database connections
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
MONGODB_URI=mongodb://localhost:27017/urlshortener
REDIS_URL=redis://localhost:6379

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-token-secret

# Application Configuration
NODE_ENV=production
PORT=3000
API_PREFIX=api/v1
BASE_URL=https://your-domain.com
```

### Optional Variables
```bash
# CORS Configuration
CORS_ORIGIN=https://your-frontend.com,https://admin.your-domain.com
CORS_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_TTL=60000
RATE_LIMIT_MAX=100

# Caching
CACHE_TTL=3600
CACHE_MAX_ITEMS=10000

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Security
BCRYPT_SALT_ROUNDS=12
SESSION_SECRET=your-session-secret
```

## Test Results Interpretation

### Exit Codes
- **0**: All tests passed - Production ready ✅
- **1**: Minor issues - May be deployable with review ⚠️
- **2**: Major issues - Not ready for production ❌
- **3**: Test suite error - Check configuration 🔧

### Success Criteria
- All health endpoints respond within 1 second
- Security headers are properly configured
- Rate limiting is functional
- Response times are acceptable
- No critical environment variables missing

## Pre-Deployment Checklist

### Infrastructure
- [ ] Load balancer configured
- [ ] SSL certificates installed and valid
- [ ] Database connections tested
- [ ] Redis cache accessible
- [ ] Monitoring systems operational
- [ ] Log aggregation configured

### Security
- [ ] All security headers present
- [ ] Rate limiting configured
- [ ] CORS policies set correctly
- [ ] JWT secrets are secure and unique
- [ ] Database credentials secured
- [ ] API keys and secrets in environment variables

### Performance
- [ ] Response times under thresholds
- [ ] Compression enabled
- [ ] Caching strategies implemented
- [ ] Database indexes optimized
- [ ] Connection pools configured

### Monitoring
- [ ] Health check endpoints responding
- [ ] Metrics collection enabled
- [ ] Error tracking configured
- [ ] Performance monitoring active
- [ ] Alerting rules configured

### Documentation
- [ ] API documentation updated
- [ ] Deployment procedures documented
- [ ] Rollback procedures tested
- [ ] Troubleshooting guides available

## Troubleshooting

### Common Issues

#### Health Endpoints Not Responding
```bash
# Check if application is running
curl -f http://localhost:3000/health

# Check application logs
docker logs your-app-container

# Verify port binding
netstat -tlnp | grep 3000
```

#### Security Headers Missing
- Check helmet middleware configuration
- Verify middleware order in main.ts
- Review production vs development settings

#### Rate Limiting Not Working
- Verify Redis connection
- Check rate limiting configuration
- Review middleware setup

#### Poor Response Times
- Check database connection pool settings
- Verify caching configuration
- Review query performance
- Check resource utilization

#### Environment Variables Missing
```bash
# Check current environment
printenv | grep -E "(DATABASE|MONGODB|REDIS|JWT)"

# Verify .env file loading
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL)"
```

## Advanced Testing

### Custom Test Configuration
```javascript
// custom-prod-test.js
const { runProductionReadinessTests } = require('./test-production-readiness');

// Override configuration
process.env.BASE_URL = 'https://staging.yourapp.com';
process.env.API_PREFIX = 'api/v2';

runProductionReadinessTests();
```

### CI/CD Integration
```yaml
# .github/workflows/production-readiness.yml
name: Production Readiness Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  production-readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run start:prod &
      - run: sleep 10  # Wait for app to start
      - run: npm run test:prod-ready
```

### Load Testing Integration
```bash
# After production readiness tests pass, run load tests
npm run test:prod-ready && artillery run performance/load-test.yml
```

## Support

For issues with production readiness testing:

1. Check the [troubleshooting section](#troubleshooting)
2. Review application logs
3. Verify environment configuration
4. Test individual components manually
5. Consult the deployment documentation

## Related Documentation

- [Deployment Runbook](./docs/DEPLOYMENT_RUNBOOK.md)
- [Migration Guide](./docs/MIGRATION_GUIDE.md)
- [Performance Optimization](./docs/PERFORMANCE_OPTIMIZATION.md)
- [API Documentation](./docs/API_DOCUMENTATION.md)