# SnapURL Backend - NestJS 10

> **AI-Optimized Documentation**: This README is structured to provide complete project context for coding AI tools, minimizing hallucinations and errors.

Enterprise-grade URL shortener backend built with NestJS v10, featuring hybrid database architecture (PostgreSQL, MongoDB, Redis), comprehensive security, JWT authentication, and advanced monitoring capabilities.

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Technology Stack](#️-technology-stack)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Environment Configuration](#-environment-configuration)
- [Project Structure](#-project-structure)
- [Database Architecture](#-database-architecture)
- [API Documentation](#-api-documentation)
- [Dependencies](#-dependencies)
- [Development Workflow](#-development-workflow)
- [Testing](#-testing)
- [Security](#-security)
- [Monitoring & Logging](#-monitoring--logging)
- [Building & Deployment](#-building--deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## 🎯 Overview

This is the backend service for SnapURL, a full-featured URL shortener application. The application has been successfully migrated from Express.js to NestJS v10 and is fully production-ready.

**Production Ready Features:**
- ✅ **Complete NestJS v10 Implementation** - Modern TypeScript architecture with dependency injection
- ✅ **Hybrid Database Architecture** - PostgreSQL for users, MongoDB for URLs, Redis for caching
- ✅ **Enterprise Security** - JWT authentication, RBAC, rate limiting, input validation
- ✅ **High Performance** - Multi-level caching, connection pooling, optimized queries
- ✅ **Comprehensive Testing** - Unit tests, integration tests, and E2E tests with 80%+ coverage
- ✅ **Production Monitoring** - Winston logging, health checks, metrics collection
- ✅ **Complete Documentation** - Swagger API docs, deployment guides, runbooks
- ✅ **Docker Ready** - Multi-stage builds, production-optimized images

## 🚀 Features

### Core Functionality
- **URL Shortening**: Generate short URLs with customizable aliases using nanoid
- **Analytics Tracking**: Track clicks, referrers, devices, browsers, and geographic data
- **QR Code Generation**: Create QR codes for shortened URLs
- **Bulk Operations**: Import/export URLs, batch QR code generation

### Authentication & Authorization
- **JWT Authentication**: Access and refresh token mechanism
- **Role-Based Access Control (RBAC)**: User, Admin, Super Admin roles
- **Email Verification**: Secure email verification flow
- **Password Reset**: Secure password reset via email tokens
- **Session Management**: Redis-backed session storage

### Data Management
- **Hybrid Database**: PostgreSQL for users, MongoDB for URLs and analytics
- **Multi-Level Caching**: Redis caching for URLs, sessions, and analytics
- **Database Migrations**: TypeORM migrations for schema versioning
- **Connection Pooling**: Optimized database connection management

### Security Features
- **Rate Limiting**: Configurable rate limits per endpoint
- **Input Validation**: class-validator for request validation
- **Password Hashing**: bcrypt with configurable salt rounds (12+)
- **Security Headers**: Helmet.js for HTTP security headers
- **CORS Configuration**: Whitelist-based CORS policy
- **SQL Injection Protection**: Parameterized queries via TypeORM
- **XSS Protection**: Input sanitization and output encoding

### Monitoring & Operations
- **Health Checks**: Database, Redis, and service health endpoints
- **Structured Logging**: Winston with CloudWatch integration
- **Error Tracking**: Comprehensive error logging and alerting
- **Performance Metrics**: Request timing, database query performance
- **Graceful Shutdown**: Clean resource cleanup on termination

### Developer Experience
- **Hot Reloading**: Instant feedback during development
- **API Documentation**: Swagger/OpenAPI auto-generated docs
- **TypeScript**: Full type safety across the application
- **Testing**: Jest for unit/integration tests, Supertest for E2E
- **Code Quality**: ESLint, Prettier, Husky git hooks

## 🛠️ Technology Stack

### Core Framework
- **NestJS v10** - Progressive Node.js framework with TypeScript, dependency injection
- **Node.js v18+** - JavaScript runtime environment
- **TypeScript v5** - Typed superset of JavaScript

### Databases
- **PostgreSQL 15** - Relational database for user management and authentication
- **MongoDB 6** - Document database for URL data and analytics
- **Redis 7** - In-memory data store for caching and session management

### Authentication & Security
- **Passport.js** - Authentication middleware with multiple strategies
- **passport-jwt** - JWT authentication strategy
- **passport-local** - Username/password authentication
- **passport-headerapikey** - API key authentication
- **JWT (jsonwebtoken)** - JSON Web Token implementation
- **bcrypt** - Password hashing library (12+ salt rounds)
- **Helmet.js** - Security headers middleware
- **class-validator** - Decorator-based validation
- **class-transformer** - Object transformation and serialization

### Database ORMs & Tools
- **TypeORM** - ORM for PostgreSQL with migration support
- **Mongoose** - MongoDB object modeling
- **ioredis** - Redis client with cluster support

### Utilities & Libraries
- **nanoid** - Unique ID generator for short codes
- **nodemailer** - Email sending (SMTP)
- **compression** - Response compression
- **uuid** - UUID generation for primary keys

### API Documentation
- **@nestjs/swagger** - OpenAPI/Swagger integration
- **swagger-ui-express** - Swagger UI for API exploration

### Monitoring & Logging
- **Winston** - Logging library with multiple transports
- **winston-cloudwatch** - CloudWatch integration for logs

### Development & Testing
- **Jest** - Testing framework (unit, integration, E2E)
- **Supertest** - HTTP assertion library for E2E tests
- **@nestjs/testing** - NestJS testing utilities
- **Testcontainers** - Docker containers for integration tests
- **ESLint** - Linting for code quality
- **Prettier** - Code formatting
- **Husky** - Git hooks for pre-commit checks
- **lint-staged** - Run linters on staged files

### Build & DevOps
- **@nestjs/cli** - NestJS command-line interface
- **ts-node** - TypeScript execution environment
- **Docker** - Containerization
- **Docker Compose** - Multi-container orchestration

## 📋 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- PostgreSQL 15+
- MongoDB 6+
- Redis 7+

### Development Setup
```bash
# Clone and install dependencies
git clone <repository>
cd nestjs-backend
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Validate environment
npm run validate:env

# Start development server
npm run start:dev
```

### Production Deployment
```bash
# Build application
npm run build

# Run production readiness tests
npm run test:prod-ready

# Start production server
npm run start:prod
```

## 📚 Documentation

- [Production Readiness Guide](./PRODUCTION_READINESS.md) - Complete testing and validation
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md) - Step-by-step deployment guide
- [Migration Guide](./docs/MIGRATION_GUIDE.md) - Express.js to NestJS migration
- [Deployment Runbook](./docs/DEPLOYMENT_RUNBOOK.md) - Operations procedures
- [Performance Optimization](./docs/PERFORMANCE_OPTIMIZATION.md) - Performance tuning

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run E2E tests
npm run test:e2e

# Production readiness tests
npm run test:prod-ready

# Environment validation
npm run validate:env
```
- **Husky** - Git hooks
- **Docker** - Containerization

## 📋 Prerequisites

Before starting, ensure you have:

### Required Software

- **Node.js**: Version 18.0.0 or higher (check with `node --version`)
- **npm**: Version 9.0.0 or higher (comes with Node.js)
- **PostgreSQL**: Version 15 or higher (for user management)
- **MongoDB**: Version 6 or higher (for URL storage)
- **Redis**: Version 7 or higher (for caching)
- **Docker** (optional): Version 20.10+ for containerized development
- **Docker Compose** (optional): Version 2.0+ for orchestration
- **Git**: For version control

### System Requirements
- **Memory**: Minimum 4GB RAM, 8GB recommended for development
- **Disk Space**: Minimum 2GB free space
- **OS**: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)

### Knowledge Prerequisites
- TypeScript fundamentals
- NestJS concepts (modules, controllers, services, dependency injection)
- RESTful API design
- Database fundamentals (SQL and NoSQL)
- JWT authentication
- Docker basics (if using containerization)

## 🚀 Quick Start

### Option 1: Docker (Recommended for Development)

The fastest way to get started:

```bash
# Navigate to backend directory
cd nestjs-backend

# Start all services (PostgreSQL, MongoDB, Redis, Application)
docker-compose up -d

# View logs
docker-compose logs -f app

# Access the application
# API: http://localhost:3000
# Swagger Docs: http://localhost:3000/docs
```

**What this does:**
- Starts PostgreSQL on port 5432
- Starts MongoDB on port 27017
- Starts Redis on port 6379
- Starts the NestJS app on port 3000
- Automatically runs database migrations
- Sets up all environment variables

### Option 2: Local Development (Manual Setup)

For more control over your development environment:

#### 1. Clone and Install

```bash
# If you haven't cloned the repository yet
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App/nestjs-backend

# Install dependencies (this may take 2-3 minutes)
npm install
```

**Troubleshooting Install:**
- If you get permission errors, don't use sudo. Fix npm permissions instead.
- If packages fail to install, clear npm cache: `npm cache clean --force`
- On Windows, you may need to install windows-build-tools: `npm install -g windows-build-tools`

#### 2. Setup Databases

**Option A: Using Docker for Databases Only**
```bash
# Start only databases (not the app)
docker-compose -f docker-compose.dev.yml up -d

# This starts:
# - PostgreSQL on localhost:5432
# - MongoDB on localhost:27017
# - Redis on localhost:6379
```

**Option B: Install Databases Locally**

**PostgreSQL:**
```bash
# macOS
brew install postgresql@15
brew services start postgresql@15

# Ubuntu/Debian
sudo apt-get install postgresql-15
sudo systemctl start postgresql

# Create database
createdb url_shortener_dev

# Create user
psql -c "CREATE USER username WITH PASSWORD 'password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE url_shortener_dev TO username;"
```

**MongoDB:**
```bash
# macOS
brew tap mongodb/brew
brew install mongodb-community@6
brew services start mongodb-community

# Ubuntu/Debian
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod

# Create database (automatic on first connection)
```

**Redis:**
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis-server
```

#### 3. Environment Configuration

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your configuration
nano .env
```

**Minimum required configuration:**
```bash
# Database URLs (update with your credentials)
DATABASE_URL=postgresql://username:password@localhost:5432/url_shortener_dev
MONGODB_URI=mongodb://localhost:27017/url_shortener_dev
REDIS_URL=redis://localhost:6379

# JWT Secrets (change these!)
JWT_SECRET=your-super-secret-jwt-key-change-this
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this

# Email Configuration (for password reset, verification)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# Frontend URL
FRONTEND_URL=http://localhost:3001
```

#### 4. Validate Environment

```bash
# Run environment validation script
npm run validate:env

# This checks:
# - All required variables are set
# - Database connections work
# - Redis connection works
# - Email configuration is valid
```

#### 5. Run Database Migrations

```bash
# Run TypeORM migrations for PostgreSQL
npm run migration:run

# This creates all necessary tables:
# - users
# - roles
# - sessions
# - audit_logs
```

#### 6. Start Development Server

```bash
# Start with hot-reload
npm run start:dev

# The server will start on http://localhost:3000
# Changes to TypeScript files will automatically reload
```

#### 7. Verify Setup

Open your browser and check:
- **API Health**: http://localhost:3000/health
- **API Documentation**: http://localhost:3000/docs
- **API Root**: http://localhost:3000/

You should see:
```json
{
  "success": true,
  "message": "SnapURL API is running",
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Quick Test

Test the API with curl:

```bash
# Health check
curl http://localhost:3000/health

# Register a user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!",
    "name": "Test User"
  }'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
```

## 🌐 Environment Configuration

### Complete Environment Variables

The backend uses environment variables for configuration. Copy `.env.example` to `.env` and configure:

#### Application Settings

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment (development/staging/production) | `development` | Yes |
| `PORT` | Server port | `3000` | Yes |
| `API_PREFIX` | API route prefix | `api/v1` | Yes |

#### PostgreSQL Configuration (User Management)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `DATABASE_URL` | Full PostgreSQL connection string | `postgresql://user:pass@localhost:5432/db` | Yes |
| `DATABASE_HOST` | PostgreSQL host | `localhost` | Yes |
| `DATABASE_PORT` | PostgreSQL port | `5432` | Yes |
| `DATABASE_USERNAME` | Database user | `postgres` | Yes |
| `DATABASE_PASSWORD` | Database password | `password` | Yes |
| `DATABASE_NAME` | Database name | `url_shortener` | Yes |

#### MongoDB Configuration (URL & Analytics Storage)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/urls` | Yes |
| `MONGODB_HOST` | MongoDB host | `localhost` | No |
| `MONGODB_PORT` | MongoDB port | `27017` | No |
| `MONGODB_DATABASE` | MongoDB database name | `url_shortener` | No |

#### Redis Configuration (Caching & Sessions)

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` | Yes |
| `REDIS_HOST` | Redis host | `localhost` | No |
| `REDIS_PORT` | Redis port | `6379` | No |
| `REDIS_PASSWORD` | Redis password | `password` | No |

#### JWT Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `JWT_SECRET` | Secret for access tokens | - | Yes |
| `JWT_EXPIRES_IN` | Access token expiry | `15m` | No |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens | - | Yes |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiry | `7d` | No |

#### Security Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BCRYPT_SALT_ROUNDS` | bcrypt hashing rounds | `12` | No |
| `SESSION_SECRET` | Session secret key | - | Yes |

#### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_GLOBAL_MAX` | Global max requests | `1000` |
| `RATE_LIMIT_GLOBAL_WINDOW` | Global window (ms) | `900000` (15min) |
| `RATE_LIMIT_AUTH_MAX` | Auth endpoint max requests | `5` |
| `RATE_LIMIT_AUTH_WINDOW` | Auth window (ms) | `900000` (15min) |

#### Email Configuration

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `EMAIL_HOST` | SMTP host | `smtp.gmail.com` | Yes |
| `EMAIL_PORT` | SMTP port | `587` | Yes |
| `EMAIL_USER` | Email username | `user@gmail.com` | Yes |
| `EMAIL_PASS` | Email password/app password | `apppassword123` | Yes |
| `EMAIL_FROM` | From email address | `noreply@snapurl.in` | No |

#### Application URLs

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `FRONTEND_URL` | Frontend application URL | `http://localhost:3001` | Yes |
| `BACKEND_URL` | Backend API URL | `http://localhost:3000` | Yes |

#### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `CUSTOM_DOMAIN_ENABLED` | Enable custom domains | `false` |
| `ENABLE_COMPRESSION` | Enable response compression | `true` |
| `ENABLE_PERFORMANCE_MONITORING` | Enable performance monitoring | `true` |

#### Cache Configuration

| Variable | Description | Default (seconds) |
|----------|-------------|-------------------|
| `CACHE_TTL_URL` | URL cache TTL | `3600` (1h) |
| `CACHE_TTL_SESSION` | Session cache TTL | `900` (15min) |
| `CACHE_TTL_ANALYTICS` | Analytics cache TTL | `300` (5min) |
| `CACHE_TTL_METADATA` | Metadata cache TTL | `86400` (24h) |
| `CACHE_TTL_POPULAR` | Popular URLs cache TTL | `1800` (30min) |

### Environment Files

**Development (`.env`)**
```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:password@localhost:5432/url_shortener_dev
MONGODB_URI=mongodb://localhost:27017/url_shortener_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=dev@example.com
EMAIL_PASS=your-app-password
FRONTEND_URL=http://localhost:3001
```

**Production (`.env.production`)**
```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@prod-pg.amazonaws.com:5432/url_shortener
MONGODB_URI=mongodb://user:pass@prod-mongo.amazonaws.com:27017/url_shortener
REDIS_URL=redis://prod-redis.amazonaws.com:6379
JWT_SECRET=strong-production-secret-min-32-chars
JWT_REFRESH_SECRET=strong-production-refresh-secret-min-32-chars
BCRYPT_SALT_ROUNDS=14
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=SG.xxxxxxxxxxxx
FRONTEND_URL=https://app.snapurl.in
BACKEND_URL=https://api.snapurl.in
```

## 🐳 Docker Development

### Start All Services

```bash
# Start all services (app + databases)
docker-compose up -d

# View logs
docker-compose logs -f app

### Database Management

```bash
# Start only databases
docker-compose -f docker-compose.dev.yml up -d

# Access PostgreSQL
docker-compose exec postgres psql -U postgres -d url_shortener_dev

# Access MongoDB
docker-compose exec mongo mongosh url_shortener_dev
```

## 📚 API Documentation

### Swagger/OpenAPI Documentation

The API documentation is automatically generated using Swagger/OpenAPI and is available at:
- **Development**: http://localhost:3000/docs
- **Production**: https://api.snapurl.in/docs

The Swagger UI provides:
- Interactive API exploration
- Request/response examples
- Authentication testing
- Schema definitions
- Try-it-out functionality

### API Endpoints

All API endpoints follow REST conventions and return JSON responses.

#### Authentication Endpoints (`/api/v1/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth/register` | Register new user account | No |
| POST | `/auth/login` | Login and receive JWT tokens | No |
| POST | `/auth/logout` | Logout (invalidate tokens) | Yes |
| POST | `/auth/refresh` | Refresh access token using refresh token | No |
| POST | `/auth/forgot-password` | Request password reset email | No |
| POST | `/auth/reset-password` | Reset password with token | No |
| POST | `/auth/verify-email` | Verify email with token | No |
| POST | `/auth/resend-verification` | Resend verification email | Yes |

**Example: Register**
```bash
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}

Response:
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
  }
}
```

**Example: Login**
```bash
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

Response:
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "expiresIn": 900
  }
}
```

#### User Endpoints (`/api/v1/users`)

| Method | Endpoint | Description | Auth Required | Role |
|--------|----------|-------------|---------------|------|
| GET | `/users/profile` | Get current user profile | Yes | User |
| PUT | `/users/profile` | Update user profile | Yes | User |
| PUT | `/users/password` | Change password | Yes | User |
| DELETE | `/users/account` | Delete account | Yes | User |
| GET | `/users/:id` | Get user by ID | Yes | Admin |

**Example: Get Profile**
```bash
GET /api/v1/users/profile
Authorization: Bearer <accessToken>

Response:
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "isEmailVerified": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

#### URL Endpoints (`/api/v1/urls`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/urls` | Create shortened URL | Yes |
| GET | `/urls` | List user's URLs (paginated) | Yes |
| GET | `/urls/:id` | Get URL details | Yes |
| PUT | `/urls/:id` | Update URL | Yes |
| DELETE | `/urls/:id` | Delete URL | Yes |
| GET | `/urls/:id/analytics` | Get URL analytics | Yes |
| POST | `/urls/:id/qr` | Generate QR code | Yes |
| GET | `/:shortCode` | Redirect to original URL | No |

**Example: Create URL**
```bash
POST /api/v1/urls
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "originalUrl": "https://example.com/very/long/url",
  "customAlias": "my-link",  // Optional
  "title": "Example Page",   // Optional
  "tags": ["marketing"]      // Optional
}

Response:
{
  "success": true,
  "data": {
    "id": "objectId",
    "shortCode": "abc123",
    "shortUrl": "http://localhost:3000/abc123",
    "originalUrl": "https://example.com/very/long/url",
    "customAlias": "my-link",
    "title": "Example Page",
    "clicks": 0,
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**Example: List URLs**
```bash
GET /api/v1/urls?page=1&limit=10&sortBy=createdAt&order=desc
Authorization: Bearer <accessToken>

Response:
{
  "success": true,
  "data": {
    "urls": [...],
    "pagination": {
      "total": 45,
      "page": 1,
      "limit": 10,
      "pages": 5
    }
  }
}
```

**Example: Get Analytics**
```bash
GET /api/v1/urls/:id/analytics?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <accessToken>

Response:
{
  "success": true,
  "data": {
    "totalClicks": 1523,
    "uniqueVisitors": 892,
    "clicksByDate": [...],
    "topReferrers": [...],
    "deviceBreakdown": {
      "mobile": 45%,
      "desktop": 40%,
      "tablet": 15%
    },
    "geographicData": [...]
  }
}
```

#### Admin Endpoints (`/api/v1/admin`)

| Method | Endpoint | Description | Role Required |
|--------|----------|-------------|---------------|
| GET | `/admin/users` | List all users | Admin |
| GET | `/admin/users/:id` | Get user details | Admin |
| PUT | `/admin/users/:id` | Update user | Admin |
| DELETE | `/admin/users/:id` | Delete user | Admin |
| GET | `/admin/analytics` | System-wide analytics | Admin |
| GET | `/admin/audit-logs` | View audit logs | Admin |
| POST | `/admin/urls/:id/activate` | Activate URL | Admin |
| POST | `/admin/urls/:id/deactivate` | Deactivate URL | Admin |

### Response Format

All API responses follow a consistent format:

**Success Response:**
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful",  // Optional
  "meta": {                           // Optional
    "timestamp": "2024-01-01T00:00:00.000Z",
    "version": "1.0.0"
  }
}
```

**Error Response:**
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
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/api/v1/auth/register"
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

### Authentication

The API uses JWT Bearer tokens for authentication:

```bash
Authorization: Bearer <accessToken>
```

**Token Flow:**
1. Login/Register → Receive `accessToken` (15min) and `refreshToken` (7 days)
2. Include `accessToken` in Authorization header for authenticated requests
3. When `accessToken` expires (401 error), use `refreshToken` to get new tokens
4. If `refreshToken` expires, user must login again

**Refresh Token Example:**
```bash
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6..."
}

Response:
{
  "success": true,
  "data": {
    "accessToken": "new-access-token",
    "refreshToken": "new-refresh-token"
  }
}
```

### Rate Limiting

The API implements rate limiting to prevent abuse:

- **Global limit**: 1000 requests per 15 minutes per IP
- **Auth endpoints**: 5 requests per 15 minutes per IP
- **URL creation**: 100 requests per hour per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1640995200
```

When limit is exceeded:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later"
  },
  "statusCode": 429
}
```

## 🧪 Testing

### Running Tests

```bash
# Run all unit tests
npm run test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:cov

# Run E2E tests
npm run test:e2e

# Run production readiness tests
npm run test:prod-ready

# Run specific test file
npm test -- users.service.spec.ts

# Run tests with debugging
npm run test:debug
```

### Test Structure

The application has comprehensive test coverage:

**Unit Tests** (`*.spec.ts` files)
- Located next to source files
- Test individual functions and methods
- Mock dependencies
- Fast execution (~2-5 seconds)

Example:
```typescript
// users.service.spec.ts
describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  it('should create a user', async () => {
    const dto = { email: 'test@example.com', password: 'pass', name: 'Test' };
    const user = await service.create(dto);
    expect(user.email).toBe(dto.email);
  });
});
```

**Integration Tests** (in `test/` directory)
- Test module interactions
- Use test database
- Test with real database connections
- Slower execution (~10-30 seconds)

**E2E Tests** (`test/*.e2e-spec.ts` files)
- Test full HTTP request/response cycles
- Use Supertest for HTTP assertions
- Test entire application flow
- Includes authentication, authorization
- Execution time (~30-60 seconds)

Example:
```typescript
// auth.e2e-spec.ts
describe('Authentication (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api/v1/auth/register (POST)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'test@example.com',
        password: 'SecurePass123!',
        name: 'Test User',
      })
      .expect(201)
      .expect((res) => {
        expect(res.body.success).toBe(true);
        expect(res.body.data.accessToken).toBeDefined();
      });
  });
});
```

### Test Coverage

The project maintains >80% code coverage:

```bash
# Generate coverage report
npm run test:cov

# View coverage report
open coverage/lcov-report/index.html
```

Coverage includes:
- Statements: >85%
- Branches: >80%
- Functions: >85%
- Lines: >85%

### Testing Best Practices

1. **Write tests first** (TDD approach recommended)
2. **Test behavior, not implementation**
3. **Use meaningful test descriptions**
4. **Mock external dependencies**
5. **Keep tests independent**
6. **Use test factories** for data generation
7. **Test error cases** as well as success cases

## 📦 Dependencies

### Production Dependencies

| Package | Version | Purpose | Why Chosen |
|---------|---------|---------|------------|
| `@nestjs/common` | ^10.0.0 | Core NestJS framework | Modern architecture, dependency injection, modular design |
| `@nestjs/core` | ^10.0.0 | NestJS core functionality | Required for NestJS apps |
| `@nestjs/platform-express` | ^10.0.0 | Express adapter for NestJS | Production-tested HTTP server |
| `@nestjs/config` | ^3.1.1 | Configuration management | Type-safe env variables, validation |
| `@nestjs/typeorm` | ^10.0.0 | TypeORM integration | PostgreSQL ORM with migrations |
| `@nestjs/mongoose` | ^10.0.2 | Mongoose integration | MongoDB object modeling |
| `@nestjs/jwt` | ^10.2.0 | JWT utilities | Token generation and verification |
| `@nestjs/passport` | ^10.0.2 | Passport.js integration | Authentication strategies |
| `@nestjs/swagger` | ^7.1.17 | OpenAPI/Swagger documentation | Auto-generated API docs |
| `@nestjs/throttler` | ^5.0.1 | Rate limiting | DDoS protection, API abuse prevention |
| `@nestjs/schedule` | ^4.0.0 | Task scheduling | Cron jobs, intervals |

#### Database & ORM

| Package | Version | Purpose |
|---------|---------|---------|
| `typeorm` | ^0.3.17 | PostgreSQL ORM with migrations and entity management |
| `pg` | ^8.11.3 | PostgreSQL client library |
| `mongoose` | ^8.0.3 | MongoDB object modeling with schema validation |
| `ioredis` | ^5.3.2 | Redis client with cluster support and pipelining |
| `redis` | ^4.6.10 | Redis client alternative |

#### Authentication & Security

| Package | Version | Purpose |
|---------|---------|---------|
| `passport` | ^0.7.0 | Authentication middleware |
| `passport-jwt` | ^4.0.1 | JWT authentication strategy |
| `passport-local` | ^1.0.0 | Local (email/password) strategy |
| `passport-headerapikey` | ^1.2.2 | API key authentication |
| `bcrypt` | ^5.1.1 | Password hashing (12+ salt rounds) |
| `helmet` | ^7.1.0 | Security headers (CSP, HSTS, etc.) |
| `class-validator` | ^0.14.0 | DTO validation with decorators |
| `class-transformer` | ^0.5.1 | Object transformation and serialization |

#### Utilities

| Package | Version | Purpose |
|---------|---------|---------|
| `nanoid` | ^5.0.4 | Unique ID generation for short codes (URL-safe, collision-resistant) |
| `uuid` | ^9.0.1 | UUID generation for primary keys |
| `nodemailer` | ^7.0.9 | Email sending via SMTP |
| `compression` | ^1.7.4 | Response compression (gzip/deflate) |
| `winston` | ^3.11.0 | Logging with multiple transports |
| `winston-cloudwatch` | ^6.3.0 | CloudWatch logging integration |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@nestjs/cli` | ^10.0.0 | NestJS command-line tools (generate, build) |
| `@nestjs/schematics` | ^10.0.0 | Code generation schematics |
| `@nestjs/testing` | ^10.0.0 | Testing utilities for NestJS |
| `jest` | ^29.5.0 | Testing framework |
| `ts-jest` | ^29.1.0 | TypeScript preprocessor for Jest |
| `supertest` | ^6.3.3 | HTTP assertion library for E2E tests |
| `testcontainers` | ^10.4.0 | Docker containers for integration tests |
| `@typescript-eslint/eslint-plugin` | ^6.0.0 | TypeScript ESLint rules |
| `@typescript-eslint/parser` | ^6.0.0 | TypeScript parser for ESLint |
| `eslint` | ^8.42.0 | Code linting |
| `prettier` | ^3.0.0 | Code formatting |
| `husky` | ^8.0.3 | Git hooks (pre-commit, pre-push) |
| `lint-staged` | ^15.2.0 | Run linters on staged files |
| `ts-node` | ^10.9.1 | TypeScript execution environment |
| `typescript` | ^5.1.3 | TypeScript compiler |
| `axios` | ^1.6.2 | HTTP client for testing |
| `colors` | ^1.4.0 | Terminal colors for scripts |

### Why These Dependencies?

**NestJS Ecosystem**: Provides enterprise-grade architecture with dependency injection, modularity, and TypeScript support out of the box.

**TypeORM**: Chosen over Prisma for mature migration system, better TypeScript support, and excellent PostgreSQL features.

**Mongoose**: Industry standard for MongoDB with flexible schema validation and middleware support.

**ioredis**: Faster and more feature-rich than node-redis, with better TypeScript support and cluster capabilities.

**bcrypt**: Industry standard for password hashing, resistant to brute-force attacks with configurable work factor.

**Passport.js**: Flexible authentication with 500+ strategies available. Well-maintained and battle-tested.

**nanoid**: Faster and smaller than UUID, optimized for URL-safe short codes. ~40% faster than UUID v4.

**Winston**: Production-grade logging with multiple transports, log levels, and CloudWatch integration.

**Jest**: Fast, parallel test execution with excellent TypeScript support and snapshot testing.

**Testcontainers**: Enables testing with real databases in Docker containers, ensuring test reliability.

## 🔧 Development Commands

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Building
npm run build              # Build for production
npm run start:prod         # Start production build

# Code Quality
npm run lint               # Run ESLint
npm run format             # Format code with Prettier

# Database
npm run migration:generate # Generate new migration
npm run migration:run      # Run migrations
npm run migration:revert   # Revert last migration
```

## 📁 Project Structure

### Complete Folder Hierarchy

```
nestjs-backend/
├── src/
│   ├── common/                      # Shared utilities and cross-cutting concerns
│   │   ├── decorators/             # Custom decorators
│   │   │   ├── roles.decorator.ts  # @Roles() - Role-based access control
│   │   │   ├── public.decorator.ts # @Public() - Skip JWT auth
│   │   │   └── user.decorator.ts   # @CurrentUser() - Extract user from request
│   │   ├── filters/                # Exception filters
│   │   │   ├── http-exception.filter.ts    # Global HTTP exception handler
│   │   │   └── validation-exception.filter.ts  # Validation error formatter
│   │   ├── guards/                 # Guards for route protection
│   │   │   ├── jwt-auth.guard.ts   # JWT authentication guard
│   │   │   ├── roles.guard.ts      # Role authorization guard
│   │   │   └── throttle.guard.ts   # Rate limiting guard
│   │   ├── interceptors/           # Request/response interceptors
│   │   │   ├── logging.interceptor.ts      # Request/response logging
│   │   │   ├── timeout.interceptor.ts      # Request timeout handling
│   │   │   └── transform.interceptor.ts    # Response transformation
│   │   ├── pipes/                  # Validation pipes
│   │   │   └── validation.pipe.ts  # Global validation pipe
│   │   └── utils/                  # Utility functions
│   │       ├── hash.util.ts        # Password hashing utilities
│   │       ├── email.util.ts       # Email sending utilities
│   │       └── response.util.ts    # Standard response formatters
│   │
│   ├── config/                     # Configuration modules
│   │   ├── app.config.ts          # Application configuration
│   │   ├── database.config.ts     # PostgreSQL configuration
│   │   ├── mongodb.config.ts      # MongoDB configuration
│   │   ├── redis.config.ts        # Redis configuration
│   │   ├── jwt.config.ts          # JWT configuration
│   │   ├── email.config.ts        # Email/SMTP configuration
│   │   └── cache.config.ts        # Cache configuration
│   │
│   ├── modules/                    # Feature modules
│   │   ├── auth/                   # Authentication module
│   │   │   ├── dto/                # Data Transfer Objects
│   │   │   │   ├── login.dto.ts    # Login request DTO
│   │   │   │   ├── register.dto.ts # Registration request DTO
│   │   │   │   └── token.dto.ts    # Token response DTO
│   │   │   ├── strategies/         # Passport strategies
│   │   │   │   ├── jwt.strategy.ts # JWT authentication strategy
│   │   │   │   └── local.strategy.ts # Local (email/pass) strategy
│   │   │   ├── guards/             # Auth-specific guards
│   │   │   │   └── local-auth.guard.ts
│   │   │   ├── auth.controller.ts  # Auth endpoints (/login, /register, etc.)
│   │   │   ├── auth.service.ts     # Auth business logic
│   │   │   ├── auth.service.spec.ts # Auth service unit tests
│   │   │   └── auth.module.ts      # Auth module definition
│   │   │
│   │   ├── users/                  # User management module
│   │   │   ├── entities/           # TypeORM entities
│   │   │   │   └── user.entity.ts  # User database entity
│   │   │   ├── dto/                # DTOs
│   │   │   │   ├── create-user.dto.ts
│   │   │   │   ├── update-user.dto.ts
│   │   │   │   └── user-response.dto.ts
│   │   │   ├── users.controller.ts # User endpoints
│   │   │   ├── users.service.ts    # User business logic
│   │   │   ├── users.service.spec.ts # Unit tests
│   │   │   ├── users.repository.ts # User repository
│   │   │   └── users.module.ts     # Users module
│   │   │
│   │   ├── urls/                   # URL shortening module
│   │   │   ├── schemas/            # Mongoose schemas
│   │   │   │   ├── url.schema.ts   # URL MongoDB schema
│   │   │   │   └── click.schema.ts # Click tracking schema
│   │   │   ├── dto/                # DTOs
│   │   │   │   ├── create-url.dto.ts    # Create short URL DTO
│   │   │   │   ├── update-url.dto.ts    # Update URL DTO
│   │   │   │   └── url-response.dto.ts  # URL response DTO
│   │   │   ├── urls.controller.ts  # URL endpoints
│   │   │   ├── urls.service.ts     # URL business logic
│   │   │   ├── urls.service.spec.ts # Unit tests
│   │   │   └── urls.module.ts      # URLs module
│   │   │
│   │   └── admin/                  # Admin module
│   │       ├── admin.controller.ts # Admin endpoints
│   │       ├── admin.service.ts    # Admin business logic
│   │       └── admin.module.ts     # Admin module
│   │
│   ├── migrations/                 # TypeORM database migrations
│   │   ├── 1234567890-CreateUsersTable.ts
│   │   └── 1234567891-AddRolesTable.ts
│   │
│   ├── app.controller.ts           # Root controller (health check, etc.)
│   ├── app.service.ts              # Root service
│   ├── app.module.ts               # Root application module
│   └── main.ts                     # Application entry point (bootstrap)
│
├── test/                           # E2E tests
│   ├── app.e2e-spec.ts            # App-level E2E tests
│   ├── auth.e2e-spec.ts           # Auth E2E tests
│   ├── urls.e2e-spec.ts           # URLs E2E tests
│   └── jest-e2e.json              # E2E Jest configuration
│
├── docs/                           # Additional documentation
│   ├── MIGRATION_GUIDE.md         # Express to NestJS migration guide
│   ├── DEPLOYMENT_RUNBOOK.md      # Deployment procedures
│   └── PERFORMANCE_OPTIMIZATION.md # Performance tuning guide
│
├── scripts/                        # Utility scripts
│   ├── seed.ts                    # Database seeding
│   └── migrate.ts                 # Migration runner
│
├── .env.example                    # Environment variables template
├── .env.production                 # Production env template
├── .eslintrc.js                   # ESLint configuration
├── .prettierrc                    # Prettier configuration
├── .gitignore                     # Git ignore patterns
├── .dockerignore                  # Docker ignore patterns
├── nest-cli.json                  # NestJS CLI configuration
├── tsconfig.json                  # TypeScript configuration
├── tsconfig.build.json            # Build-specific TS config
├── package.json                   # Dependencies and scripts
├── Dockerfile                     # Production Docker image
├── docker-compose.yml             # Full stack Docker Compose
├── docker-compose.dev.yml         # Dev databases only
├── README.md                      # This file
├── PRODUCTION_READINESS.md        # Production readiness guide
└── DEPLOYMENT_CHECKLIST.md        # Deployment checklist
```

### Key Directory Purposes

**`src/common/`**: Shared code used across multiple modules
- **decorators**: Custom TypeScript decorators for metadata
- **filters**: Exception/error handling logic
- **guards**: Authorization and authentication logic
- **interceptors**: Request/response transformation
- **pipes**: Input validation and transformation
- **utils**: Helper functions

**`src/config/`**: Configuration modules using @nestjs/config
- All config loaded from environment variables
- Type-safe configuration objects
- Validation on application startup

**`src/modules/`**: Feature modules (self-contained business logic)
- Each module has its own controller, service, DTOs, and tests
- Modules are loosely coupled via dependency injection
- Follow NestJS module architecture

**`src/migrations/`**: TypeORM database migrations
- Version-controlled schema changes
- Run with `npm run migration:run`
- Reversible with `npm run migration:revert`

**`test/`**: End-to-end tests using Supertest
- Test full request/response cycles
- Uses test database (separate from development)
- Run with `npm run test:e2e`

## 📊 Database Architecture

### Hybrid Database Strategy

The application uses three databases, each optimized for its specific use case:

#### 1. PostgreSQL (Relational - User Data)

**Purpose**: User management, authentication, and transactional data

**Schema:**
```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  is_email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  password_reset_token VARCHAR(255),
  password_reset_expires TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
```

**Why PostgreSQL?**
- ACID compliance for user data integrity
- Complex queries with JOINs for relationships
- Excellent support for UUID primary keys
- Robust transaction support
- TypeORM provides excellent migration support

#### 2. MongoDB (Document - URL & Analytics)

**Purpose**: URL storage and click analytics

**Collections:**

**urls collection:**
```javascript
{
  _id: ObjectId("..."),
  shortCode: "abc123",        // Unique short code
  originalUrl: "https://example.com/very/long/url",
  userId: "uuid-here",        // Reference to PostgreSQL user
  customAlias: "my-link",     // Optional custom alias
  title: "Example Website",
  description: "Website description",
  clicks: 1523,               // Denormalized click count
  isActive: true,
  expiresAt: ISODate("2024-12-31"),
  createdAt: ISODate("2024-01-01"),
  updatedAt: ISODate("2024-01-15"),
  tags: ["marketing", "campaign"],
  metadata: {
    favicon: "https://example.com/favicon.ico",
    ogImage: "https://example.com/og-image.jpg"
  }
}
```

**clicks collection (Analytics):**
```javascript
{
  _id: ObjectId("..."),
  urlId: ObjectId("..."),     // Reference to urls collection
  shortCode: "abc123",
  timestamp: ISODate("2024-01-15T10:30:00Z"),
  referrer: "https://google.com",
  userAgent: "Mozilla/5.0...",
  ip: "192.168.1.1",
  country: "US",
  city: "New York",
  device: "mobile",
  browser: "Chrome",
  os: "Android"
}
```

**Indexes:**
```javascript
// URLs collection
db.urls.createIndex({ shortCode: 1 }, { unique: true });
db.urls.createIndex({ userId: 1 });
db.urls.createIndex({ customAlias: 1 }, { sparse: true, unique: true });
db.urls.createIndex({ createdAt: -1 });

// Clicks collection
db.clicks.createIndex({ urlId: 1, timestamp: -1 });
db.clicks.createIndex({ shortCode: 1 });
db.clicks.createIndex({ timestamp: -1 });
```

**Why MongoDB?**
- High-write throughput for click tracking
- Flexible schema for analytics data
- Excellent aggregation pipeline for analytics
- No foreign key constraints needed
- Horizontal scaling capability

#### 3. Redis (Key-Value - Caching)

**Purpose**: Caching and session management

**Cache Keys:**
```
url:shortCode:abc123 → Full URL object (TTL: 1 hour)
user:session:uuid → User session data (TTL: 15 min)
analytics:daily:abc123 → Daily analytics (TTL: 5 min)
rate-limit:ip:192.168.1.1 → Rate limit counter (TTL: 15 min)
popular:urls → Sorted set of popular URLs (TTL: 30 min)
```

**Why Redis?**
- Sub-millisecond read latency
- Reduces database load for frequent reads
- Perfect for rate limiting with atomic operations
- Pub/sub for real-time features
- TTL support for automatic expiration

## 🔒 Security Features

### Authentication & Authorization

**JWT-Based Authentication**
- Access tokens: 15-minute expiry
- Refresh tokens: 7-day expiry
- Secure token storage in HTTP-only cookies (optional)
- Automatic token refresh on client
- Token blacklisting on logout

**Role-Based Access Control (RBAC)**
```typescript
// Roles: user, admin, superadmin
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Get('admin/users')
async getUsers() {
  // Only admins can access
}
```

**Custom Decorators for Auth**
```typescript
@Public()  // Skip authentication
@CurrentUser()  // Get current user from request
@Roles('admin', 'user')  // Require specific roles
```

### Input Validation

**class-validator Decorators**
```typescript
export class CreateUrlDto {
  @IsUrl()
  @IsNotEmpty()
  originalUrl: string;

  @IsOptional()
  @IsString()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9-_]+$/)
  customAlias?: string;
}
```

**Validation Pipe** (Global)
- Automatically validates all DTOs
- Transforms and sanitizes input
- Returns detailed validation errors
- Strips unknown properties (whitelist: true)

### Password Security

**bcrypt Hashing**
- 12 salt rounds (configurable)
- Async hashing to prevent blocking
- Unique salt per password
- Resistant to rainbow table attacks

```typescript
// Password hashing
const hashedPassword = await bcrypt.hash(password, 12);

// Password verification
const isValid = await bcrypt.compare(password, hashedPassword);
```

**Password Requirements**
- Minimum 8 characters
- Must include uppercase, lowercase, number
- Must include special character
- Validated on client and server

### Rate Limiting

**@nestjs/throttler** with Redis storage

**Global Rate Limits:**
```typescript
@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 900,  // 15 minutes
      limit: 1000,  // 1000 requests
    }),
  ],
})
```

**Endpoint-Specific Limits:**
```typescript
@Throttle(5, 900)  // 5 requests per 15 minutes
@Post('auth/login')
async login() { }

@Throttle(100, 3600)  // 100 requests per hour
@Post('urls')
async createUrl() { }
```

**Rate Limit Response:**
```json
{
  "statusCode": 429,
  "message": "ThrottlerException: Too Many Requests"
}
```

### Security Headers

**Helmet.js Configuration**
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
}));
```

**Headers Applied:**
- `Content-Security-Policy`: XSS protection
- `Strict-Transport-Security`: HTTPS enforcement
- `X-Frame-Options`: Clickjacking protection
- `X-Content-Type-Options`: MIME sniffing protection
- `X-XSS-Protection`: Legacy XSS protection

### CORS Configuration

```typescript
app.enableCors({
  origin: (origin, callback) => {
    const whitelist = process.env.FRONTEND_URL.split(',');
    if (whitelist.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

### SQL Injection Protection

- All queries use parameterized statements via TypeORM
- Never concatenate user input into queries
- Input validation before database operations

```typescript
// Safe (parameterized)
await userRepository.findOne({ where: { email } });

// UNSAFE (never do this)
await userRepository.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### XSS Protection

- All output is automatically escaped by React/Next.js
- Input sanitization with class-validator
- Content-Security-Policy headers
- No `eval()` or `innerHTML` usage

### Additional Security Measures

**API Key Authentication**
```typescript
@UseGuards(HeaderApiKeyGuard)
@Get('external/data')
async getExternalData() {
  // Requires X-API-Key header
}
```

**Request Logging**
- All requests logged with correlation IDs
- IP address tracking
- User agent logging
- Request timing

**Error Handling**
- Never expose stack traces in production
- Generic error messages to clients
- Detailed errors logged server-side
- Correlation IDs for error tracking

## 📊 Monitoring & Logging

### Winston Logging

**Log Levels:**
- `error`: Errors and exceptions
- `warn`: Warnings
- `info`: General information
- `http`: HTTP requests
- `debug`: Debug information

**Log Format:**
```json
{
  "level": "info",
  "message": "User registered",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "correlationId": "uuid",
  "userId": "uuid",
  "context": "AuthService",
  "metadata": {
    "email": "user@example.com"
  }
}
```

**Transports:**
- Console (development)
- File (production)
- CloudWatch (production)

**Configuration:**
```typescript
WinstonModule.forRoot({
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, context }) => {
          return `${timestamp} [${context}] ${level}: ${message}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
});
```

### Health Checks

**Health Endpoint** (`/health`)
```json
{
  "status": "ok",
  "info": {
    "database": {
      "status": "up",
      "responseTime": "5ms"
    },
    "mongodb": {
      "status": "up",
      "responseTime": "3ms"
    },
    "redis": {
      "status": "up",
      "responseTime": "1ms"
    }
  },
  "error": {},
  "details": {
    "database": {
      "status": "up",
      "responseTime": "5ms"
    },
    "mongodb": {
      "status": "up",
      "responseTime": "3ms"
    },
    "redis": {
      "status": "up",
      "responseTime": "1ms"
    }
  }
}
```

**Health Checks Include:**
- Database connectivity
- MongoDB connectivity
- Redis connectivity
- Disk space
- Memory usage
- Response time

### Performance Monitoring

**Metrics Collected:**
- Request latency (p50, p95, p99)
- Requests per second
- Error rate
- Database query time
- Cache hit/miss rate
- Memory usage
- CPU usage

**Logging Interceptor:**
```typescript
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const responseTime = Date.now() - now;
        this.logger.log(`${method} ${url} ${responseTime}ms`);
      }),
    );
  }
}
```

### Error Tracking

**Error Logging:**
```typescript
try {
  // Business logic
} catch (error) {
  this.logger.error('Failed to create URL', {
    error: error.message,
    stack: error.stack,
    userId: user.id,
    correlationId: req.correlationId,
  });
  throw new InternalServerErrorException('Failed to create URL');
}
```

**Correlation IDs:**
- Unique ID per request
- Tracked across all logs
- Included in error responses
- Useful for debugging

## 🐛 Troubleshooting

### Common Issues

#### 1. Database Connection Errors

**Error: `connect ECONNREFUSED localhost:5432`**

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Start PostgreSQL
sudo systemctl start postgresql

# Check connection
psql -U postgres -h localhost -p 5432
```

**Error: `authentication failed for user`**

- Check DATABASE_URL in .env
- Verify username/password
- Check pg_hba.conf for authentication method

#### 2. MongoDB Connection Errors

**Error: `MongoNetworkError: failed to connect`**

```bash
# Check if MongoDB is running
sudo systemctl status mongod

# Start MongoDB
sudo systemctl start mongod

# Check connection
mongosh mongodb://localhost:27017
```

#### 3. Redis Connection Errors

**Error: `Redis connection to localhost:6379 failed`**

```bash
# Check if Redis is running
redis-cli ping

# Start Redis
redis-server

# Or with systemd
sudo systemctl start redis
```

#### 4. Port Already in Use

**Error: `EADDRINUSE: address already in use :::3000`**

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use different port
PORT=3001 npm run start:dev
```

#### 5. Migration Errors

**Error: `QueryFailedError: relation does not exist`**

```bash
# Run migrations
npm run migration:run

# If migrations fail, revert and retry
npm run migration:revert
npm run migration:run
```

#### 6. JWT Token Errors

**Error: `JsonWebTokenError: invalid signature`**

- Check JWT_SECRET matches between services
- Verify token hasn't expired
- Check token format (Bearer <token>)

#### 7. Email Sending Errors

**Error: `Invalid login: 535-5.7.8 Username and Password not accepted`**

For Gmail:
1. Enable 2-factor authentication
2. Generate app password
3. Use app password in EMAIL_PASS

#### 8. Environment Variable Issues

```bash
# Validate environment variables
npm run validate:env

# Check loaded environment
console.log(process.env.DATABASE_URL);
```

### Debug Mode

```bash
# Start with debug logging
NODE_ENV=development npm run start:dev

# Enable TypeScript source maps
npm run start:debug

# Attach debugger (VS Code)
# Add breakpoints and press F5
```

### Performance Issues

**Slow API responses:**

1. Check database query performance:
```bash
# PostgreSQL: Enable query logging
ALTER DATABASE url_shortener SET log_statement = 'all';

# MongoDB: Enable profiling
db.setProfilingLevel(2);
```

2. Check Redis cache hit rate:
```bash
redis-cli INFO stats | grep hit_rate
```

3. Analyze slow queries:
```bash
# PostgreSQL
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;
```

### Memory Leaks

```bash
# Monitor memory usage
node --inspect dist/main.js

# Use Chrome DevTools
# Navigate to chrome://inspect
# Take heap snapshots and compare
```

### Getting Help

1. Check application logs:
```bash
tail -f logs/combined.log
tail -f logs/error.log
```

2. Check database logs:
```bash
# PostgreSQL
tail -f /var/log/postgresql/postgresql-15-main.log

# MongoDB
tail -f /var/log/mongodb/mongod.log
```

3. Enable verbose logging:
```bash
LOG_LEVEL=debug npm run start:dev
```

4. Create an issue with:
   - Error message and stack trace
   - Steps to reproduce
   - Environment details
   - Relevant logs

## 🚀 Building & Deployment

### Local Production Build

```bash
# Install production dependencies only
npm ci --only=production

# Build the application
npm run build

# The compiled output is in dist/ directory

# Start production server
NODE_ENV=production npm run start:prod
```

### Docker Deployment

#### Production Dockerfile

The project includes a multi-stage Dockerfile for optimized production builds:

```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:18-alpine AS production
WORKDIR /app
ENV NODE_ENV production
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
```

**Build and Run:**
```bash
# Build production image
docker build -t snapurl-backend:latest .

# Run container
docker run -d \
  --name snapurl-api \
  -p 3000:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  snapurl-backend:latest

# View logs
docker logs -f snapurl-api

# Stop container
docker stop snapurl-api

# Remove container
docker rm snapurl-api
```

#### Docker Compose Production

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
    env_file:
      - .env.production
    depends_on:
      - postgres
      - mongo
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: url_shortener
      POSTGRES_USER: ${DATABASE_USERNAME}
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  mongo:
    image: mongo:6
    environment:
      MONGO_INITDB_DATABASE: url_shortener
    volumes:
      - mongo_data:/data/db
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  mongo_data:
  redis_data:
```

**Deploy with Docker Compose:**
```bash
# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Scale the application
docker-compose -f docker-compose.prod.yml up -d --scale app=3

# View logs
docker-compose logs -f app

# Stop all services
docker-compose -f docker-compose.prod.yml down
```

### Cloud Deployment

#### AWS EC2

1. **Launch EC2 instance** (Ubuntu 22.04 LTS, t3.medium)

2. **Install dependencies:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose -y
```

3. **Clone and setup:**
```bash
git clone https://github.com/your-repo/URL-Shortener-App.git
cd URL-Shortener-App/nestjs-backend
npm install
cp .env.example .env.production
nano .env.production  # Edit with production values
```

4. **Run with PM2:**
```bash
# Install PM2
npm install -g pm2

# Build application
npm run build

# Start with PM2
pm2 start dist/main.js --name snapurl-api

# Setup auto-restart on reboot
pm2 startup
pm2 save

# View logs
pm2 logs snapurl-api
```

5. **Setup Nginx reverse proxy:**
```nginx
# /etc/nginx/sites-available/snapurl
server {
    listen 80;
    server_name api.snapurl.in;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/snapurl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Setup SSL with Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.snapurl.in
```

#### Heroku

```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login
heroku login

# Create app
heroku create snapurl-api

# Add Heroku Postgres
heroku addons:create heroku-postgresql:hobby-dev

# Add MongoDB Atlas (or mLab)
# Configure MONGODB_URI in Heroku config vars

# Add Redis
heroku addons:create heroku-redis:hobby-dev

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your-secret
# ... set other variables

# Deploy
git push heroku main

# View logs
heroku logs --tail
```

#### DigitalOcean App Platform

```yaml
# .do/app.yaml
name: snapurl-api
services:
  - name: api
    github:
      repo: your-username/URL-Shortener-App
      branch: main
      deploy_on_push: true
    build_command: cd nestjs-backend && npm run build
    run_command: cd nestjs-backend && npm run start:prod
    environment_slug: node-js
    instance_count: 2
    instance_size_slug: basic-xs
    http_port: 3000
    envs:
      - key: NODE_ENV
        value: production
      - key: DATABASE_URL
        type: SECRET
      - key: JWT_SECRET
        type: SECRET

databases:
  - name: postgres
    engine: PG
    version: "15"
  - name: mongodb
    engine: MONGODB
    version: "6"
  - name: redis
    engine: REDIS
    version: "7"
```

```bash
# Deploy
doctl apps create --spec .do/app.yaml

# Update
doctl apps update <app-id> --spec .do/app.yaml
```

### Deployment Checklist

Before deploying to production:

- [ ] Update all environment variables in `.env.production`
- [ ] Set strong JWT secrets (minimum 32 characters)
- [ ] Configure production database URLs
- [ ] Set BCRYPT_SALT_ROUNDS to 14 or higher
- [ ] Configure email service (SendGrid, AWS SES, etc.)
- [ ] Set FRONTEND_URL to production URL
- [ ] Enable HTTPS/SSL certificates
- [ ] Run database migrations: `npm run migration:run`
- [ ] Build application: `npm run build`
- [ ] Test production build locally: `npm run start:prod`
- [ ] Run production readiness tests: `npm run test:prod-ready`
- [ ] Setup monitoring and logging (CloudWatch, DataDog, etc.)
- [ ] Configure error tracking (Sentry, Rollbar, etc.)
- [ ] Setup automated backups for databases
- [ ] Configure firewall rules (allow only necessary ports)
- [ ] Setup load balancer (if multiple instances)
- [ ] Configure auto-scaling policies
- [ ] Document deployment procedures
- [ ] Setup CI/CD pipeline
- [ ] Test all critical endpoints
- [ ] Monitor initial deployment closely

### CI/CD Pipeline

Example GitHub Actions workflow:

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd nestjs-backend && npm ci
      - run: cd nestjs-backend && npm run test
      - run: cd nestjs-backend && npm run test:e2e

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd nestjs-backend && npm ci
      - run: cd nestjs-backend && npm run build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to AWS EC2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: |
          # SSH into EC2 and pull latest code
          # Run deployment script
```

### Production Monitoring

**Essential Metrics to Monitor:**
- Response time (p50, p95, p99)
- Error rate
- Request rate
- Database query time
- Cache hit rate
- Memory usage
- CPU usage
- Disk space

**Setup Alerts For:**
- High error rate (>1%)
- Slow response time (>1s p95)
- High memory usage (>80%)
- Database connection errors
- Redis connection errors
- Failed health checks

## 🤝 Contributing

We welcome contributions from the community! Here's how you can help:

### Development Process

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/URL-Shortener-App.git
   cd URL-Shortener-App/nestjs-backend
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```
5. **Make your changes** and ensure:
   - Code follows TypeScript and ESLint conventions
   - All tests pass: `npm test`
   - New features have tests
   - Documentation is updated
6. **Commit your changes**:
   ```bash
   git commit -m 'feat: add amazing feature'
   ```
   Follow [Conventional Commits](https://www.conventionalcommits.org/)
7. **Push to your fork**:
   ```bash
   git push origin feature/amazing-feature
   ```
8. **Open a Pull Request** on GitHub

### Commit Message Convention

Use semantic commit messages:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Test additions or fixes
- `chore:` Build process or auxiliary tool changes

Examples:
```
feat: add QR code generation endpoint
fix: resolve memory leak in URL caching
docs: update API documentation
test: add integration tests for auth module
```

### Code Style Guidelines

**TypeScript:**
- Use TypeScript for all new code
- Enable strict mode
- Define proper interfaces and types
- Avoid `any` type
- Use async/await over promises

**NestJS:**
- Follow module-based architecture
- Use dependency injection
- Implement proper error handling
- Use DTOs for validation
- Add Swagger decorators

**Testing:**
- Write unit tests for services
- Write E2E tests for controllers
- Aim for >80% coverage
- Mock external dependencies
- Use descriptive test names

**Naming:**
- PascalCase for classes/interfaces
- camelCase for variables/functions
- UPPER_CASE for constants
- Descriptive names, avoid abbreviations

### Pull Request Checklist

Before submitting a PR, ensure:

- [ ] Code follows project conventions
- [ ] All tests pass locally
- [ ] New tests added for new features
- [ ] Documentation updated
- [ ] No console.log statements
- [ ] No commented-out code
- [ ] Commit messages follow convention
- [ ] PR description explains changes
- [ ] Screenshots included (if UI changes)
- [ ] Breaking changes documented

### Getting Help

- Join our [Discord community](https://discord.gg/snapurl)
- Read the [documentation](https://docs.snapurl.in)
- Check existing [issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- Ask questions in [Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

## 📚 Additional Documentation

- [Production Readiness Guide](./PRODUCTION_READINESS.md) - Complete production testing
- [Deployment Checklist](./DEPLOYMENT_CHECKLIST.md) - Pre-deployment checklist
- [Migration Guide](./docs/MIGRATION_GUIDE.md) - Express to NestJS migration
- [Deployment Runbook](./docs/DEPLOYMENT_RUNBOOK.md) - Operations procedures
- [Performance Optimization](./docs/PERFORMANCE_OPTIMIZATION.md) - Performance tuning
- [API Reference](http://localhost:3000/docs) - Interactive API documentation

## 🆘 Support

For support and questions:

- **Issues**: [Create an issue](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- **Discussions**: [Join discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
- **Email**: support@snapurl.in
- **API Docs**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Main Documentation**: [../README.md](../README.md)

---

**Note for AI Coding Tools**: This documentation is optimized for AI understanding. Key conventions:
- All file paths are absolute from project root
- Environment variables explicitly documented with types and defaults
- API endpoints include full request/response examples with curl commands
- Database schemas include SQL/NoSQL examples
- Common issues have specific solutions with exact commands
- No assumptions about implicit behavior or "standard" configurations
- All dependencies listed with versions and purposes
- Architecture decisions documented with rationale