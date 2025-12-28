# Troubleshooting Guide

This comprehensive troubleshooting guide helps you diagnose and resolve common issues with the SnapURL NestJS backend.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Application Startup Issues](#application-startup-issues)
3. [Database Connection Issues](#database-connection-issues)
4. [Authentication Problems](#authentication-problems)
5. [API Response Issues](#api-response-issues)
6. [Performance Problems](#performance-problems)
7. [Docker and Container Issues](#docker-and-container-issues)
8. [Environment Configuration Issues](#environment-configuration-issues)
9. [Testing Issues](#testing-issues)
10. [Production Deployment Issues](#production-deployment-issues)
11. [Monitoring and Logging Issues](#monitoring-and-logging-issues)
12. [Security Issues](#security-issues)
13. [Common Error Messages](#common-error-messages)
14. [Debug Tools and Commands](#debug-tools-and-commands)

## Quick Diagnostics

### Health Check Commands

```bash
# Check application health
curl http://localhost:3000/health

# Check database connections
npm run db:health

# Validate environment variables
npm run validate:env

# Check all services status
docker-compose ps

# View application logs
docker-compose logs -f app
```

### System Status Overview

```bash
# Check Node.js version
node --version

# Check npm version
npm --version

# Check Docker version
docker --version

# Check available ports
netstat -tulpn | grep -E ':(3000|5432|27017|6379)'

# Check disk space
df -h

# Check memory usage
free -h
```

## Application Startup Issues

### Issue: Application Won't Start

**Symptoms:**
- Server doesn't start
- Port binding errors
- Module loading errors

**Diagnostic Steps:**

```bash
# Check if port is already in use
lsof -i :3000

# Check for syntax errors
npm run lint:check

# Check TypeScript compilation
npm run build

# Start with verbose logging
DEBUG=* npm run start:dev
```

**Common Solutions:**

1. **Port Already in Use:**
```bash
# Kill process using port 3000
kill -9 $(lsof -t -i:3000)

# Or use different port
PORT=3001 npm run start:dev
```

2. **Missing Dependencies:**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install
```

3. **TypeScript Compilation Errors:**
```bash
# Check for type errors
npx tsc --noEmit

# Fix import paths
npm run lint:fix
```

### Issue: Module Import Errors

**Error Message:**
```
Cannot resolve dependency X of Y
```

**Solutions:**

1. **Check Module Registration:**
```typescript
// Ensure module is imported in app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot(),
    DatabaseModule,
    YourModule, // Make sure this is included
  ],
})
export class AppModule {}
```

2. **Check Provider Registration:**
```typescript
// Ensure service is provided in module
@Module({
  providers: [YourService],
  exports: [YourService],
})
export class YourModule {}
```

### Issue: Environment Variables Not Loading

**Symptoms:**
- `undefined` values for environment variables
- Configuration errors

**Solutions:**

1. **Check .env File Location:**
```bash
# Ensure .env is in project root
ls -la .env

# Check file contents
cat .env
```

2. **Validate Environment:**
```bash
# Run validation script
npm run validate:env

# Check specific variables
echo $DATABASE_URL
echo $JWT_SECRET
```

3. **Fix Environment Loading:**
```typescript
// In main.ts or app.module.ts
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
  ],
})
```

## Database Connection Issues

### Issue: PostgreSQL Connection Failed

**Error Messages:**
```
ECONNREFUSED 127.0.0.1:5432
password authentication failed
database "dbname" does not exist
```

**Diagnostic Steps:**

```bash
# Check PostgreSQL status
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Test connection manually
psql -h localhost -p 5432 -U postgres -d url_shortener_dev

# Check connection string
echo $DATABASE_URL
```

**Solutions:**

1. **Start PostgreSQL:**
```bash
# Using Docker
docker-compose up -d postgres

# Check if running
docker-compose ps postgres
```

2. **Create Database:**
```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U postgres

# Create database
CREATE DATABASE url_shortener_dev;

# Create user (if needed)
CREATE USER username WITH PASSWORD 'password';
GRANT ALL PRIVILEGES ON DATABASE url_shortener_dev TO username;
```

3. **Fix Connection String:**
```bash
# Correct format
DATABASE_URL=postgresql://username:password@localhost:5432/database_name

# For Docker
DATABASE_URL=postgresql://postgres:password@postgres:5432/url_shortener_dev
```

### Issue: MongoDB Connection Failed

**Error Messages:**
```
MongoNetworkError: failed to connect to server
Authentication failed
```

**Diagnostic Steps:**

```bash
# Check MongoDB status
docker-compose ps mongodb

# Check MongoDB logs
docker-compose logs mongodb

# Test connection
docker-compose exec mongodb mongosh url_shortener_dev

# Check connection string
echo $MONGODB_URI
```

**Solutions:**

1. **Start MongoDB:**
```bash
# Using Docker
docker-compose up -d mongodb

# Check status
docker-compose exec mongodb mongosh --eval "db.adminCommand('ping')"
```

2. **Fix Connection String:**
```bash
# Correct format
MONGODB_URI=mongodb://localhost:27017/url_shortener_dev

# For Docker
MONGODB_URI=mongodb://mongodb:27017/url_shortener_dev

# With authentication
MONGODB_URI=mongodb://username:password@mongodb:27017/url_shortener_dev
```

### Issue: Redis Connection Failed

**Error Messages:**
```
ECONNREFUSED 127.0.0.1:6379
Redis connection lost
```

**Diagnostic Steps:**

```bash
# Check Redis status
docker-compose ps redis

# Test Redis connection
docker-compose exec redis redis-cli ping

# Check Redis logs
docker-compose logs redis
```

**Solutions:**

1. **Start Redis:**
```bash
# Using Docker
docker-compose up -d redis

# Test connection
docker-compose exec redis redis-cli ping
# Should return: PONG
```

2. **Fix Redis Configuration:**
```bash
# Correct format
REDIS_URL=redis://localhost:6379

# For Docker
REDIS_URL=redis://redis:6379

# With password
REDIS_URL=redis://:password@redis:6379
```

## Authentication Problems

### Issue: JWT Token Invalid

**Error Messages:**
```
Unauthorized
Invalid token
Token expired
```

**Diagnostic Steps:**

```bash
# Check JWT secret
echo $JWT_SECRET

# Decode JWT token (for debugging)
echo "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." | base64 -d

# Test authentication endpoint
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'
```

**Solutions:**

1. **Check JWT Configuration:**
```typescript
// In auth.module.ts
JwtModule.register({
  secret: process.env.JWT_SECRET,
  signOptions: { expiresIn: '15m' },
})
```

2. **Verify Token Format:**
```bash
# Correct Authorization header format
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Not: Bearer: token
# Not: token
```

3. **Refresh Expired Tokens:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your-refresh-token"}'
```

### Issue: Password Hashing Problems

**Error Messages:**
```
Password comparison failed
bcrypt error
```

**Solutions:**

1. **Check bcrypt Configuration:**
```typescript
// Ensure consistent salt rounds
const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
const hashedPassword = await bcrypt.hash(password, saltRounds);
```

2. **Verify Password Comparison:**
```typescript
// Correct comparison
const isValid = await bcrypt.compare(plainPassword, hashedPassword);
```

## API Response Issues

### Issue: CORS Errors

**Error Messages:**
```
Access to fetch blocked by CORS policy
No 'Access-Control-Allow-Origin' header
```

**Solutions:**

1. **Configure CORS in main.ts:**
```typescript
import { NestFactory } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  
  await app.listen(3000);
}
```

2. **Environment Variable:**
```bash
# Set allowed origins
CORS_ORIGIN=http://localhost:3001,https://yourdomain.com
```

### Issue: Rate Limiting Too Aggressive

**Error Messages:**
```
Too Many Requests
Rate limit exceeded
```

**Solutions:**

1. **Adjust Rate Limits:**
```typescript
// In app.module.ts
ThrottlerModule.forRoot({
  ttl: 60, // 60 seconds
  limit: 100, // 100 requests per minute
})
```

2. **Environment Configuration:**
```bash
RATE_LIMIT_TTL=60000
RATE_LIMIT_MAX=100
```

### Issue: Validation Errors

**Error Messages:**
```
Validation failed
Bad Request
```

**Diagnostic Steps:**

```bash
# Test with valid data
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token" \
  -d '{
    "originalUrl": "https://example.com",
    "customAlias": "test-link"
  }'
```

**Solutions:**

1. **Check DTO Validation:**
```typescript
export class CreateUrlDto {
  @IsUrl()
  @IsNotEmpty()
  originalUrl: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  customAlias?: string;
}
```

2. **Global Validation Pipe:**
```typescript
// In main.ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
}));
```

## Performance Problems

### Issue: Slow Database Queries

**Symptoms:**
- High response times
- Database timeouts
- Memory usage spikes

**Diagnostic Steps:**

```bash
# Check database performance
docker-compose exec postgres psql -U postgres -d url_shortener_dev -c "
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;"

# Check MongoDB slow queries
docker-compose exec mongodb mongosh url_shortener_dev --eval "
db.setProfilingLevel(2, { slowms: 100 });
db.system.profile.find().sort({ts: -1}).limit(5);"
```

**Solutions:**

1. **Add Database Indexes:**
```sql
-- PostgreSQL indexes
CREATE INDEX CONCURRENTLY idx_users_email ON users(email);
CREATE INDEX CONCURRENTLY idx_users_created_at ON users(created_at);

-- MongoDB indexes
db.urls.createIndex({ "shortCode": 1 }, { unique: true });
db.urls.createIndex({ "userId": 1, "createdAt": -1 });
```

2. **Optimize Queries:**
```typescript
// Use select to limit fields
const users = await this.userRepository.find({
  select: ['id', 'email', 'name'],
  where: { isActive: true },
});

// Use pagination
const [users, total] = await this.userRepository.findAndCount({
  skip: (page - 1) * limit,
  take: limit,
});
```

3. **Implement Caching:**
```typescript
@Injectable()
export class CachedService {
  async findUser(id: string): Promise<User> {
    const cacheKey = `user:${id}`;
    
    // Check cache first
    const cached = await this.cacheService.get(cacheKey);
    if (cached) return cached;
    
    // Fetch from database
    const user = await this.userRepository.findOne({ where: { id } });
    
    // Cache result
    if (user) {
      await this.cacheService.set(cacheKey, user, 3600);
    }
    
    return user;
  }
}
```

### Issue: Memory Leaks

**Symptoms:**
- Increasing memory usage over time
- Application crashes with out-of-memory errors

**Diagnostic Steps:**

```bash
# Monitor memory usage
docker stats

# Generate heap dump
kill -USR2 $(pgrep node)

# Analyze with clinic.js
npm install -g clinic
clinic doctor -- node dist/main.js
```

**Solutions:**

1. **Fix Event Listener Leaks:**
```typescript
// Always remove listeners
export class SomeService implements OnModuleDestroy {
  onModuleDestroy() {
    this.eventEmitter.removeAllListeners();
  }
}
```

2. **Limit Cache Size:**
```typescript
// Implement cache size limits
private cache = new Map();
private readonly maxCacheSize = 10000;

set(key: string, value: any) {
  if (this.cache.size >= this.maxCacheSize) {
    const firstKey = this.cache.keys().next().value;
    this.cache.delete(firstKey);
  }
  this.cache.set(key, value);
}
```

## Docker and Container Issues

### Issue: Container Won't Start

**Error Messages:**
```
Container exited with code 1
Port already in use
Volume mount failed
```

**Diagnostic Steps:**

```bash
# Check container status
docker-compose ps

# View container logs
docker-compose logs app

# Check Docker daemon
docker info

# Check available resources
docker system df
```

**Solutions:**

1. **Port Conflicts:**
```bash
# Check what's using the port
lsof -i :3000

# Change port in docker-compose.yml
ports:
  - "3001:3000"
```

2. **Volume Issues:**
```bash
# Fix permissions
sudo chown -R $USER:$USER .

# Remove and recreate volumes
docker-compose down -v
docker-compose up -d
```

3. **Build Issues:**
```bash
# Rebuild containers
docker-compose build --no-cache

# Clean Docker system
docker system prune -a
```

### Issue: Database Container Issues

**Solutions:**

1. **PostgreSQL Container:**
```bash
# Check PostgreSQL logs
docker-compose logs postgres

# Reset PostgreSQL data
docker-compose down
docker volume rm nestjs-backend_postgres_data
docker-compose up -d postgres
```

2. **MongoDB Container:**
```bash
# Check MongoDB logs
docker-compose logs mongodb

# Reset MongoDB data
docker-compose down
docker volume rm nestjs-backend_mongodb_data
docker-compose up -d mongodb
```

## Environment Configuration Issues

### Issue: Environment Variables Not Set

**Diagnostic Steps:**

```bash
# Check environment file
cat .env

# Validate all required variables
npm run validate:env

# Check specific variables
printenv | grep -E "(DATABASE|MONGODB|REDIS|JWT)"
```

**Solutions:**

1. **Create Missing .env File:**
```bash
# Copy from example
cp .env.example .env

# Edit with your values
nano .env
```

2. **Fix Variable Names:**
```bash
# Correct variable names (case sensitive)
DATABASE_URL=postgresql://...
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
JWT_SECRET=your-secret
```

3. **Validate Configuration:**
```typescript
// Add validation in config service
@Injectable()
export class ConfigService {
  constructor() {
    this.validateConfig();
  }

  private validateConfig() {
    const required = ['DATABASE_URL', 'MONGODB_URI', 'JWT_SECRET'];
    for (const key of required) {
      if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }
  }
}
```

## Testing Issues

### Issue: Tests Failing

**Common Test Failures:**

1. **Database Connection in Tests:**
```typescript
// Use test database
beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'sqlite',
        database: ':memory:',
        entities: [User, Url],
        synchronize: true,
      }),
    ],
  }).compile();
});
```

2. **Mock External Dependencies:**
```typescript
// Mock external services
const mockEmailService = {
  sendEmail: jest.fn().mockResolvedValue(true),
};

beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      UserService,
      {
        provide: EmailService,
        useValue: mockEmailService,
      },
    ],
  }).compile();
});
```

3. **Clean Up After Tests:**
```typescript
afterEach(async () => {
  await userRepository.clear();
  jest.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});
```

### Issue: Property-Based Tests Failing

**Solutions:**

1. **Check Test Configuration:**
```typescript
// Increase number of runs for debugging
fc.assert(
  fc.property(
    fc.string(),
    (input) => {
      // Your property test
    }
  ),
  { numRuns: 1000, verbose: true }
);
```

2. **Add Better Error Messages:**
```typescript
fc.assert(
  fc.property(
    fc.string(),
    (input) => {
      const result = yourFunction(input);
      expect(result).toBeDefined();
      return true;
    }
  ),
  { 
    numRuns: 100,
    errorWithCause: true,
  }
);
```

## Production Deployment Issues

### Issue: Application Crashes in Production

**Diagnostic Steps:**

```bash
# Check application logs
docker logs container-name

# Check system resources
top
free -h
df -h

# Check process status
ps aux | grep node
```

**Solutions:**

1. **Increase Memory Limits:**
```dockerfile
# In Dockerfile
ENV NODE_OPTIONS="--max-old-space-size=2048"
```

2. **Add Health Checks:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

3. **Implement Graceful Shutdown:**
```typescript
// In main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable graceful shutdown
  app.enableShutdownHooks();
  
  await app.listen(3000);
}
```

### Issue: Database Connection Pool Exhausted

**Error Messages:**
```
Connection pool exhausted
Too many connections
```

**Solutions:**

1. **Optimize Connection Pool:**
```typescript
// In database config
{
  type: 'postgres',
  // ... other config
  extra: {
    max: 20, // Maximum connections
    min: 2,  // Minimum connections
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
  }
}
```

2. **Close Connections Properly:**
```typescript
// Always use try-finally
async function someOperation() {
  const queryRunner = this.dataSource.createQueryRunner();
  
  try {
    await queryRunner.connect();
    // Your operations
  } finally {
    await queryRunner.release();
  }
}
```

## Monitoring and Logging Issues

### Issue: Logs Not Appearing

**Solutions:**

1. **Check Log Configuration:**
```typescript
// In main.ts
import { Logger } from '@nestjs/common';

const logger = new Logger('Bootstrap');
logger.log('Application starting...');
```

2. **Configure Winston:**
```typescript
// In logger config
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
```

### Issue: Metrics Not Collected

**Solutions:**

1. **Check Prometheus Configuration:**
```typescript
// Ensure metrics endpoint is exposed
@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics() {
    return await register.metrics();
  }
}
```

2. **Verify Metrics Collection:**
```bash
# Check metrics endpoint
curl http://localhost:3000/metrics

# Check Prometheus targets
curl http://localhost:9090/api/v1/targets
```

## Security Issues

### Issue: Security Headers Missing

**Solutions:**

1. **Configure Helmet:**
```typescript
// In main.ts
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));
```

2. **Add Custom Security Headers:**
```typescript
// Custom security middleware
export function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}
```

### Issue: Rate Limiting Bypass

**Solutions:**

1. **Implement Multiple Rate Limiting Layers:**
```typescript
// Global rate limiting
@UseGuards(ThrottlerGuard)
@Throttle(100, 60) // 100 requests per minute

// Endpoint-specific rate limiting
@Post('login')
@Throttle(5, 60) // 5 login attempts per minute
async login() {
  // Login logic
}
```

2. **Use Redis for Distributed Rate Limiting:**
```typescript
// Configure Redis-based rate limiting
ThrottlerModule.forRoot({
  storage: new ThrottlerStorageRedisService(redisClient),
  ttl: 60,
  limit: 100,
})
```

## Common Error Messages

### "Cannot resolve dependency"

**Cause:** Missing provider or circular dependency

**Solution:**
```typescript
// Check module imports and providers
@Module({
  imports: [RequiredModule],
  providers: [YourService],
  exports: [YourService],
})
```

### "Port 3000 is already in use"

**Solution:**
```bash
# Kill process using port
kill -9 $(lsof -t -i:3000)

# Or use different port
PORT=3001 npm run start:dev
```

### "ECONNREFUSED"

**Cause:** Service not running or wrong connection details

**Solution:**
```bash
# Check service status
docker-compose ps

# Check connection string
echo $DATABASE_URL
```

### "ValidationError"

**Cause:** Invalid input data

**Solution:**
```typescript
// Check DTO validation rules
export class CreateUserDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}
```

## Debug Tools and Commands

### Application Debugging

```bash
# Start with debugger
npm run start:debug

# Enable verbose logging
DEBUG=* npm run start:dev

# Profile performance
node --prof dist/main.js

# Generate heap snapshot
kill -USR2 $(pgrep node)
```

### Database Debugging

```bash
# PostgreSQL query analysis
docker-compose exec postgres psql -U postgres -d url_shortener_dev -c "
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';"

# MongoDB query profiling
docker-compose exec mongodb mongosh url_shortener_dev --eval "
db.setProfilingLevel(2, { slowms: 100 });
db.urls.find({shortCode: 'abc123'}).explain('executionStats');"

# Redis debugging
docker-compose exec redis redis-cli monitor
```

### Network Debugging

```bash
# Check API endpoints
curl -v http://localhost:3000/health

# Test with different HTTP methods
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}' \
  -v

# Check response headers
curl -I http://localhost:3000/health
```

### Container Debugging

```bash
# Execute commands in container
docker-compose exec app bash

# Check container resources
docker stats

# Inspect container configuration
docker inspect container-name

# Check container logs with timestamps
docker-compose logs -t app
```

---

## Getting Help

If you're still experiencing issues after following this guide:

1. **Check the logs** - Most issues leave traces in application or container logs
2. **Search existing issues** - Check GitHub issues for similar problems
3. **Create a minimal reproduction** - Isolate the problem to its simplest form
4. **Gather system information** - Include OS, Node.js version, Docker version, etc.
5. **Include relevant logs** - Provide error messages and stack traces
6. **Ask for help** - Create a detailed issue with all the above information

Remember: The more information you provide, the easier it is to help you resolve the issue!