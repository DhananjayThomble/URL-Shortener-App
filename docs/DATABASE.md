# SnapURL 2.0 - Database Architecture

> **Hybrid Database Strategy**: PostgreSQL for users, MongoDB for URLs, Redis for caching

## Overview

SnapURL uses a multi-database architecture, leveraging the strengths of each database system:

- **PostgreSQL 15**: Relational data (users, auth, roles)
- **MongoDB 6**: Document data (URLs, analytics)
- **Redis 7**: Cache and session management

## PostgreSQL Architecture

### Purpose
User management, authentication, and relational data requiring ACID compliance.

### Schema

#### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  role VARCHAR(50) DEFAULT 'user' NOT NULL,
  email_verified BOOLEAN DEFAULT false,
  verification_token VARCHAR(255),
  reset_token VARCHAR(255),
  reset_token_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
```

#### Refresh Tokens Table
```sql
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

### Migrations

**Location**: `backend/src/migrations/`

**Commands**:
```bash
# Create migration
npm run migration:create -- src/migrations/MigrationName

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert

# Show migrations status
npm run migration:show
```

**Migration Example**:
```typescript
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateUsersTable1234567890 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()'
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isUnique: true,
            isNullable: false
          },
          // ... more columns
        ]
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
```

### Connection Configuration

**TypeORM Configuration** (`backend/ormconfig.ts`):
```typescript
export default {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['dist/**/*.entity{.ts,.js}'],
  migrations: ['dist/migrations/*{.ts,.js}'],
  synchronize: false,  // Use migrations in production
  logging: process.env.NODE_ENV === 'development',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  extra: {
    max: 20,  // Connection pool size
    min: 5,
    idleTimeoutMillis: 30000
  }
};
```

## MongoDB Architecture

### Purpose
URL storage, analytics, and high-write-volume data.

### Collections

#### URLs Collection
```javascript
{
  _id: ObjectId("..."),
  shortCode: String,       // Indexed, unique
  originalUrl: String,
  userId: String,          // Indexed
  customAlias: String,     // Optional, indexed
  title: String,           // Page title
  description: String,     // Page description
  favicon: String,         // Page favicon URL
  clicks: Number,          // Total clicks
  isActive: Boolean,
  createdAt: Date,         // Indexed
  updatedAt: Date,
  expiresAt: Date,         // Optional, indexed for TTL
  tags: [String],
  category: String
}
```

**Indexes**:
```javascript
db.urls.createIndex({ shortCode: 1 }, { unique: true });
db.urls.createIndex({ userId: 1 });
db.urls.createIndex({ createdAt: -1 });
db.urls.createIndex({ customAlias: 1 }, { unique: true, sparse: true });
db.urls.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

#### Analytics Collection
```javascript
{
  _id: ObjectId("..."),
  shortCode: String,       // Indexed
  clickedAt: Date,         // Indexed
  referrer: String,
  userAgent: String,
  device: {
    type: String,          // mobile, desktop, tablet
    brand: String,
    model: String
  },
  browser: {
    name: String,
    version: String
  },
  os: {
    name: String,
    version: String
  },
  location: {
    ip: String,            // Hashed for privacy
    country: String,
    city: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  }
}
```

**Indexes**:
```javascript
db.analytics.createIndex({ shortCode: 1, clickedAt: -1 });
db.analytics.createIndex({ clickedAt: -1 });
db.analytics.createIndex({ shortCode: 1 });
```

### Mongoose Configuration

**Connection** (`backend/src/config/mongodb.config.ts`):
```typescript
import { MongooseModule } from '@nestjs/mongoose';

MongooseModule.forRootAsync({
  useFactory: () => ({
    uri: process.env.MONGODB_URI,
    useNewUrlParser: true,
    useUnifiedTopology: true,
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 45000,
    serverSelectionTimeoutMS: 5000,
    retryWrites: true,
    retryReads: true,
    w: 'majority'
  })
});
```

**Schema Example**:
```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class Url extends Document {
  @Prop({ required: true, unique: true, index: true })
  shortCode: string;

  @Prop({ required: true })
  originalUrl: string;

  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ default: 0 })
  clicks: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const UrlSchema = SchemaFactory.createForClass(Url);
```

## Redis Architecture

### Purpose
High-speed caching, session management, rate limiting.

### Key Patterns

#### URL Cache
```
Pattern: url:{shortCode}
Value: JSON serialized URL data
TTL: 1 hour (3600 seconds)

Example:
url:abc123 -> {
  "originalUrl": "https://example.com",
  "userId": "user-uuid",
  "clicks": 42
}
```

#### Session Cache
```
Pattern: session:{sessionId}
Value: JSON serialized session data
TTL: 7 days (604800 seconds)

Example:
session:sess_xyz789 -> {
  "userId": "user-uuid",
  "role": "user",
  "lastActive": 1640995200
}
```

#### Rate Limiting
```
Pattern: ratelimit:{identifier}:{endpoint}
Value: Request count
TTL: 60 seconds

