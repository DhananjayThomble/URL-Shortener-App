#!/bin/bash

set -e

echo "🚀 Starting SnapURL 2.0 Development Environment Setup..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Change to workspace root
cd /app

echo -e "${BLUE}📦 Step 1/5: Installing Backend Dependencies${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd backend
if [ -f "package.json" ]; then
  npm install
  echo -e "${GREEN}✓ Backend dependencies installed${NC}"
else
  echo -e "${YELLOW}⚠ Backend package.json not found${NC}"
fi
echo ""

echo -e "${BLUE}📝 Step 2/5: Configuring Backend Environment${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
# Application Configuration
NODE_ENV=development
PORT=3000
API_PREFIX=api/v1
APP_VERSION=1.0.0

# Database Configuration (Docker Service Names)
DATABASE_URL=postgresql://postgres:password@postgres:5432/url_shortener
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=url_shortener

# MongoDB (Docker Service Name)
MONGODB_URI=mongodb://mongo:27017/url_shortener
MONGODB_HOST=mongo
MONGODB_PORT=27017
MONGODB_DATABASE=url_shortener

# Redis Configuration (Docker Service Name)
REDIS_URL=redis://redis:6379
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0

# JWT Configuration
JWT_SECRET=codespaces-dev-jwt-secret-key-change-in-production-min-32-chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=codespaces-dev-refresh-secret-key-change-in-production-min-32-chars
JWT_REFRESH_EXPIRES_IN=7d

# Security Configuration
BCRYPT_SALT_ROUNDS=12
SESSION_SECRET=codespaces-dev-session-secret-change-in-production

# Rate Limiting
RATE_LIMIT_GLOBAL_MAX=1000
RATE_LIMIT_GLOBAL_WINDOW=900000
RATE_LIMIT_AUTH_MAX=5
RATE_LIMIT_AUTH_WINDOW=900000

# Monitoring Configuration
LOG_LEVEL=debug
ENABLE_PROMETHEUS_TRACING=true
PROMETHEUS_METRICS_PORT=9090

# Email Configuration (Optional - configure for email features)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
EMAIL_FROM=noreply@snapurl.dev

# Application URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000

# Cache Configuration
CACHE_TTL_URL=3600
CACHE_TTL_SESSION=900
CACHE_TTL_ANALYTICS=300

# API Keys (Optional)
VALID_API_KEYS=dev-api-key-1,dev-api-key-2
EOF
  echo -e "${GREEN}✓ Backend .env file created with Docker service names${NC}"
else
  echo -e "${YELLOW}⚠ Backend .env file already exists, skipping${NC}"
fi
echo ""

echo -e "${BLUE}📦 Step 3/5: Installing Frontend Dependencies${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd /app/frontend
if [ -f "package.json" ]; then
  npm install
  echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
  echo -e "${YELLOW}⚠ Frontend package.json not found${NC}"
fi
echo ""

echo -e "${BLUE}📝 Step 4/5: Configuring Frontend Environment${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
# API Configuration
VITE_API_URL=http://localhost:3000/api/v1

# Application Info
VITE_APP_NAME=SnapURL
VITE_APP_VERSION=2.0.0

# Environment
VITE_ENVIRONMENT=development
EOF
  echo -e "${GREEN}✓ Frontend .env file created${NC}"
else
  echo -e "${YELLOW}⚠ Frontend .env file already exists, skipping${NC}"
fi
echo ""

echo -e "${BLUE}🔧 Step 5/5: Final Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd /app
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✨ SnapURL 2.0 Development Environment Ready! ✨${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BLUE}🌐 Service URLs:${NC}"
echo "  📱 Frontend (Vite):      http://localhost:5173"
echo "  🔌 Backend API:          http://localhost:3000"
echo "  📚 API Documentation:    http://localhost:3000/docs"
echo "  🐘 pgAdmin:              http://localhost:8080"
echo "  🍃 Mongo Express:        http://localhost:8081"
echo "  📊 Redis Commander:      http://localhost:8082"
echo "  📈 Prometheus:           http://localhost:9091"
echo ""
echo -e "${BLUE}🔑 Admin Tool Credentials:${NC}"
echo "  pgAdmin:       admin@admin.com / admin"
echo "  Mongo Express: admin / admin"
echo ""
echo -e "${BLUE}💾 Database Connections:${NC}"
echo "  PostgreSQL:  postgres:5432 (user: postgres, pass: password)"
echo "  MongoDB:     mongo:27017"
echo "  Redis:       redis:6379"
echo ""
echo -e "${BLUE}🚀 Quick Start Commands:${NC}"
echo "  Backend:   Already running via Docker Compose"
echo "  Frontend:  cd frontend && npm run dev"
echo ""
echo -e "${BLUE}📖 Documentation:${NC}"
echo "  See .devcontainer/README.md for complete guide"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}Happy Coding! 🎉${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
