# Changelog

All notable changes to SnapURL will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Chrome extension for browser integration
- Custom domain support
- Link expiration functionality
- Bundled URLs feature
- Social media sharing integration
- QR code style customization
- API rate limit dashboard for users
- Webhook support for URL events

## [2.0.0] - 2024-12-28

### 🎉 Major Release: Complete Platform Modernization

This is a complete rewrite and modernization of SnapURL, transitioning from Express.js to NestJS v10 and implementing a modern, production-ready architecture.

### Added

#### Backend (NestJS 10)
- **Complete Migration to NestJS v10**: Migrated entire backend from Express.js to NestJS with TypeScript
- **Hybrid Database Architecture**: 
  - PostgreSQL for user management and authentication
  - MongoDB for URL storage and analytics
  - Redis for caching and session management
- **Enhanced Security**:
  - JWT authentication with refresh token mechanism
  - Role-based access control (RBAC): User, Admin, Super Admin
  - bcrypt password hashing with 12 rounds
  - Rate limiting with Redis backend
  - Helmet.js security headers
  - Input validation with class-validator
- **Comprehensive API Documentation**: Auto-generated Swagger/OpenAPI docs
- **Advanced Analytics**: 
  - Click tracking with device/browser detection
  - Geographic data (IP-based)
  - Referrer tracking
  - Time-series analytics aggregation
- **Production Monitoring**:
  - Winston logging with CloudWatch integration
  - Health check endpoints
  - Performance metrics collection
  - Graceful shutdown handling
- **Database Migrations**: TypeORM migration system for schema versioning
- **Docker Support**: Multi-stage Dockerfile and Docker Compose configurations
- **Testing**: Unit, integration, and E2E tests with 80%+ coverage

#### Frontend (React + Vite)
- **Modern React Stack**: React 19 with Vite build tool
- **TypeScript**: Full type safety across the application
- **UI Components**: Radix UI components with Tailwind CSS
- **State Management**:
  - Zustand for client state
  - TanStack Query for server state and caching
- **Form Handling**: React Hook Form with Zod validation
- **Enhanced Features**:
  - QR code generation for URLs
  - Analytics dashboard with charts
  - Bulk URL export functionality
  - URL categorization and tagging
  - Dark mode support
- **Responsive Design**: Mobile-first responsive interface
- **Performance**: Code splitting, lazy loading, optimized builds

#### Infrastructure
- **GitHub Codespaces**: One-click development environment with full Docker stack
- **Docker Compose**: Complete development environment with all services
- **CI/CD**: GitHub Actions workflows for testing and deployment
- **Deployment Guides**: 
  - AWS EC2 with PM2 and Nginx
  - Netlify for frontend
  - Heroku and DigitalOcean alternatives
  - Docker deployment options

#### Documentation
- **Comprehensive Documentation**:
  - Complete backend and frontend README files
  - Architecture documentation with diagrams
  - API reference guide
  - Development workflow guide
  - Deployment guides for multiple platforms
  - Security best practices
  - Database architecture guide
  - Testing guide
  - Troubleshooting guide
  - Chrome extension specification
- **AI-Optimized**: Documentation structured for AI coding tools
- **Developer-Friendly**: Copy-pasteable commands and real examples

### Changed

- **Architecture**: Complete rewrite with modern microservices-inspired design
- **Database**: Migrated from single MongoDB to hybrid PostgreSQL + MongoDB + Redis
- **Authentication**: Enhanced JWT system with refresh tokens
- **API Structure**: RESTful API with versioning (v1)
- **Frontend Build**: Migrated to Vite from Create React App
- **Deployment**: Production deployment on AWS EC2 instead of Heroku

### Improved

- **Performance**: 
  - Multi-level caching with Redis
  - Database query optimization with indexes
  - Connection pooling for all databases
  - CDN integration for static assets
- **Security**:
  - Enhanced password requirements
  - SQL injection protection
  - XSS prevention
  - CSRF protection
  - Rate limiting on all endpoints
- **Developer Experience**:
  - Hot module replacement in development
  - Faster build times with Vite
  - Better error messages
  - Comprehensive testing setup
- **Code Quality**:
  - ESLint and Prettier configuration
  - Husky git hooks for pre-commit checks
  - TypeScript strict mode
  - Code coverage requirements

### Fixed

- All major bugs from v1.x have been resolved in the rewrite
- Fixed authentication token refresh issues
- Fixed URL validation edge cases
- Fixed analytics data accuracy
- Fixed email delivery reliability

### Deprecated

- **Express.js Backend**: Completely replaced with NestJS
- **Old API Endpoints**: v1.x API endpoints no longer supported
- **Single Database Architecture**: Replaced with hybrid approach

### Removed

- Express.js dependencies and middleware
- Old authentication system
- Legacy frontend components
- Deprecated API endpoints

### Security

- Implemented comprehensive security measures (see [SECURITY.md](./SECURITY.md))
- Regular security audits and dependency updates
- Vulnerability reporting process established

## [1.0.0] - 2023-06-15

### Initial Release

- Basic URL shortening functionality
- User authentication with email/password
- MongoDB database
- Express.js backend
- React frontend
- Email verification
- Password reset functionality
- Visit count tracking
- Basic analytics
- Swagger API documentation
- CORS enabled
- Rate limiting

---

## Version History Summary

| Version | Release Date | Status | Major Changes |
|---------|-------------|--------|---------------|
| **2.0.0** | 2024-12-28 | Current | Complete modernization with NestJS, hybrid databases, enhanced features |
| 1.0.0 | 2023-06-15 | Deprecated | Initial release with Express.js |

## Migration Guides

### Migrating from v1.x to v2.0

**⚠️ Breaking Changes**: v2.0 is not backward compatible with v1.x

**API Changes**:
- Base URL changed from `/api/` to `/api/v1/`
- Authentication now uses JWT instead of sessions
- Response formats have been standardized
- Some endpoint paths have changed

**Database Migration**:
- User data migrated from MongoDB to PostgreSQL
- URL data remains in MongoDB with updated schema
- Analytics data restructured for better performance

**Frontend Changes**:
- Complete UI redesign
- New component library (Radix UI)
- Updated routing structure
- Environment variable changes

For detailed migration instructions, see [Migration Guide](./backend/docs/MIGRATION_GUIDE.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute to SnapURL.

## Support

- **Issues**: [GitHub Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- **Discussions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
- **Email**: support@snapurl.in

---

**For detailed release notes and documentation, visit**: [docs/](./docs/)
