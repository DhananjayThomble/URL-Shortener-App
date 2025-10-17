# Deployment Runbook

This runbook provides detailed procedures for deploying the NestJS URL Shortener application to production environments.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [Deployment Procedures](#deployment-procedures)
3. [Post-Deployment Verification](#post-deployment-verification)
4. [Rollback Procedures](#rollback-procedures)
5. [Emergency Procedures](#emergency-procedures)
6. [Monitoring and Alerting](#monitoring-and-alerting)

## Pre-Deployment Checklist

### Environment Verification

- [ ] Production environment variables are configured
- [ ] SSL certificates are valid and up-to-date
- [ ] Database connections are tested
- [ ] Redis cache is accessible
- [ ] Load balancer configuration is correct
- [ ] DNS records are properly configured
- [ ] Backup systems are operational

### Code Quality Checks

- [ ] All tests pass (unit, integration, e2e)
- [ ] Code coverage meets minimum threshold (80%)
- [ ] Security scan passes
- [ ] Performance benchmarks are acceptable
- [ ] Documentation is updated
- [ ] Change log is updated

### Infrastructure Readiness

- [ ] Server resources are adequate
- [ ] Monitoring systems are operational
- [ ] Alerting rules are configured
- [ ] Log aggregation is working
- [ ] Backup procedures are tested

## Deployment Procedures

### Standard Deployment (Blue-Green)

#### Phase 1: Preparation

1. **Create Deployment Branch**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b deployment/$(date +%Y%m%d_%H%M%S)
   ```

2. **Build and Test**
   ```bash
   npm ci
   npm run build
   npm run test
   npm run test:e2e
   ```

3. **Create Backup**
   ```bash
   ./scripts/deploy.sh backup
   ```

#### Phase 2: Green Environment Setup

1. **Deploy to Green Environment**
   ```bash
   # Build new Docker image
   docker build -t nestjs-url-shortener:green .
   
   # Start green environment
   docker-compose -f docker-compose.green.yml up -d
   ```

2. **Database Migration**
   ```bash
   # Run migrations on green environment
   docker-compose -f docker-compose.green.yml exec app npm run migration:run
   ```

3. **Health Check**
   ```bash
   # Wait for application to be ready
   sleep 30
   
   # Perform health checks
   curl -f http://green-env:3000/health/simple
   curl -f http://green-env:3000/health/ready
   ```

#### Phase 3: Traffic Switch

1. **Update Load Balancer**
   ```bash
   # Update nginx configuration
   cp nginx/nginx.green.conf nginx/nginx.conf
   docker-compose exec nginx nginx -s reload
   ```

2. **Monitor Metrics**
   ```bash
   # Monitor error rates and response times
   curl http://green-env:3000/metrics
   ```

3. **Gradual Traffic Shift**
   ```bash
   # Shift 10% traffic to green
   # Monitor for 5 minutes
   # Shift 50% traffic to green
   # Monitor for 5 minutes
   # Shift 100% traffic to green
   ```

#### Phase 4: Verification and Cleanup

1. **Smoke Tests**
   ```bash
   # Test critical functionality
   ./scripts/smoke-tests.sh
   ```

2. **Performance Verification**
   ```bash
   # Run performance tests
   artillery run performance-test.yml
   ```

3. **Blue Environment Cleanup**
   ```bash
   # Stop blue environment after 30 minutes
   docker-compose -f docker-compose.blue.yml down
   ```

### Rolling Deployment

#### Automated Rolling Deployment

```bash
# Use deployment script
./scripts/deploy.sh deploy

# Monitor deployment progress
tail -f logs/deploy.log
```

#### Manual Rolling Deployment

1. **Update Application Containers**
   ```bash
   # Update containers one by one
   docker-compose -f docker-compose.prod.yml up -d --no-deps app-1
   sleep 30
   docker-compose -f docker-compose.prod.yml up -d --no-deps app-2
   sleep 30
   docker-compose -f docker-compose.prod.yml up -d --no-deps app-3
   ```

2. **Health Check Each Instance**
   ```bash
   curl -f http://app-1:3000/health/simple
   curl -f http://app-2:3000/health/simple
   curl -f http://app-3:3000/health/simple
   ```

### Canary Deployment

1. **Deploy Canary Instance**
   ```bash
   docker-compose -f docker-compose.canary.yml up -d
   ```

2. **Route Small Percentage of Traffic**
   ```bash
   # Configure load balancer to send 5% traffic to canary
   # Monitor metrics for 15 minutes
   ```

3. **Gradual Rollout**
   ```bash
   # Increase traffic to 10%, 25%, 50%, 100%
   # Monitor at each stage
   ```

## Post-Deployment Verification

### Automated Verification

```bash
# Run comprehensive verification script
./scripts/post-deployment-verification.sh
```

### Manual Verification Steps

#### 1. Health Checks

```bash
# Application health
curl -f https://yourdomain.com/health
curl -f https://yourdomain.com/health/ready
curl -f https://yourdomain.com/health/live

# Database health
curl -f https://yourdomain.com/health | jq '.services.database'

# Cache health
curl -f https://yourdomain.com/health | jq '.services.cache'
```

#### 2. Functional Testing

```bash
# Test URL creation
curl -X POST https://yourdomain.com/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -d '{"originalUrl": "https://example.com"}'

# Test URL redirection
curl -I https://yourdomain.com/test123

# Test admin functionality
curl https://yourdomain.com/admin/dashboard \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### 3. Performance Verification

```bash
# Response time check
curl -w "@curl-format.txt" -o /dev/null -s https://yourdomain.com/health/simple

# Load test
ab -n 100 -c 10 https://yourdomain.com/health/simple
```

#### 4. Security Verification

```bash
# SSL certificate check
curl -I https://yourdomain.com/

# Security headers check
curl -I https://yourdomain.com/ | grep -E "(X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security)"

# Rate limiting check
for i in {1..20}; do curl https://yourdomain.com/api/v1/urls; done
```

### Monitoring Dashboard Verification

1. **Application Metrics**
   - Response times < 200ms for 95th percentile
   - Error rate < 0.1%
   - Throughput matches expected load

2. **Infrastructure Metrics**
   - CPU usage < 70%
   - Memory usage < 80%
   - Disk usage < 85%

3. **Database Metrics**
   - Connection pool utilization < 80%
   - Query response times < 100ms
   - No connection errors

## Rollback Procedures

### Automated Rollback

```bash
# Use deployment script
./scripts/deploy.sh rollback

# Verify rollback success
curl -f https://yourdomain.com/health/simple
```

### Manual Rollback

#### 1. Immediate Rollback (Traffic Switch)

```bash
# Switch load balancer back to blue environment
cp nginx/nginx.blue.conf nginx/nginx.conf
docker-compose exec nginx nginx -s reload

# Verify traffic is routed to stable version
curl -I https://yourdomain.com/
```

#### 2. Database Rollback

```bash
# Stop current application
docker-compose -f docker-compose.prod.yml stop app

# Restore database from backup
BACKUP_NAME=$(cat backups/latest_backup.txt)
mongorestore --db urlshortener_prod --archive < backups/mongodb_$BACKUP_NAME.archive
psql -U postgres -d urlshortener_prod < backups/postgres_$BACKUP_NAME.sql

# Start previous version
docker-compose -f docker-compose.blue.yml up -d
```

#### 3. Full System Rollback

```bash
# Restore entire system from backup
./scripts/restore-system.sh $BACKUP_NAME

# Verify system functionality
./scripts/smoke-tests.sh
```

### Rollback Verification

```bash
# Verify application is running previous version
curl https://yourdomain.com/info | jq '.version'

# Run smoke tests
./scripts/smoke-tests.sh

# Check error rates
curl https://yourdomain.com/metrics | grep error_rate
```

## Emergency Procedures

### Critical System Failure

1. **Immediate Response**
   ```bash
   # Switch to maintenance mode
   cp nginx/maintenance.conf nginx/nginx.conf
   docker-compose exec nginx nginx -s reload
   
   # Alert on-call team
   ./scripts/alert-oncall.sh "CRITICAL: System failure detected"
   ```

2. **Diagnosis**
   ```bash
   # Check system status
   docker-compose ps
   
   # Check logs
   docker-compose logs --tail=100
   
   # Check resource usage
   docker stats
   ```

3. **Recovery Actions**
   ```bash
   # Restart failed services
   docker-compose restart app
   
   # Or full system restart
   docker-compose down && docker-compose up -d
   
   # Or rollback to last known good state
   ./scripts/deploy.sh rollback
   ```

### Database Corruption

1. **Immediate Actions**
   ```bash
   # Stop application to prevent further corruption
   docker-compose stop app
   
   # Create emergency backup
   ./scripts/emergency-backup.sh
   ```

2. **Recovery**
   ```bash
   # Restore from latest clean backup
   ./scripts/restore-database.sh $CLEAN_BACKUP_NAME
   
   # Verify data integrity
   ./scripts/verify-database.sh
   ```

### Security Incident

1. **Immediate Response**
   ```bash
   # Block suspicious traffic
   ./scripts/block-ip.sh $SUSPICIOUS_IP
   
   # Enable enhanced logging
   ./scripts/enable-debug-logging.sh
   
   # Alert security team
   ./scripts/alert-security.sh "Security incident detected"
   ```

2. **Investigation**
   ```bash
   # Analyze logs
   grep $SUSPICIOUS_IP logs/access.log
   
   # Check for unauthorized access
   grep "401\|403" logs/combined.log
   ```

## Monitoring and Alerting

### Key Metrics to Monitor

#### Application Metrics
- Response time (95th percentile < 200ms)
- Error rate (< 0.1%)
- Throughput (requests per second)
- Active connections

#### Infrastructure Metrics
- CPU usage (< 70%)
- Memory usage (< 80%)
- Disk usage (< 85%)
- Network I/O

#### Database Metrics
- Connection count
- Query response time
- Lock waits
- Replication lag

### Alert Thresholds

#### Critical Alerts (Immediate Response)
- Application down (health check fails)
- Error rate > 1%
- Response time > 1000ms
- Database connection failures

#### Warning Alerts (Monitor Closely)
- Error rate > 0.5%
- Response time > 500ms
- CPU usage > 80%
- Memory usage > 85%

### Alert Escalation

1. **Level 1**: Development team (5 minutes)
2. **Level 2**: DevOps team (15 minutes)
3. **Level 3**: Engineering manager (30 minutes)
4. **Level 4**: CTO (60 minutes)

### Contact Information

- **On-call Engineer**: +1-xxx-xxx-xxxx
- **DevOps Team**: devops@company.com
- **Security Team**: security@company.com
- **Engineering Manager**: manager@company.com

### Useful Commands

```bash
# Quick health check
curl -f https://yourdomain.com/health/simple

# Check application logs
docker-compose logs -f app

# Check system resources
docker stats

# Restart application
docker-compose restart app

# Emergency rollback
./scripts/deploy.sh rollback

# Create emergency backup
./scripts/emergency-backup.sh
```