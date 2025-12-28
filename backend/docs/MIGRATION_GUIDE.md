# Migration Guide: Express.js to NestJS URL Shortener

This guide provides step-by-step instructions for migrating from the existing Express.js URL shortener to the new NestJS implementation.

## Table of Contents

1. [Pre-Migration Checklist](#pre-migration-checklist)
2. [Data Migration](#data-migration)
3. [Environment Setup](#environment-setup)
4. [Deployment Process](#deployment-process)
5. [Post-Migration Verification](#post-migration-verification)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)

## Pre-Migration Checklist

### 1. Backup Current System

```bash
# Backup MongoDB database
mongodump --db urlshortener --out ./backups/mongodb_backup_$(date +%Y%m%d_%H%M%S)

# Backup application files
tar -czf ./backups/app_backup_$(date +%Y%m%d_%H%M%S).tar.gz /path/to/current/app

# Backup configuration files
cp .env ./backups/env_backup_$(date +%Y%m%d_%H%M%S)
```

### 2. System Requirements

- **Node.js**: Version 18 or higher
- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 2.0 or higher
- **PostgreSQL**: Version 15 or higher
- **MongoDB**: Version 6 or higher
- **Redis**: Version 7 or higher

### 3. Network and Security

- Ensure firewall rules allow traffic on required ports
- SSL certificates are ready for HTTPS
- DNS records are configured
- Load balancer configuration is updated

## Data Migration

### 1. Schema Mapping

The new NestJS application uses a hybrid database approach:

#### MongoDB (URLs and Analytics)
- **URLs Collection**: Maintains existing structure with enhancements
- **Click Analytics**: New time-series collection for detailed analytics
- **Link-in-Bio Pages**: New collection for enhanced features

#### PostgreSQL (Users and Admin)
- **Users Table**: New relational structure for user management
- **Admin Users**: Separate table for admin accounts
- **Custom Domains**: New table for domain management
- **Audit Logs**: Comprehensive audit trail

### 2. Migration Scripts

#### Step 1: Export Existing Data

```javascript
// export_existing_data.js
const { MongoClient } = require('mongodb');
const fs = require('fs');

async function exportData() {
  const client = new MongoClient('mongodb://localhost:27017');
  await client.connect();
  
  const db = client.db('urlshortener');
  
  // Export URLs
  const urls = await db.collection('urls').find({}).toArray();
  fs.writeFileSync('./migration/urls_export.json', JSON.stringify(urls, null, 2));
  
  // Export Users (if exists)
  const users = await db.collection('users').find({}).toArray();
  fs.writeFileSync('./migration/users_export.json', JSON.stringify(users, null, 2));
  
  // Export Analytics (if exists)
  const analytics = await db.collection('analytics').find({}).toArray();
  fs.writeFileSync('./migration/analytics_export.json', JSON.stringify(analytics, null, 2));
  
  await client.close();
  console.log('Data export completed');
}

exportData().catch(console.error);
```

#### Step 2: Transform and Import Data

```javascript
// migrate_data.js
const { MongoClient } = require('mongodb');
const { Client } = require('pg');
const fs = require('fs');
const bcrypt = require('bcrypt');

async function migrateData() {
  // Load exported data
  const urls = JSON.parse(fs.readFileSync('./migration/urls_export.json'));
  const users = JSON.parse(fs.readFileSync('./migration/users_export.json'));
  
  // Connect to new databases
  const mongoClient = new MongoClient('mongodb://localhost:27017');
  await mongoClient.connect();
  const mongodb = mongoClient.db('urlshortener_prod');
  
  const pgClient = new Client({
    connectionString: 'postgresql://username:password@localhost:5432/urlshortener_prod'
  });
  await pgClient.connect();
  
  // Migrate Users to PostgreSQL
  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password || 'temp_password', 12);
    
    await pgClient.query(`
      INSERT INTO users (id, email, password_hash, name, is_email_verified, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (email) DO NOTHING
    `, [
      user._id.toString(),
      user.email,
      hashedPassword,
      user.name || user.email.split('@')[0],
      user.emailVerified || false,
      user.createdAt || new Date(),
      user.updatedAt || new Date()
    ]);
  }
  
  // Migrate URLs to MongoDB (new schema)
  for (const url of urls) {
    const transformedUrl = {
      _id: url._id,
      userId: url.userId || url.createdBy,
      shortCode: url.shortCode || url.code,
      originalUrl: url.originalUrl || url.url,
      customBackHalf: url.customBackHalf,
      category: url.category,
      visitCount: url.visitCount || url.clicks || 0,
      isActive: url.isActive !== false,
      expiresAt: url.expiresAt,
      metadata: {
        title: url.title,
        description: url.description,
        favicon: url.favicon
      },
      createdAt: url.createdAt || new Date(),
      updatedAt: url.updatedAt || new Date()
    };
    
    await mongodb.collection('urls').insertOne(transformedUrl);
  }
  
  // Close connections
  await mongoClient.close();
  await pgClient.end();
  
  console.log('Data migration completed');
}

migrateData().catch(console.error);
```

### 3. Data Validation

```javascript
// validate_migration.js
async function validateMigration() {
  // Connect to both old and new databases
  // Compare record counts
  // Validate data integrity
  // Check for missing records
  
  console.log('Migration validation completed');
}
```

## Environment Setup

### 1. Production Environment Variables

Create `.env.production` file:

```bash
# Copy from template
cp .env.production.example .env.production

# Edit with production values
nano .env.production
```

### 2. SSL Certificates

```bash
# Generate SSL certificates (if using Let's Encrypt)
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Copy certificates to nginx directory
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem ./nginx/ssl/cert.pem
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem ./nginx/ssl/key.pem
```

### 3. Database Setup

```bash
# Initialize PostgreSQL
docker-compose -f docker-compose.prod.yml up -d postgres
docker-compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "CREATE DATABASE urlshortener_prod;"

# Initialize MongoDB
docker-compose -f docker-compose.prod.yml up -d mongodb

# Initialize Redis
docker-compose -f docker-compose.prod.yml up -d redis
```

## Deployment Process

### 1. Blue-Green Deployment

#### Step 1: Prepare Green Environment

```bash
# Build new application
docker build -t nestjs-url-shortener:green .

# Start green environment
docker-compose -f docker-compose.green.yml up -d

# Run health checks
curl -f http://green-environment:3000/health/simple
```

#### Step 2: Migrate Data

```bash
# Run migration scripts
node migrate_data.js

# Validate migration
node validate_migration.js
```

#### Step 3: Switch Traffic

```bash
# Update load balancer configuration
# Switch DNS records
# Update nginx upstream configuration

# Reload nginx
docker-compose exec nginx nginx -s reload
```

#### Step 4: Verify and Cleanup

```bash
# Monitor application metrics
# Verify functionality
# Stop blue environment after verification
```

### 2. Rolling Deployment

```bash
# Use deployment script
./scripts/deploy.sh deploy

# Or PowerShell on Windows
.\scripts\deploy.ps1 -Action deploy
```

### 3. Zero-Downtime Deployment

```bash
# Start new containers
docker-compose -f docker-compose.prod.yml up -d --no-deps app-new

# Health check new containers
curl -f http://localhost:3001/health/simple

# Update load balancer
# Remove old containers
docker-compose -f docker-compose.prod.yml stop app-old
```

## Post-Migration Verification

### 1. Functional Testing

```bash
# Test URL creation
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{"originalUrl": "https://example.com"}'

# Test URL redirection
curl -I http://localhost:3000/abc123

# Test analytics
curl http://localhost:3000/api/v1/urls/abc123/analytics \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 2. Performance Testing

```bash
# Load testing with Artillery
artillery run performance-test.yml

# Or with Apache Bench
ab -n 1000 -c 10 http://localhost:3000/health/simple
```

### 3. Monitoring Verification

```bash
# Check health endpoints
curl http://localhost:3000/health
curl http://localhost:3000/metrics

# Verify logging
tail -f logs/combined.log

# Check database connections
docker-compose exec postgres pg_isready
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"
docker-compose exec redis redis-cli ping
```

## Rollback Procedures

### 1. Automatic Rollback

```bash
# Use deployment script
./scripts/deploy.sh rollback
```

### 2. Manual Rollback

```bash
# Stop new application
docker-compose -f docker-compose.prod.yml stop app

# Restore database backup
mongorestore --db urlshortener --archive < backups/mongodb_backup.archive
psql -U postgres -d urlshortener_prod < backups/postgres_backup.sql

# Start previous version
docker-compose -f docker-compose.blue.yml up -d

# Update load balancer
# Verify functionality
```

### 3. Emergency Rollback

```bash
# Immediate traffic switch
# Update DNS records to point to old system
# Restore from last known good backup
# Investigate and fix issues
```

## Troubleshooting

### Common Issues

#### 1. Database Connection Issues

```bash
# Check database status
docker-compose ps

# Check logs
docker-compose logs postgres
docker-compose logs mongodb
docker-compose logs redis

# Test connections
docker-compose exec app npm run typeorm:check
```

#### 2. Migration Data Issues

```bash
# Validate data integrity
node validate_migration.js

# Check for missing records
# Compare record counts between old and new systems
# Verify data transformation
```

#### 3. Performance Issues

```bash
# Check resource usage
docker stats

# Monitor application metrics
curl http://localhost:3000/metrics

# Check database performance
# Analyze slow queries
# Verify indexing
```

#### 4. SSL/TLS Issues

```bash
# Check certificate validity
openssl x509 -in nginx/ssl/cert.pem -text -noout

# Test SSL configuration
curl -I https://yourdomain.com/health/simple

# Check nginx configuration
docker-compose exec nginx nginx -t
```

### Monitoring and Alerting

#### 1. Set up monitoring dashboards
- Application metrics (Prometheus/Grafana)
- Database performance
- System resources
- Error rates

#### 2. Configure alerts
- High error rates
- Database connection issues
- High response times
- System resource exhaustion

### Support Contacts

- **Development Team**: dev-team@company.com
- **DevOps Team**: devops@company.com
- **On-call Engineer**: +1-xxx-xxx-xxxx

### Additional Resources

- [API Documentation](./API_DOCUMENTATION.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Monitoring Guide](./MONITORING_GUIDE.md)
- [Security Guide](./SECURITY_GUIDE.md)