# NestJS URL Shortener

Enterprise-grade URL shortener built with NestJS v10, featuring hybrid database architecture, comprehensive security, and advanced monitoring capabilities.

## 🎉 Migration Complete - Production Ready!

This application has been successfully migrated from Express.js to NestJS and is fully production-ready:

- ✅ **Complete NestJS v10 Implementation** - Modern TypeScript architecture
- ✅ **Hybrid Database Architecture** - PostgreSQL + MongoDB + Redis
- ✅ **Enterprise Security** - JWT authentication, RBAC, rate limiting
- ✅ **High Performance** - Multi-level caching, optimized queries
- ✅ **Comprehensive Testing** - Unit, integration, and E2E tests
- ✅ **Production Monitoring** - Health checks, metrics, logging
- ✅ **Complete Documentation** - API docs, deployment guides
- ✅ **Docker Ready** - Multi-stage builds, production optimized

## 🚀 Features

- **Modern Architecture**: Built with NestJS v10 and TypeScript
- **Hybrid Database**: PostgreSQL for user data, MongoDB for URLs and analytics
- **Enterprise Security**: JWT authentication, RBAC, rate limiting, input validation
- **High Performance**: Redis caching, connection pooling, response optimization
- **Comprehensive Monitoring**: Winston logging, health checks, metrics collection
- **Developer Experience**: Hot reloading, comprehensive testing, API documentation
- **Production Ready**: Docker support, CI/CD ready, graceful shutdown

## 🛠️ Technology Stack

### Core
- **NestJS v10** - Progressive Node.js framework
- **TypeScript** - Type-safe JavaScript
- **Node.js v18+** - Runtime environment

### Databases
- **PostgreSQL 15** - User management and authentication
- **MongoDB 6** - URL data and analytics
- **Redis 7** - Caching and session storage

### Security & Authentication
- **Passport.js** - Authentication strategies
- **JWT** - Token-based authentication
- **bcrypt** - Password hashing
- **Helmet.js** - Security headers
- **class-validator** - Input validation

### Development & Testing
- **Jest** - Testing framework
- **ESLint** - Code linting
- **Prettier** - Code formatting

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

- Node.js v18 or higher
- npm or yarn
- Docker and Docker Compose (for local development)
- PostgreSQL 15+
- MongoDB 6+
- Redis 7+

## 🚀 Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone <repository-url>
cd nestjs-backend

# Install dependencies
npm install
```

### 2. Environment Setup

```bash
# Copy environment file
cp .env.example .env

# Edit .env file with your configuration
nano .env
```

### 3. Start Development Environment

```bash
# Start databases with Docker
docker-compose -f docker-compose.dev.yml up -d

# Run database migrations
npm run migration:run

# Start the application in development mode
npm run start:dev
```

### 4. Access the Application

- **API**: http://localhost:3000
- **API Documentation**: http://localhost:3000/docs
- **Health Check**: http://localhost:3000/health

## 🐳 Docker Development

### Start All Services

```bash
# Start all services (app + databases)
docker-compose up -d

# View logs
docker-compose logs -f app
```

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

```
src/
├── common/                 # Shared utilities and common functionality
│   ├── decorators/        # Custom decorators
│   ├── filters/           # Exception filters
│   ├── guards/            # Authentication and authorization guards
│   ├── interceptors/      # Request/response interceptors
│   ├── pipes/             # Validation pipes
│   └── utils/             # Utility functions
├── config/                # Configuration modules
│   ├── database.module.ts # Database configuration
│   └── redis.config.ts    # Redis configuration
├── modules/               # Feature modules
│   ├── auth/              # Authentication module
│   ├── users/             # User management module
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