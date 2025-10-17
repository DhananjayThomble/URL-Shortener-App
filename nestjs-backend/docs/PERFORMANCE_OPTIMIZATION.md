# Performance Optimization Guide

This guide provides comprehensive strategies for optimizing the performance of the NestJS URL Shortener application.

## Table of Contents

1. [Performance Monitoring](#performance-monitoring)
2. [Database Optimization](#database-optimization)
3. [Caching Strategies](#caching-strategies)
4. [Application Optimization](#application-optimization)
5. [Infrastructure Optimization](#infrastructure-optimization)
6. [Security Performance](#security-performance)
7. [Monitoring and Alerting](#monitoring-and-alerting)

## Performance Monitoring

### Key Performance Indicators (KPIs)

#### Response Time Targets
- **Health checks**: < 50ms
- **URL redirection**: < 100ms
- **API endpoints**: < 200ms (95th percentile)
- **Admin dashboard**: < 500ms

#### Throughput Targets
- **URL redirections**: 10,000+ requests/second
- **API operations**: 1,000+ requests/second
- **Concurrent users**: 5,000+

#### Resource Utilization Targets
- **CPU usage**: < 70% average
- **Memory usage**: < 80% average
- **Database connections**: < 80% of pool size

### Performance Testing

#### Load Testing with Artillery

```bash
# Run comprehensive load test
npm install -g artillery
artillery run performance/artillery-config.yml

# Generate HTML report
artillery report results.json --output report.html
```

#### Stress Testing with Apache Bench

```bash
# Basic stress test
ab -n 10000 -c 100 http://localhost:3000/health/simple

# URL redirection test
ab -n 5000 -c 50 http://localhost:3000/test123

# API endpoint test
ab -n 1000 -c 20 -H "Authorization: Bearer token" http://localhost:3000/api/v1/urls
```

#### Custom Performance Scripts

```bash
# Run comprehensive performance test suite
./scripts/performance-test.sh

# Monitor real-time performance
./scripts/monitor-performance.sh
```

## Database Optimization

### PostgreSQL Optimization

#### Connection Pool Configuration

```typescript
// database.config.ts
export const databaseConfig = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  
  // Connection pool optimization
  extra: {
    connectionLimit: 20,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    
    // Connection pool settings
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
    
    // Performance settings
    statement_timeout: 30000,
    query_timeout: 30000,
    connectionTimeoutMillis: 5000,
  },
  
  // Enable query logging in development
  logging: process.env.NODE_ENV === 'development' ? 'all' : ['error'],
  
  // Connection pooling
  poolSize: 20,
  connectionTimeout: 60000,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
};
```

#### Index Optimization

```sql
-- Essential indexes for performance
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_users_created_at ON users(created_at);
CREATE INDEX CONCURRENTLY idx_admin_users_email ON admin_users(email);
CREATE INDEX CONCURRENTLY idx_custom_domains_domain ON custom_domains(domain);
CREATE INDEX CONCURRENTLY idx_custom_domains_user_id ON custom_domains(user_id);
CREATE INDEX CONCURRENTLY idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX CONCURRENTLY idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX CONCURRENTLY idx_audit_logs_user_id_created_at ON audit_logs(user_id, created_at);
CREATE INDEX CONCURRENTLY idx_audit_logs_action_created_at ON audit_logs(action, created_at);

-- Composite indexes for common queries
CREATE INDEX CONCURRENTLY idx_users_email_verified ON users(email, is_email_verified);
CREATE INDEX CONCURRENTLY idx_audit_logs_resource_created_at ON audit_logs(resource, created_at);
```

#### Query Optimization

```typescript
// Optimized user queries
@Injectable()
export class OptimizedUsersService {
  // Use select to limit returned fields
  async findUserProfile(id: string): Promise<UserProfile> {
    return this.userRepository.findOne({
      where: { id },
      select: ['id', 'email', 'name', 'isEmailVerified', 'createdAt'],
    });
  }
  
  // Use pagination for large datasets
  async findUsers(page: number, limit: number): Promise<PaginatedUsers> {
    const [users, total] = await this.userRepository.findAndCount({
      select: ['id', 'email', 'name', 'isEmailVerified', 'createdAt'],
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    
    return { users, total, page, limit };
  }
  
  // Use raw queries for complex operations
  async getUserStatistics(): Promise<UserStats> {
    const result = await this.userRepository.query(`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE is_email_verified = true) as verified_users,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_users
      FROM users
    `);
    
    return result[0];
  }
}
```

### MongoDB Optimization

#### Connection Configuration

```typescript
// mongodb.config.ts
export const mongoConfig = {
  uri: process.env.MONGODB_URI,
  options: {
    // Connection pool settings
    maxPoolSize: 20,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    
    // Performance settings
    bufferMaxEntries: 0,
    bufferCommands: false,
    
    // Compression
    compressors: ['zlib'],
    zlibCompressionLevel: 6,
    
    // Read preferences
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
    
    // Write concerns
    writeConcern: {
      w: 'majority',
      j: true,
      wtimeout: 5000,
    },
  },
};
```

#### Index Strategy

```javascript
// MongoDB indexes for optimal performance
db.urls.createIndex({ "shortCode": 1 }, { unique: true });
db.urls.createIndex({ "userId": 1, "createdAt": -1 });
db.urls.createIndex({ "isActive": 1, "expiresAt": 1 });
db.urls.createIndex({ "category": 1, "createdAt": -1 });
db.urls.createIndex({ "visitCount": -1 }); // For popular URLs

// Click analytics indexes
db.clickanalytics.createIndex({ "urlId": 1, "timestamp": -1 });
db.clickanalytics.createIndex({ "userId": 1, "timestamp": -1 });
db.clickanalytics.createIndex({ "timestamp": -1 }); // For time-based queries
db.clickanalytics.createIndex({ "country": 1, "timestamp": -1 });
db.clickanalytics.createIndex({ "device": 1, "timestamp": -1 });

// Compound indexes for analytics
db.clickanalytics.createIndex({ "urlId": 1, "timestamp": -1, "country": 1 });
db.clickanalytics.createIndex({ "userId": 1, "timestamp": -1, "device": 1 });

// TTL index for automatic cleanup
db.clickanalytics.createIndex({ "timestamp": 1 }, { expireAfterSeconds: 7776000 }); // 90 days
```

#### Aggregation Pipeline Optimization

```typescript
// Optimized analytics queries
@Injectable()
export class OptimizedAnalyticsService {
  async getUrlAnalytics(urlId: string, period: string): Promise<UrlAnalytics> {
    const startDate = this.getStartDateForPeriod(period);
    
    // Use efficient aggregation pipeline
    const pipeline = [
      {
        $match: {
          urlId: new ObjectId(urlId),
          timestamp: { $gte: startDate },
        },
      },
      {
        $facet: {
          // Daily clicks
          dailyClicks: [
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
                },
                clicks: { $sum: 1 },
                uniqueClicks: { $addToSet: '$ipAddress' },
              },
            },
            {
              $project: {
                date: '$_id',
                clicks: 1,
                uniqueClicks: { $size: '$uniqueClicks' },
              },
            },
            { $sort: { date: 1 } },
          ],
          
          // Geographic distribution
          geoDistribution: [
            {
              $group: {
                _id: '$country',
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          
          // Device distribution
          deviceDistribution: [
            {
              $group: {
                _id: '$device',
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
          ],
        },
      },
    ];
    
    const [result] = await this.clickAnalyticsModel.aggregate(pipeline);
    return result;
  }
}
```

## Caching Strategies

### Redis Configuration Optimization

```typescript
// redis.config.ts
export const redisConfig = {
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD,
  
  // Connection pool
  family: 4,
  keepAlive: true,
  
  // Performance settings
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxLoadingTimeout: 5000,
  
  // Memory optimization
  compression: 'gzip',
  
  // Connection pool settings
  pool: {
    min: 2,
    max: 20,
  },
};
```

### Multi-Level Caching Strategy

```typescript
@Injectable()
export class OptimizedCacheService {
  // L1 Cache: In-memory (fastest)
  private memoryCache = new Map<string, { value: any; expires: number }>();
  
  // L2 Cache: Redis (fast, shared)
  constructor(private redisClient: Redis) {}
  
  async get<T>(key: string): Promise<T | null> {
    // Check L1 cache first
    const memoryResult = this.getFromMemory<T>(key);
    if (memoryResult !== null) {
      return memoryResult;
    }
    
    // Check L2 cache (Redis)
    const redisResult = await this.getFromRedis<T>(key);
    if (redisResult !== null) {
      // Store in L1 cache for faster future access
      this.setInMemory(key, redisResult, 60); // 1 minute L1 TTL
      return redisResult;
    }
    
    return null;
  }
  
  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    // Set in both caches
    await Promise.all([
      this.setInMemory(key, value, Math.min(ttl, 300)), // Max 5 minutes in memory
      this.setInRedis(key, value, ttl),
    ]);
  }
  
  // Cache warming for popular URLs
  async warmPopularUrls(): Promise<void> {
    const popularUrls = await this.getPopularUrls(100);
    
    const warmingPromises = popularUrls.map(url => 
      this.set(`url:${url.shortCode}`, url.originalUrl, 3600)
    );
    
    await Promise.all(warmingPromises);
  }
}
```

### Cache Invalidation Strategies

```typescript
@Injectable()
export class CacheInvalidationService {
  // Tag-based invalidation
  async invalidateByTags(tags: string[]): Promise<void> {
    const keys = await this.getKeysByTags(tags);
    await this.deleteKeys(keys);
  }
  
  // Time-based invalidation
  async invalidateExpired(): Promise<void> {
    const expiredKeys = await this.getExpiredKeys();
    await this.deleteKeys(expiredKeys);
  }
  
  // Event-driven invalidation
  @OnEvent('url.updated')
  async handleUrlUpdated(event: UrlUpdatedEvent): Promise<void> {
    await this.invalidateByTags([
      `url:${event.shortCode}`,
      `user:${event.userId}:urls`,
      'popular:urls',
    ]);
  }
}
```

## Application Optimization

### NestJS Performance Optimizations

#### Lazy Loading Modules

```typescript
// app.module.ts
@Module({
  imports: [
    // Core modules (always loaded)
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CommonModule,
    
    // Feature modules (lazy loaded)
    AuthModule,
    UsersModule,
    UrlsModule,
    
    // Admin module (lazy loaded, only when needed)
    ...(process.env.ENABLE_ADMIN === 'true' ? [AdminModule] : []),
  ],
})
export class AppModule {}
```

#### Request/Response Optimization

```typescript
// Compression middleware
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression
  threshold: 1024, // Only compress responses > 1KB
}));

// Response caching
@Controller('urls')
export class UrlsController {
  @Get(':shortCode')
  @Header('Cache-Control', 'public, max-age=3600') // 1 hour cache
  async redirect(@Param('shortCode') shortCode: string) {
    const url = await this.urlsService.findByShortCode(shortCode);
    return { redirect: url };
  }
}
```

#### Database Query Optimization

```typescript
// Batch operations
@Injectable()
export class OptimizedUrlsService {
  // Batch URL creation
  async createUrls(urls: CreateUrlDto[]): Promise<Url[]> {
    // Use database transactions for consistency
    return this.dataSource.transaction(async manager => {
      const urlEntities = urls.map(dto => manager.create(Url, dto));
      return manager.save(urlEntities);
    });
  }
  
  // Efficient pagination with cursor-based approach
  async findUrlsPaginated(cursor?: string, limit = 20): Promise<PaginatedUrls> {
    const query = this.urlRepository.createQueryBuilder('url')
      .orderBy('url.createdAt', 'DESC')
      .limit(limit);
    
    if (cursor) {
      query.where('url.createdAt < :cursor', { cursor });
    }
    
    const urls = await query.getMany();
    const nextCursor = urls.length === limit ? urls[urls.length - 1].createdAt : null;
    
    return { urls, nextCursor };
  }
}
```

### Memory Management

```typescript
// Memory leak prevention
@Injectable()
export class MemoryOptimizedService {
  private readonly cache = new Map<string, any>();
  private readonly maxCacheSize = 10000;
  
  set(key: string, value: any): void {
    // Prevent memory leaks with size limits
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }
  
  // Periodic cleanup
  @Cron('0 */10 * * * *') // Every 10 minutes
  cleanupMemory(): void {
    // Force garbage collection in development
    if (process.env.NODE_ENV === 'development' && global.gc) {
      global.gc();
    }
    
    // Clear expired cache entries
    this.clearExpiredEntries();
  }
}
```

## Infrastructure Optimization

### Docker Optimization

```dockerfile
# Multi-stage build for smaller images
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:18-alpine AS runtime
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs . .

# Optimize Node.js runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048 --optimize-for-size"

USER nestjs
EXPOSE 3000

# Use exec form for better signal handling
CMD ["node", "dist/main.js"]
```

### Nginx Optimization

```nginx
# nginx.conf optimizations
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    # Performance optimizations
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 1000;
    
    # Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        text/xml
        application/xml
        application/xml+rss
        text/javascript;
    
    # Caching
    proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=app_cache:10m max_size=1g inactive=60m;
    
    upstream app_backend {
        least_conn;
        server app1:3000 max_fails=3 fail_timeout=30s;
        server app2:3000 max_fails=3 fail_timeout=30s;
        server app3:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }
    
    server {
        # Cache static content
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        
        # Cache API responses
        location /api/ {
            proxy_cache app_cache;
            proxy_cache_valid 200 302 10m;
            proxy_cache_valid 404 1m;
            proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
            
            proxy_pass http://app_backend;
        }
    }
}
```

## Security Performance

### Rate Limiting Optimization

```typescript
// Efficient rate limiting with Redis
@Injectable()
export class OptimizedRateLimitService {
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const windowKey = `${key}:${window}`;
    
    // Use Redis pipeline for atomic operations
    const pipeline = this.redis.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    const count = results[0][1] as number;
    
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  }
}
```

### Authentication Performance

```typescript
// JWT token caching
@Injectable()
export class OptimizedAuthService {
  private tokenCache = new Map<string, { payload: any; expires: number }>();
  
  async validateToken(token: string): Promise<any> {
    // Check cache first
    const cached = this.tokenCache.get(token);
    if (cached && cached.expires > Date.now()) {
      return cached.payload;
    }
    
    // Verify token
    const payload = await this.jwtService.verifyAsync(token);
    
    // Cache for 5 minutes
    this.tokenCache.set(token, {
      payload,
      expires: Date.now() + 300000,
    });
    
    return payload;
  }
}
```

## Monitoring and Alerting

### Performance Metrics

```typescript
// Custom performance metrics
@Injectable()
export class PerformanceMetricsService {
  @Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  })
  httpRequestDuration: Histogram<string>;
  
  @Counter({
    name: 'database_queries_total',
    help: 'Total number of database queries',
    labelNames: ['database', 'operation', 'status'],
  })
  databaseQueries: Counter<string>;
  
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestDuration
      .labels(method, route, statusCode.toString())
      .observe(duration / 1000);
  }
  
  recordDatabaseQuery(database: string, operation: string, success: boolean): void {
    this.databaseQueries
      .labels(database, operation, success ? 'success' : 'error')
      .inc();
  }
}
```

### Alert Thresholds

```yaml
# prometheus-alerts.yml
groups:
  - name: performance
    rules:
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, http_request_duration_seconds) > 0.5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
          
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.01
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          
      - alert: DatabaseSlowQueries
        expr: rate(database_query_duration_seconds{quantile="0.95"}[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow database queries detected"
```

### Performance Dashboard

```json
{
  "dashboard": {
    "title": "NestJS URL Shortener Performance",
    "panels": [
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, http_request_duration_seconds)",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.50, http_request_duration_seconds)",
            "legendFormat": "50th percentile"
          }
        ]
      },
      {
        "title": "Throughput",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "Requests per second"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])",
            "legendFormat": "Error rate"
          }
        ]
      }
    ]
  }
}
```

## Performance Checklist

### Pre-Production Checklist

- [ ] Database indexes are optimized
- [ ] Connection pools are configured
- [ ] Caching strategies are implemented
- [ ] Rate limiting is configured
- [ ] Compression is enabled
- [ ] Static assets are optimized
- [ ] CDN is configured (if applicable)
- [ ] Load balancing is set up
- [ ] Monitoring is configured
- [ ] Performance tests pass

### Regular Performance Maintenance

- [ ] Weekly performance test runs
- [ ] Monthly database optimization review
- [ ] Quarterly cache strategy review
- [ ] Annual infrastructure capacity planning
- [ ] Continuous monitoring of key metrics
- [ ] Regular security performance audits

### Performance Troubleshooting

1. **High Response Times**
   - Check database query performance
   - Verify cache hit rates
   - Review application logs
   - Monitor resource utilization

2. **High Memory Usage**
   - Check for memory leaks
   - Review cache sizes
   - Monitor garbage collection
   - Analyze heap dumps

3. **Database Performance Issues**
   - Review slow query logs
   - Check index usage
   - Monitor connection pool
   - Analyze query execution plans

4. **Cache Performance Issues**
   - Check cache hit rates
   - Review cache eviction policies
   - Monitor cache memory usage
   - Verify cache invalidation logic