#!/bin/bash

# Development Environment Setup Script
# This script sets up the complete development environment with one command

set -e  # Exit on any error

echo "🚀 Setting up NestJS URL Shortener Development Environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Node.js is installed
check_node() {
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ and try again."
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node -v)"
        exit 1
    fi
    
    print_success "Node.js $(node -v) is installed"
}

# Check if Docker is installed and running
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker and try again."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
    
    print_success "Docker is installed and running"
}

# Install dependencies
install_dependencies() {
    print_status "Installing Node.js dependencies..."
    npm ci
    print_success "Dependencies installed"
}

# Setup environment files
setup_environment() {
    print_status "Setting up environment configuration..."
    
    if [ ! -f .env ]; then
        if [ -f .env.example ]; then
            cp .env.example .env
            print_success "Created .env from .env.example"
        else
            print_warning ".env.example not found, creating basic .env file"
            cat > .env << EOF
# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=urlshortener
POSTGRES_PASSWORD=password123
POSTGRES_DB=urlshortener_dev

MONGODB_URI=mongodb://localhost:27017/urlshortener_dev

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-this-in-production
JWT_REFRESH_EXPIRES_IN=30d

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@urlshortener.com

# Application Configuration
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_LIMIT=100

# Monitoring
ENABLE_METRICS=true
ENABLE_TRACING=false
EOF
        fi
    else
        print_success ".env file already exists"
    fi
}

# Start database services
start_databases() {
    print_status "Starting database services with Docker Compose..."
    
    # Check if docker-compose.dev.yml exists
    if [ ! -f docker-compose.dev.yml ]; then
        print_error "docker-compose.dev.yml not found. Please ensure it exists."
        exit 1
    fi
    
    # Start only database services
    docker-compose -f docker-compose.dev.yml up -d postgres mongodb redis
    
    print_status "Waiting for databases to be ready..."
    sleep 10
    
    # Wait for PostgreSQL
    print_status "Waiting for PostgreSQL to be ready..."
    until docker-compose -f docker-compose.dev.yml exec -T postgres pg_isready -U urlshortener; do
        sleep 2
    done
    
    # Wait for MongoDB
    print_status "Waiting for MongoDB to be ready..."
    until docker-compose -f docker-compose.dev.yml exec -T mongodb mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
        sleep 2
    done
    
    # Wait for Redis
    print_status "Waiting for Redis to be ready..."
    until docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping > /dev/null 2>&1; do
        sleep 2
    done
    
    print_success "All databases are ready"
}

# Run database migrations
run_migrations() {
    print_status "Running database migrations..."
    
    # Validate environment first
    npm run validate:env
    
    # Run TypeORM migrations
    npm run migration:run
    
    print_success "Database migrations completed"
}

# Seed database with initial data
seed_database() {
    print_status "Seeding database with initial data..."
    
    # Run seeding script if it exists
    if [ -f scripts/seed-database.js ]; then
        node scripts/seed-database.js
        print_success "Database seeded successfully"
    else
        print_warning "No seeding script found, skipping database seeding"
    fi
}

# Setup git hooks
setup_git_hooks() {
    print_status "Setting up Git hooks..."
    
    if [ -d .git ]; then
        npx husky install
        print_success "Git hooks installed"
    else
        print_warning "Not a Git repository, skipping Git hooks setup"
    fi
}

# Validate setup
validate_setup() {
    print_status "Validating development setup..."
    
    # Check if we can connect to databases
    npm run test:simple 2>/dev/null || {
        print_warning "Simple connectivity test failed, but setup may still be valid"
    }
    
    # Run linting
    npm run lint --silent || {
        print_warning "Linting found issues, run 'npm run lint' to see details"
    }
    
    print_success "Setup validation completed"
}

# Main setup process
main() {
    echo "=============================================="
    echo "  NestJS URL Shortener Development Setup"
    echo "=============================================="
    echo
    
    check_node
    check_docker
    install_dependencies
    setup_environment
    start_databases
    run_migrations
    seed_database
    setup_git_hooks
    validate_setup
    
    echo
    echo "=============================================="
    print_success "Development environment setup completed!"
    echo "=============================================="
    echo
    echo "Next steps:"
    echo "1. Review and update .env file with your specific configuration"
    echo "2. Start the development server: npm run start:dev"
    echo "3. Visit http://localhost:3000/api/docs for API documentation"
    echo
    echo "Useful commands:"
    echo "  npm run start:dev     - Start development server with hot reload"
    echo "  npm run test          - Run unit tests"
    echo "  npm run test:e2e      - Run end-to-end tests"
    echo "  npm run lint          - Run ESLint"
    echo "  npm run format        - Format code with Prettier"
    echo
    echo "Database management:"
    echo "  npm run migration:generate -- -n MigrationName  - Generate new migration"
    echo "  npm run migration:run                           - Run pending migrations"
    echo "  npm run migration:revert                        - Revert last migration"
    echo
}

# Handle script interruption
trap 'print_error "Setup interrupted"; exit 1' INT TERM

# Run main function
main "$@"