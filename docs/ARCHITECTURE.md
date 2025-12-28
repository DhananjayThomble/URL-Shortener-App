# SnapURL 2.0 - System Architecture

> **AI-Optimized Documentation**: Structured for clarity with comprehensive technical context

## Overview

SnapURL 2.0 is a modern, enterprise-grade URL shortener built with a microservices-inspired architecture featuring:
- **Backend**: NestJS v10 with TypeScript
- **Frontend**: React + Vite with TypeScript  
- **Databases**: PostgreSQL (users), MongoDB (URLs), Redis (cache)
- **Infrastructure**: Docker Compose, GitHub Codespaces

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SnapURL 2.0 Architecture                       │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Browser    │         │   Chrome     │         │   Mobile     │
│   Clients    │         │  Extension   │         │    Apps      │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       └────────────────────────┴────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │                       │
                    │   Frontend (React)    │
                    │   Vite + TypeScript   │
                    │   Port: 3001/5173     │
                    │                       │
                    └───────────┬───────────┘
                                │
                                │ REST API (HTTPS)
                                │
                    ┌───────────▼───────────┐
                    │                       │
                    │  Backend (NestJS 10)  │
                    │   TypeScript + Node   │
                    │     Port: 3000        │
                    │                       │
                    │  ┌─────────────────┐  │
                    │  │  Auth Module    │  │
                    │  │  (JWT/Passport) │  │
                    │  └─────────────────┘  │
                    │  ┌─────────────────┐  │
                    │  │  URLs Module    │  │
                    │  │  (Shortening)   │  │
                    │  └─────────────────┘  │
                    │  ┌─────────────────┐  │
                    │  │  Analytics      │  │
                    │  │  Module         │  │
                    │  └─────────────────┘  │
                    │  ┌─────────────────┐  │
                    │  │  Admin Module   │  │
                    │  │  (RBAC)         │  │
                    │  └─────────────────┘  │
                    │                       │
                    └───┬───────┬───────┬───┘
                        │       │       │
        ┌───────────────┘       │       └────────────────┐
        │                       │                        │
┌───────▼───────┐     ┌─────────▼─────────┐    ┌────────▼────────┐
│  PostgreSQL   │     │     MongoDB       │    │     Redis       │
│  (Port 5432)  │     │   (Port 27017)    │    │   (Port 6379)   │
│               │     │                   │    │                 │
│  - Users      │     │  - URLs           │    │  - Sessions     │
│  - Auth       │     │  - Analytics      │    │  - Cache        │
│  - Roles      │     │  - Clicks         │    │  - Rate Limit   │
└───────────────┘     └───────────────────┘    └─────────────────┘
```

## Component Breakdown

### 1. Frontend Layer (React + Vite)

**Technology Stack:**
- React 19 with TypeScript
- Vite for build tooling
- Radix UI components
- Tailwind CSS for styling
- TanStack Query for server state
- Zustand for client state
- React Hook Form + Zod for forms

**Key Features:**
- User authentication UI (login, signup, password reset)
- URL shortening interface
- Analytics dashboard with charts
- QR code generation
- URL management (view, delete, export)
- Responsive design for mobile/desktop

**Directory Structure:**
```
frontend/src/
├── app/              # Pages and routes
├── components/       # Reusable React components
├── lib/             # Utilities and configurations
├── stores/          # Zustand state management
├── hooks/           # Custom React hooks
└── types/           # TypeScript definitions
```

**Communication:**
- REST API calls to backend via Axios/Fetch
- JWT tokens in Authorization headers
- API base URL: `http://localhost:3000/api/v1` (dev)

### 2. Backend Layer (NestJS 10)

**Technology Stack:**
- NestJS v10 framework
- Node.js v18+ runtime
- TypeScript v5
- TypeORM (PostgreSQL)
- Mongoose (MongoDB)
- Passport.js (authentication)
- Winston (logging)

**Module Architecture:**

#### Auth Module (`src/modules/auth/`)
- User registration with email verification
- Login with JWT token generation
- Password reset flow
- Refresh token mechanism
- Email service integration (SMTP)

#### Users Module (`src/modules/users/`)
- User profile management
- Role-based access control (User, Admin, Super Admin)
- User preferences
- Account deletion

#### URLs Module (`src/modules/urls/`)
- Short URL generation (nanoid)
- Custom alias support
- URL validation
- Redirect handling
- Click tracking
- QR code generation

#### Analytics Module
- Click tracking with metadata
- Geographic data (IP-based)
- Device/browser detection
- Referrer tracking
- Time-series data aggregation

#### Admin Module (`src/modules/admin/`)
- User management
- System statistics
- URL monitoring
- Audit logs

**Directory Structure:**
```
backend/src/
├── modules/          # Feature modules
│   ├── auth/        # Authentication
│   ├── users/       # User management
│   ├── urls/        # URL shortening
│   └── admin/       # Admin features
├── common/          # Shared utilities
│   ├── guards/      # Auth guards
│   ├── filters/     # Exception filters
│   ├── interceptors/# Response interceptors
│   └── decorators/  # Custom decorators
├── config/          # Configuration modules
└── migrations/      # Database migrations
```

### 3. Database Layer

#### PostgreSQL (Port 5432)
**Purpose**: User management and authentication

**Schema:**
```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Refresh tokens table
CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  token VARCHAR(500) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Connection:**
- Driver: TypeORM with pg driver
- Connection pooling: 10-20 connections
- Migration management via TypeORM CLI

#### MongoDB (Port 27017)
**Purpose**: URL storage and analytics

**Collections:**
```javascript
// urls collection
{
  _id: ObjectId,
  shortCode: String (indexed, unique),
  originalUrl: String,
  userId: String (indexed),
  customAlias: String (optional),
  createdAt: Date,
  expiresAt: Date (optional),
  clicks: Number,
  isActive: Boolean
}

