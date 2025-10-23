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

The API documentation is automatically generated using Swagger/OpenAPI and is available at:
- **Development**: http://localhost:3000/docs
- **Production**: https://your-domain.com/docs

### Key Endpoints

- `GET /` - Health check
- `GET /health` - Detailed health information
- `POST /api/v1/auth/login` - User authentication
- `POST /api/v1/urls` - Create short URL
- `GET /api/v1/urls` - List user URLs
- `GET /:shortCode` - Redirect to original URL

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

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
│   ├── urls/              # URL shortening module
│   ├── admin/             # Admin functionality
│   ├── analytics/         # Analytics and reporting
│   └── domains/           # Custom domain management
├── app.module.ts          # Root application module
└── main.ts                # Application entry point
```

## 🔒 Security Features

- **JWT Authentication** with refresh tokens
- **Role-Based Access Control** (RBAC)
- **Rate Limiting** with Redis backend
- **Input Validation** and sanitization
- **Password Hashing** with bcrypt (12+ salt rounds)
- **Security Headers** with Helmet.js
- **CORS Configuration** with domain whitelisting
- **API Key Authentication** for external integrations

## 📊 Monitoring & Logging

- **Structured Logging** with Winston
- **Health Check Endpoints** for application and databases
- **Metrics Collection** (Prometheus compatible)
- **Request/Response Logging** with correlation IDs
- **Error Tracking** and alerting
- **Performance Monitoring**

## 🚀 Deployment

### Production Build

```bash
# Build the application
npm run build

# Start production server
npm run start:prod
```

### Docker Production

```bash
# Build production image
docker build -t nestjs-url-shortener .

# Run production container
docker run -p 3000:3000 --env-file .env.production nestjs-url-shortener
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the [API documentation](http://localhost:3000/docs)
- Review the [troubleshooting guide](docs/troubleshooting.md)