Example:
ratelimit:192.168.1.1:POST:/api/v1/urls -> 5
```

#### Analytics Cache
```
Pattern: analytics:{shortCode}:{period}
Value: JSON serialized analytics summary
TTL: 5 minutes (300 seconds)

Example:
analytics:abc123:7d -> {
  "totalClicks": 156,
  "uniqueVisitors": 89,
  "topReferrers": [...]
}
```

### Configuration

**Connection** (`backend/src/config/redis.config.ts`):
```typescript
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

CacheModule.register({
  store: redisStore,
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  ttl: 3600,
  max: 1000
});
```

**Usage Example**:
```typescript
import { Injectable, Inject, CACHE_MANAGER } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class UrlsService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async findByShortCode(shortCode: string) {
    // Try cache first
    const cached = await this.cacheManager.get(`url:${shortCode}`);
    if (cached) return cached;

    // Query MongoDB
    const url = await this.urlModel.findOne({ shortCode });
    
    // Cache for 1 hour
    await this.cacheManager.set(`url:${shortCode}`, url, 3600);
    
    return url;
  }
}
```

## Data Flow

### URL Creation Flow
```
1. API Request → Controller
2. Validate DTO
3. Generate short code
4. Save to MongoDB (urls collection)
5. Cache in Redis (url:{shortCode})
6. Return response
```

### URL Redirect Flow
```
1. Request /:shortCode
2. Check Redis cache
   ├─ HIT: Return cached URL
   └─ MISS: Query MongoDB
3. Update Redis cache
4. Async: Record analytics (MongoDB)
5. Redirect to original URL
```

### Analytics Aggregation Flow
```
1. Request /analytics
2. Check Redis cache
   ├─ HIT: Return cached data
   └─ MISS: Aggregate from MongoDB
3. Cache results in Redis (5 min TTL)
4. Return analytics data
```

## Backup & Recovery

### PostgreSQL Backup

**Automated Backups** (AWS RDS):
```
- Frequency: Daily
- Retention: 7 days
- Backup window: 3:00 AM - 4:00 AM UTC
- Point-in-time recovery: Enabled
```

**Manual Backup**:
```bash
# Backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup_20231215.sql
```

### MongoDB Backup

**MongoDB Atlas** (Automated):
```
- Continuous backups
- Snapshot frequency: Every 12 hours
- Retention: 7 days
- Point-in-time recovery: Within 24 hours
```

**Manual Backup**:
```bash
# Backup
mongodump --uri="$MONGODB_URI" --out=./backup_$(date +%Y%m%d)

# Restore
mongorestore --uri="$MONGODB_URI" ./backup_20231215
```

### Redis Backup

**Persistence**:
```redis
# redis.conf
save 900 1       # Save if 1 key changed in 15 min
save 300 10      # Save if 10 keys changed in 5 min
save 60 10000    # Save if 10000 keys changed in 1 min

# AOF (Append Only File)
appendonly yes
appendfsync everysec
```

**Manual Backup**:
```bash
# Trigger save
redis-cli BGSAVE

# Copy RDB file
cp /var/lib/redis/dump.rdb ./backup_$(date +%Y%m%d).rdb
```

## Performance Optimization

### Query Optimization

**PostgreSQL**:
```sql
-- Use EXPLAIN to analyze queries
EXPLAIN ANALYZE 
SELECT * FROM users WHERE email = 'user@example.com';

-- Add indexes for frequently queried columns
CREATE INDEX idx_users_email ON users(email);
```

**MongoDB**:
```javascript
// Analyze query performance
db.urls.find({ shortCode: "abc123" }).explain("executionStats");

// Create compound index for common queries
db.urls.createIndex({ userId: 1, createdAt: -1 });
```

### Connection Pooling

**PostgreSQL**:
- Pool size: 10-20 connections
- Idle timeout: 30 seconds
- Connection timeout: 5 seconds

**MongoDB**:
- Max pool size: 10 connections
- Min pool size: 2 connections
- Socket timeout: 45 seconds

**Redis**:
- Connection pooling via ioredis
- Reconnect on failure

### Caching Strategy

**L1 Cache (Redis)**: Hot URLs, sessions
**L2 Cache (Application)**: Configuration, static data
**Cache Invalidation**: TTL + event-based

## Monitoring

### Database Health Checks

**Backend Health Endpoint** (`/health`):
```typescript
@Get('health')
async healthCheck() {
  return {
    status: 'ok',
    timestamp: new Date(),
    services: {
      postgres: await this.checkPostgres(),
      mongodb: await this.checkMongoDB(),
      redis: await this.checkRedis()
    }
  };
}
```

### Performance Metrics

**Monitor**:
- Connection pool usage
- Query execution time
- Cache hit/miss ratio
- Disk space usage
- Replication lag (production)

**Tools**:
- PostgreSQL: pg_stat_statements
- MongoDB: MongoDB Atlas monitoring
- Redis: redis-cli INFO
- Application: Winston + CloudWatch

## Troubleshooting

Common database issues and solutions: See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#database-issues)

## Cross-References

- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Development**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