// analytics collection
{
  _id: ObjectId,
  shortCode: String (indexed),
  clickedAt: Date (indexed),
  referrer: String,
  userAgent: String,
  ipAddress: String,
  country: String,
  device: String,
  browser: String
}
```

**Connection:**
- Driver: Mongoose ODM
- Connection pooling: 10 connections
- Indexes on shortCode, userId, clickedAt

#### Redis (Port 6379)
**Purpose**: Caching and session management

**Key Patterns:**
```
url:{shortCode}           -> Original URL (TTL: 1 hour)
session:{sessionId}       -> Session data (TTL: 24 hours)
ratelimit:{ip}:{endpoint} -> Rate limit counter (TTL: 1 minute)
analytics:{shortCode}     -> Cached analytics (TTL: 5 minutes)
```

**Configuration:**
- Max memory: 256MB (configurable)
- Eviction policy: allkeys-lru
- Persistence: AOF + RDB snapshots

## Data Flow

### URL Shortening Flow

```
1. User submits URL via Frontend
   ↓
2. Frontend validates and sends POST to /api/v1/urls
   ↓
3. Backend Auth Guard verifies JWT token
   ↓
4. URLs Controller receives request
   ↓
5. URLs Service:
   - Generates unique short code (nanoid)
   - Validates original URL
   - Checks custom alias availability
   ↓
6. Save to MongoDB:
   - Store URL document
   - Associate with user ID
   ↓
7. Cache in Redis:
   - Store shortCode -> originalUrl mapping
   ↓
8. Return response to frontend
   ↓
9. Frontend displays short URL to user
```

### URL Redirect Flow

```
1. User clicks short URL (https://snapurl.in/abc123)
   ↓
2. Request hits Backend GET /:shortCode
   ↓
3. Check Redis cache for shortCode
   ├─ Cache HIT: Get original URL from Redis
   │  ↓
   └─ Cache MISS: Query MongoDB for URL document
      ↓
      Store in Redis cache (TTL: 1 hour)
   ↓
4. Async: Record click analytics to MongoDB
   - IP address, user agent, referrer
   - Device/browser detection
   ↓
5. Increment click counter in MongoDB
   ↓
6. Return 301/302 redirect to original URL
   ↓
7. Browser redirects user to destination
```

## Security Architecture

### Authentication & Authorization

**JWT Token Strategy:**
```
Access Token:
- Short-lived (15 minutes)
- Contains: userId, email, role
- Stored: Frontend memory/localStorage
- Used: Every API request

Refresh Token:
- Long-lived (7 days)
- Stored: PostgreSQL, HTTP-only cookie
- Used: Obtain new access token
```

**Role-Based Access Control (RBAC):**
```
User       -> Create/view/delete own URLs
Admin      -> View all URLs, manage users
Super Admin -> Full system access
```

### Security Layers

1. **Transport Security**
   - HTTPS/TLS in production
   - HSTS headers
   - Secure cookies

2. **Input Validation**
   - class-validator on all DTOs
   - URL validation and sanitization
   - SQL injection prevention (parameterized queries)

3. **Rate Limiting**
   - Redis-backed rate limiter
   - Per-endpoint limits:
     - URL creation: 10/minute
     - Login: 5/minute
     - Redirects: 100/minute

4. **Security Headers**
   - Helmet.js middleware
   - CORS whitelist
   - CSP policies

5. **Data Protection**
   - Password hashing: bcrypt (12 rounds)
   - Sensitive data encryption
   - No plain-text secrets in code

## Scalability Considerations

### Horizontal Scaling

**Backend:**
- Stateless API servers
- Load balancer distribution
- Shared Redis/PostgreSQL/MongoDB
- Session management via Redis

**Frontend:**
- Static file hosting (Netlify/Vercel)
- CDN distribution
- Edge caching

### Performance Optimization

**Caching Strategy:**
- L1: Redis (hot URLs)
- L2: Application memory (config)
- L3: CDN (static assets)

**Database Optimization:**
- Connection pooling
- Query optimization with indexes
- Read replicas for MongoDB
- PostgreSQL query caching

**Monitoring:**
- Winston logging to CloudWatch
- Prometheus metrics
- Health check endpoints
- Database performance tracking

## Deployment Architecture

### Development Environment
```
Docker Compose:
- All services on single host
- Volume mounts for hot reload
- Local database instances
```

### Production Environment
```
Frontend:
- Netlify/Vercel hosting
- CDN distribution
- Environment-specific builds

Backend:
- AWS EC2/DigitalOcean
- PM2 process manager
- Nginx reverse proxy
- SSL certificates (Let's Encrypt)

Databases:
- Managed PostgreSQL (AWS RDS)
- MongoDB Atlas
- Redis Cloud/ElastiCache
```

## Cross-References

- **API Endpoints**: See [API.md](./API.md)
- **Development Setup**: See [DEVELOPMENT.md](./DEVELOPMENT.md)
- **Deployment Guide**: See [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Database Details**: See [DATABASE.md](./DATABASE.md)
- **Security Practices**: See [SECURITY.md](./SECURITY.md)
- **Testing Strategy**: See [TESTING.md](./TESTING.md)

## Technology Decision Rationale

### Why NestJS?
- TypeScript-first with decorators
- Built-in dependency injection
- Modular architecture
- Enterprise-grade patterns
- Strong testing support

### Why Hybrid Database?
- PostgreSQL: ACID compliance for users
- MongoDB: Flexible schema for analytics
- Redis: High-speed caching
- Each optimized for its use case

### Why React + Vite?
- Fast development with HMR
- Modern build tooling
- Excellent TypeScript support
- Large ecosystem
- Production-ready optimizations

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
