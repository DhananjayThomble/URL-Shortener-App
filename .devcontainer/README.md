# SnapURL 2.0 - GitHub Codespaces Guide

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DhananjayThomble/URL-Shortener-App?quickstart=1)

Complete development environment for SnapURL 2.0 with NestJS backend, React frontend, and full database stack - ready in 90 seconds.

## 🚀 Quick Start

### One-Click Setup

1. **Click the badge above** or go to [Create Codespace](https://github.com/DhananjayThomble/URL-Shortener-App/codespaces)
2. **Wait ~90 seconds** for automatic setup
3. **Start coding!** All services are pre-configured and running

### What Gets Set Up Automatically

✅ **Docker Services**: PostgreSQL, MongoDB, Redis, Backend API, Admin Tools  
✅ **VS Code Extensions**: ESLint, Prettier, GitHub Copilot, Database tools  
✅ **Dependencies**: Backend and frontend npm packages  
✅ **Environment Files**: Pre-configured `.env` files with Docker service names  
✅ **Port Forwarding**: All services accessible via HTTPS tunnels  

## 📊 Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Codespace                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │   Frontend  │  │   Backend    │  │   PostgreSQL  │          │
│  │  (Vite)     │→ │  (NestJS)    │→ │   Database    │          │
│  │  Port 5173  │  │  Port 3000   │  │   Port 5432   │          │
│  └─────────────┘  └──────────────┘  └───────────────┘          │
│                           ↓                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐          │
│  │   MongoDB   │  │    Redis     │  │   Admin Tools │          │
│  │  Port 27017 │  │  Port 6379   │  │   8080-8082   │          │
│  └─────────────┘  └──────────────┘  └───────────────┘          │
│                                                                   │
│  ┌──────────────────────────────────────────────────┐          │
│  │              Monitoring (Prometheus)              │          │
│  │               Ports 9090, 9091                    │          │
│  └──────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## 🌐 Available Services

| Service | Port | URL Pattern | Credentials | Purpose |
|---------|------|-------------|-------------|---------|
| **Backend API** | 3000 | `https://<codespace>-3000.app.github.dev` | N/A | NestJS REST API |
| **Swagger Docs** | 3000 | `https://<codespace>-3000.app.github.dev/docs` | N/A | Interactive API Documentation |
| **Frontend** | 5173 | `https://<codespace>-5173.app.github.dev` | N/A | React + Vite UI |
| **pgAdmin** | 8080 | `https://<codespace>-8080.app.github.dev` | admin@admin.com / admin | PostgreSQL Admin UI |
| **Mongo Express** | 8081 | `https://<codespace>-8081.app.github.dev` | admin / admin | MongoDB Admin UI |
| **Redis Commander** | 8082 | `https://<codespace>-8082.app.github.dev` | N/A | Redis Admin UI |
| **Prometheus** | 9091 | `https://<codespace>-9091.app.github.dev` | N/A | Metrics Dashboard |

### Direct Database Access

| Database | Connection String | User | Password |
|----------|------------------|------|----------|
| PostgreSQL | `postgres:5432/url_shortener` | postgres | password |
| MongoDB | `mongo:27017/url_shortener` | root | password |
| Redis | `redis:6379` | - | - |

> **Note**: Use service names (`postgres`, `mongo`, `redis`) when connecting from containers. The ports are forwarded to your local browser via HTTPS.

## 💡 GitHub Copilot Integration

This Codespace is optimized for GitHub Copilot development:

### Smart Code Completion

```typescript
// Type a comment and let Copilot suggest implementation
// Create a NestJS controller for URL shortening with rate limiting
```

### Chat-Driven Development

**In Copilot Chat:**
```
@workspace How do I add a new endpoint to shorten URLs?
@workspace Explain the database connection pooling configuration
@workspace Help me write a test for the authentication service
```

### Quick Actions

- **Generate Tests**: Select function → Copilot → "Generate Tests"
- **Explain Code**: Select code → Copilot Chat → "Explain this"
- **Fix Issues**: Error → Copilot → "Fix using Copilot"
- **Refactor**: Select code → Copilot → "Refactor this"

### Code Review with Copilot

```bash
# Before committing
git diff | gh copilot suggest
```

## 🛠️ Development Workflow

### Backend Development

The backend is **already running** via Docker Compose:

```bash
# Check backend status
docker ps | grep nestjs

# View backend logs
docker logs -f nestjs-url-shortener-dev

# Restart backend (if needed)
docker restart nestjs-url-shortener-dev

# Access backend shell
docker exec -it nestjs-url-shortener-dev sh
```

**Hot Reload**: The backend automatically reloads on file changes (mounted volume).

### Frontend Development

Start the frontend development server:

```bash
cd frontend
npm run dev
```

Frontend will be available at port 5173 (auto-forwarded).

### Running Database Migrations

```bash
cd backend

# Run pending migrations
npm run migration:run

# Create new migration
npm run migration:create -- -n AddNewColumn

# Revert last migration
npm run migration:revert
```

### Testing

```bash
# Backend tests
cd backend
npm run test              # Unit tests
npm run test:e2e          # E2E tests
npm run test:cov          # Coverage report

# Frontend tests
cd frontend
npm run test              # Run tests
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage
```

### Code Quality

```bash
# Lint and format
cd backend
npm run lint              # Check linting
npm run lint:fix          # Fix linting issues
npm run format            # Format code with Prettier

cd ../frontend
npm run lint              # Lint frontend
```

## 🗄️ Database Access

### Using Admin Tools (Web UI)

#### pgAdmin (PostgreSQL)

1. Open pgAdmin at port 8080
2. Login: `admin@admin.com` / `admin`
3. Add server:
   - Name: `Local PostgreSQL`
   - Host: `postgres`
   - Port: `5432`
   - Database: `url_shortener`
   - Username: `postgres`
   - Password: `password`

#### Mongo Express (MongoDB)

1. Open Mongo Express at port 8081
2. Login: `admin` / `admin`
3. Database `url_shortener` auto-connected

#### Redis Commander (Redis)

1. Open Redis Commander at port 8082
2. Auto-connected to `redis:6379`
3. Browse keys, run commands

### Using VS Code Extensions

#### PostgreSQL Extension

```sql
-- Create connection in PostgreSQL extension
Host: postgres
Port: 5432
Database: url_shortener
Username: postgres
Password: password

-- Run queries directly in VS Code
SELECT * FROM users LIMIT 10;
```

#### MongoDB Extension

```javascript
// Connect to MongoDB
mongodb://mongo:27017

// Run queries in VS Code
use url_shortener
db.urls.find().limit(10)
```

#### Redis Extension

```redis
# Connect to Redis
redis://redis:6379

# Run commands
GET url:abc123
KEYS url:*
```

### Using CLI Tools

#### PostgreSQL CLI

```bash
# Connect to PostgreSQL
docker exec -it postgres-dev psql -U postgres -d url_shortener

# Run queries
\dt                    # List tables
SELECT * FROM users;   # Query data
\q                     # Quit
```

#### MongoDB CLI

```bash
# Connect to MongoDB
docker exec -it mongodb-dev mongosh url_shortener

# Run queries
show collections
db.urls.find()
exit
```

#### Redis CLI

```bash
# Connect to Redis
docker exec -it redis-dev redis-cli

# Run commands
KEYS *
GET url:abc123
exit
```

## 📝 Common Development Tasks

### Create a New API Endpoint

```bash
cd backend

# Generate a new module
nest generate module feature-name

# Generate a controller
nest generate controller feature-name

# Generate a service
nest generate service feature-name
```

### Seed Database with Sample Data

```bash
cd backend
npm run seed:db
```

### Export/Import Data

```bash
# Backup databases
npm run db:backup

# Restore databases
npm run db:restore
```

### API Testing with REST Client

Create a `.http` file in VS Code:

```http
### Health Check
GET http://localhost:3000/health

### Register User
POST http://localhost:3000/api/v1/auth/register
Content-Type: application/json

{
  "email": "test@example.com",
  "password": "SecurePass123!",
  "name": "Test User"
}

### Create Short URL
POST http://localhost:3000/api/v1/urls
Content-Type: application/json
Authorization: Bearer {{token}}

{
  "originalUrl": "https://example.com/very-long-url",
  "customAlias": "mylink"
}
```

### Monitoring and Metrics

```bash
# View Prometheus metrics
curl http://localhost:9090/metrics

# Check application health
curl http://localhost:3000/health

# View logs
docker logs -f nestjs-url-shortener-dev
```

## 🐛 Troubleshooting

### Services Not Starting

```bash
# Check service status
docker ps -a

# View service logs
docker logs postgres-dev
docker logs mongodb-dev
docker logs redis-dev
docker logs nestjs-url-shortener-dev

# Restart all services
cd backend
docker-compose restart

# Rebuild if needed
docker-compose down
docker-compose up -d --build
```

### Port Already in Use

Codespaces handles port forwarding automatically. If issues occur:

1. Go to **Ports** tab in VS Code
2. Stop conflicting port
3. Restart service

### Database Connection Issues

```bash
# Test PostgreSQL connection
docker exec postgres-dev pg_isready -U postgres

# Test MongoDB connection
docker exec mongodb-dev mongosh --eval "db.adminCommand('ping')"

# Test Redis connection
docker exec redis-dev redis-cli ping
```

### Environment Variables Not Loading

```bash
# Verify .env files exist
ls -la backend/.env
ls -la frontend/.env

# Re-run setup if needed
bash .devcontainer/setup.sh
```

### Dependencies Not Installing

```bash
# Clear npm cache
cd backend && npm cache clean --force
cd ../frontend && npm cache clean --force

# Reinstall
cd backend && rm -rf node_modules && npm install
cd ../frontend && rm -rf node_modules && npm install
```

### Hot Reload Not Working

```bash
# Check volume mounts
docker inspect nestjs-url-shortener-dev | grep -A 10 Mounts

# Restart with fresh mount
cd backend
docker-compose down
docker-compose up -d
```

## 💰 Cost Management

### Minimize Costs

- **Stop when not using**: Codespaces auto-stop after 30 minutes of inactivity
- **Use smaller machines**: 2-core machine is sufficient for development
- **Delete unused Codespaces**: Clean up old Codespaces regularly
- **Use Prebuilds**: Enable prebuilds for faster startup (see below)

### Current Usage

Check at: [GitHub Settings → Billing → Codespaces](https://github.com/settings/billing)

**Free Tier**: 120 core-hours/month (60 hours on 2-core machine)

## ⚡ Advanced Features

### Prebuilds (Recommended)

Enable prebuilds for instant Codespace startup:

1. Go to repository **Settings → Codespaces**
2. Enable **Prebuilds**
3. Configure:
   - Branch: `main`, `develop`, `snapurl2.0`
   - Regions: Your preferred regions
   - Schedule: On push

**Benefits**: Startup time reduced from 90s to ~10s

### Custom Tasks

Add to `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Start Frontend",
      "type": "shell",
      "command": "cd frontend && npm run dev",
      "problemMatcher": [],
      "group": "build"
    },
    {
      "label": "Run Tests",
      "type": "shell",
      "command": "cd backend && npm run test",
      "problemMatcher": [],
      "group": "test"
    }
  ]
}
```

### Dotfiles Sync

Sync your personal configurations:

1. Create a public dotfiles repo (e.g., `username/dotfiles`)
2. Go to [Codespaces Settings](https://github.com/settings/codespaces)
3. Set **Dotfiles repository**

Your personal aliases, git config, etc., will auto-sync!

### Secrets Management

Add secrets for email, API keys, etc.:

1. Go to [Codespaces Secrets](https://github.com/settings/codespaces)
2. Add secrets (e.g., `EMAIL_USER`, `EMAIL_PASS`)
3. They'll be available as environment variables

## 📚 Additional Resources

### Documentation

- [Backend README](../backend/README.md) - Complete NestJS documentation
- [Frontend README](../frontend/README.md) - React frontend guide
- [API Documentation](http://localhost:3000/docs) - Swagger UI (when running)

### External Links

- [DevContainer Specification](https://containers.dev/)
- [GitHub Codespaces Docs](https://docs.github.com/en/codespaces)
- [NestJS Documentation](https://docs.nestjs.com/)
- [React Documentation](https://react.dev/)

### Support

- **Issues**: [GitHub Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- **Discussions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)

---

**Happy Coding in the Cloud! ☁️** Made with ❤️ for the SnapURL community.
