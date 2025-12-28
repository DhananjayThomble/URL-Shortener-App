# Frequently Asked Questions (FAQ)

This document answers common questions about the SnapURL NestJS backend, covering development, deployment, troubleshooting, and best practices.

## Table of Contents

1. [General Questions](#general-questions)
2. [Development Setup](#development-setup)
3. [Database Questions](#database-questions)
4. [Authentication & Security](#authentication--security)
5. [API Usage](#api-usage)
6. [Testing](#testing)
7. [Performance](#performance)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

## General Questions

### Q: What is SnapURL?
**A:** SnapURL is an enterprise-grade URL shortener built with NestJS v10. It provides advanced features like analytics, bio pages, geo-targeting, password protection, and comprehensive admin tools.

### Q: Why did we choose NestJS over Express.js?
**A:** NestJS provides:
- **Type Safety**: Full TypeScript support with decorators
- **Scalability**: Modular architecture with dependency injection
- **Developer Experience**: Built-in testing, validation, and documentation
- **Enterprise Features**: Guards, interceptors, pipes, and middleware
- **Ecosystem**: Rich ecosystem with official packages

### Q: What databases does the application use?
**A:** We use a hybrid database architecture:
- **PostgreSQL**: User management, authentication, admin data
- **MongoDB**: URL data, analytics, bio pages (document-based data)
- **Redis**: Caching, sessions, rate limiting, job queues

### Q: Is this production-ready?
**A:** Yes! The application includes:
- ✅ Comprehensive testing (unit, integration, e2e, property-based)
- ✅ Security features (JWT, rate limiting, input validation)
- ✅ Monitoring and logging
- ✅ Docker containerization
- ✅ CI/CD pipeline
- ✅ Performance optimization
- ✅ Documentation and runbooks

## Development Setup

### Q: What are the system requirements?
**A:** 
- **Node.js**: 18.0.0 or higher
- **npm**: 9.0.0 or higher
- **Docker**: 20.10+ (for databases)
- **Memory**: 4GB RAM minimum, 8GB recommended
- **Disk**: 2GB free space minimum

### Q: How do I set up the development environment quickly?
**A:**
```bash
# One-command setup
git clone <repository>
cd nestjs-backend
npm run setup:dev
npm run start:dev
```

This will:
- Install dependencies
- Set up environment variables
- Start database services
- Run migrations
- Seed development data
- Start the application

### Q: Can I run without Docker?
**A:** Yes, but you'll need to install and configure:
- PostgreSQL 15+
- MongoDB 6+
- Redis 7+

Then update your `.env` file with the appropriate connection strings.

### Q: What VS Code extensions are recommended?
**A:**
- TypeScript and JavaScript Language Features
- ESLint
- Prettier
- Jest
- Docker
- REST Client
- GitLens

### Q: How do I reset my development environment?
**A:**
```bash
# Stop all services
docker-compose down -v

# Clean install
rm -rf node_modules package-lock.json
npm install

# Restart everything
npm run setup:dev
```

## Database Questions

### Q: Why use multiple databases?
**A:** Each database serves specific purposes:
- **PostgreSQL**: ACID compliance for user data and transactions
- **MongoDB**: Flexible schema for URLs and analytics
- **Redis**: High-performance caching and real-time data

### Q: How do I run database migrations?
**A:**
```bash
# Run all pending migrations
npm run migration:run

# Generate new migration
npm run migration:generate -- -n MigrationName

# Revert last migration
npm run migration:revert
```

### Q: How do I seed development data?
**A:**
```bash
# Seed all development data
npm run seed:db

# This creates:
# - Test users
# - Sample URLs
# - Demo bio pages
# - Analytics data
```

### Q: How do I backup/restore databases?
**A:**
```bash
# Backup
npm run db:backup

# Restore
npm run db:restore

# Health check
npm run db:health
```

### Q: Can I use a different database?
**A:** The architecture is designed for the current hybrid setup. Changing databases would require:
- Updating entity definitions
- Modifying connection configurations
- Adjusting queries and operations
- Testing compatibility

## Authentication & Security

### Q: How does authentication work?
**A:** We use JWT-based authentication:
1. User logs in with email/password
2. Server returns access token (15min) and refresh token (7 days)
3. Client includes access token in Authorization header
4. When access token expires, use refresh token to get new tokens

### Q: How do I test authentication in development?
**A:**
```bash
# Register user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!","name":"Test User"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"SecurePass123!"}'

# Use token in subsequent requests
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/v1/urls
```

### Q: How are passwords secured?
**A:** Passwords are hashed using bcrypt with 12 salt rounds (configurable via `BCRYPT_SALT_ROUNDS`). We never store plain text passwords.

### Q: What security measures are implemented?
**A:**
- **Input Validation**: class-validator for all DTOs
- **Rate Limiting**: Configurable per endpoint
- **CORS**: Whitelist-based origin control
- **Security Headers**: Helmet.js for HTTP security
- **JWT Security**: Secure token generation and validation
- **SQL Injection Protection**: Parameterized queries via TypeORM
- **XSS Protection**: Input sanitization and output encoding

### Q: How do I configure rate limiting?
**A:**
```bash
# Environment variables
RATE_LIMIT_TTL=60000        # 1 minute window
RATE_LIMIT_MAX=100          # 100 requests per window
RATE_LIMIT_AUTH_MAX=5       # 5 auth attempts per window
```

## API Usage

### Q: Where is the API documentation?
**A:** Interactive Swagger documentation is available at:
- **Development**: http://localhost:3000/docs
- **Production**: https://api.yourdomain.com/docs

### Q: What's the API response format?
**A:** All responses follow a consistent format:
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Optional message",
  "meta": {
    "timestamp": "2024-01-15T10:30:00.000Z",
    "version": "1.0.0"
  }
}
```

### Q: How do I handle API errors?
**A:** Error responses include detailed information:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Email must be a valid email address"
      }
    ]
  },
  "statusCode": 400,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/auth/register"
}
```

### Q: How do I create a short URL with advanced features?
**A:**
```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "originalUrl": "https://example.com",
    "customAlias": "my-link",
    "password": "secret123",
    "expiresAt": "2024-12-31T23:59:59.000Z",
    "iosUrl": "https://apps.apple.com/app/example",
    "androidUrl": "https://play.google.com/store/apps/details?id=com.example",
    "geoTargeting": [
      {"country": "US", "redirectUrl": "https://example.com/us"},
      {"country": "UK", "redirectUrl": "https://example.com/uk"}
    ]
  }'
```

### Q: How do I get analytics for a URL?
**A:**
```bash
curl -X GET "http://localhost:3000/api/v1/urls/URL_ID/analytics?startDate=2024-01-01&endDate=2024-01-31" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Q: What's the difference between URL ID and short code?
**A:**
- **URL ID**: Internal database identifier (e.g., `65a1b2c3d4e5f6789abcdef0`)
- **Short Code**: Public identifier for redirects (e.g., `abc123`)
- **Custom Alias**: User-defined identifier (e.g., `my-custom-link`)

## Testing

### Q: How do I run tests?
**A:**
```bash
# All tests
npm test

# Specific test types
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e          # End-to-end tests only
npm run test:property     # Property-based tests only

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

### Q: What types of tests are included?
**A:**
- **Unit Tests**: Test individual functions and methods
- **Integration Tests**: Test module interactions
- **E2E Tests**: Test complete HTTP request/response cycles
- **Property-Based Tests**: Test universal properties with generated inputs

### Q: How do I write a new test?
**A:**
```typescript
// Unit test example
describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [UsersService],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should create a user', async () => {
    const dto = { email: 'test@example.com', password: 'pass', name: 'Test' };
    const user = await service.create(dto);
    expect(user.email).toBe(dto.email);
  });
});
```

### Q: How do I test with a database?
**A:** Use test containers or in-memory databases:
```typescript
// In test setup
beforeAll(async () => {
  const module = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({
        type: 'sqlite',
        database: ':memory:',
        entities: [User],
        synchronize: true,
      }),
    ],
  }).compile();
});
```

### Q: What is property-based testing?
**A:** Property-based testing validates universal properties across many generated inputs:
```typescript
import * as fc from 'fast-check';

it('should hash passwords consistently', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 8 }),
      async (password) => {
        const hash = await bcrypt.hash(password, 12);
        const isValid = await bcrypt.compare(password, hash);
        return isValid === true;
      }
    ),
    { numRuns: 100 }
  );
});
```

## Performance

### Q: How is caching implemented?
**A:** We use multi-level caching:
- **L1 Cache**: In-memory for frequently accessed data
- **L2 Cache**: Redis for shared cache across instances
- **HTTP Cache**: ETags and cache headers for API responses

### Q: How do I optimize database queries?
**A:**
- Use `select` to limit returned fields
- Implement pagination for large datasets
- Add appropriate indexes
- Use raw queries for complex operations
- Monitor slow queries

### Q: What performance monitoring is available?
**A:**
- **Health Checks**: `/health`, `/health/ready`, `/health/live`
- **Metrics**: `/metrics` (Prometheus format)
- **Logging**: Structured logs with Winston
- **Tracing**: OpenTelemetry integration

### Q: How do I handle high traffic?
**A:**
- **Horizontal Scaling**: Run multiple instances behind load balancer
- **Database Optimization**: Connection pooling, read replicas
- **Caching**: Implement aggressive caching strategies
- **Rate Limiting**: Protect against abuse
- **CDN**: Use CDN for static assets

## Deployment

### Q: How do I deploy to production?
**A:**
```bash
# Build application
npm run build

# Run production readiness tests
npm run test:prod-ready

# Deploy using script
./scripts/deploy.sh production

# Or using Docker
docker build -t snapurl-backend .
docker run -p 3000:3000 snapurl-backend
```

### Q: What environment variables are required for production?
**A:** See [Environment Configuration](../README.md#environment-configuration) for complete list. Key variables:
```bash
NODE_ENV=production
DATABASE_URL=postgresql://...
MONGODB_URI=mongodb://...
REDIS_URL=redis://...
JWT_SECRET=strong-production-secret
JWT_REFRESH_SECRET=strong-refresh-secret
```

### Q: How do I run health checks?
**A:**
```bash
# Basic health
curl http://localhost:3000/health

# Readiness check
curl http://localhost:3000/health/ready

# Liveness check
curl http://localhost:3000/health/live
```

### Q: How do I monitor the application in production?
**A:**
- **Logs**: Structured JSON logs via Winston
- **Metrics**: Prometheus metrics at `/metrics`
- **Health**: Health check endpoints
- **Alerts**: Configure alerts based on metrics
- **Dashboards**: Grafana dashboards for visualization

## Troubleshooting

### Q: Application won't start - what should I check?
**A:**
1. **Port conflicts**: `lsof -i :3000`
2. **Environment variables**: `npm run validate:env`
3. **Database connections**: `npm run db:health`
4. **Dependencies**: `npm install`
5. **Logs**: Check application logs for errors

### Q: Database connection failed - how to fix?
**A:**
1. **Check service status**: `docker-compose ps`
2. **Check connection strings**: Verify `.env` file
3. **Test connections**: `npm run db:health`
4. **Restart services**: `docker-compose restart`
5. **Check logs**: `docker-compose logs postgres mongodb redis`

### Q: Tests are failing - what to do?
**A:**
1. **Run specific test**: `npm test -- --testNamePattern="test name"`
2. **Check test database**: Ensure test database is clean
3. **Clear cache**: `npm test -- --clearCache`
4. **Update snapshots**: `npm test -- --updateSnapshot`
5. **Check mocks**: Verify mock implementations

### Q: API returns 500 errors - how to debug?
**A:**
1. **Check logs**: Look for error stack traces
2. **Test endpoint**: Use curl or Postman to isolate issue
3. **Validate input**: Ensure request format is correct
4. **Check database**: Verify database connections and data
5. **Enable debug logging**: Set `LOG_LEVEL=debug`

### Q: Performance is slow - how to optimize?
**A:**
1. **Check database queries**: Look for N+1 queries or missing indexes
2. **Monitor cache hit rates**: Verify caching is working
3. **Check resource usage**: CPU, memory, disk I/O
4. **Profile application**: Use Node.js profiling tools
5. **Review logs**: Look for slow operations

## Best Practices

### Q: What are the coding standards?
**A:**
- **TypeScript**: Use explicit types, avoid `any`
- **NestJS**: Follow dependency injection patterns
- **Testing**: Write tests for all business logic
- **Error Handling**: Use proper exception types
- **Logging**: Use structured logging with context
- **Security**: Validate all inputs, use parameterized queries

### Q: How should I structure a new module?
**A:**
```
src/modules/example/
├── controllers/
│   └── example.controller.ts
├── services/
│   └── example.service.ts
├── entities/
│   └── example.entity.ts
├── dto/
│   ├── create-example.dto.ts
│   └── update-example.dto.ts
├── interfaces/
│   └── example.interface.ts
└── example.module.ts
```

### Q: How should I handle errors?
**A:**
```typescript
// Use specific exception types
throw new BadRequestException('Invalid input data');
throw new NotFoundException('User not found');
throw new UnauthorizedException('Invalid credentials');

// Log errors with context
this.logger.error('Failed to create user', {
  error: error.message,
  userId: dto.userId,
  timestamp: new Date().toISOString(),
});
```

### Q: How should I write commit messages?
**A:** Follow [Conventional Commits](https://www.conventionalcommits.org/):
```bash
feat: add user authentication
fix: resolve database connection issue
docs: update API documentation
test: add unit tests for user service
refactor: improve error handling
```

### Q: When should I create a new branch?
**A:**
- **Feature**: `feature/user-authentication`
- **Bug Fix**: `fix/database-connection-error`
- **Documentation**: `docs/update-api-guide`
- **Refactor**: `refactor/improve-error-handling`

### Q: How do I ensure code quality?
**A:**
```bash
# Before committing
npm run quality:check

# This runs:
# - ESLint for code quality
# - Prettier for formatting
# - Tests for functionality
# - Type checking
```

---

## Still Have Questions?

If your question isn't answered here:

1. **Check the documentation**:
   - [Developer Guide](./DEVELOPER_GUIDE.md)
   - [API Usage Examples](./API_USAGE_EXAMPLES.md)
   - [Troubleshooting Guide](./TROUBLESHOOTING.md)

2. **Search existing issues** on GitHub

3. **Ask the team** in Slack/Discord

4. **Create a new issue** with detailed information

Remember: No question is too small! We're here to help you succeed. 🚀