#!/bin/bash

# Production Deployment Script for NestJS URL Shortener
# This script handles the complete deployment process

set -e  # Exit on any error

# Configuration
APP_NAME="nestjs-url-shortener"
DOCKER_IMAGE="$APP_NAME:latest"
BACKUP_DIR="/backups"
LOG_FILE="/var/log/deploy.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker daemon is not running"
    fi
    
    # Check if Docker Compose is installed
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed"
    fi
    
    # Check if .env.production exists
    if [ ! -f ".env.production" ]; then
        error ".env.production file not found"
    fi
    
    success "Prerequisites check passed"
}

# Create backup
create_backup() {
    log "Creating backup..."
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_NAME="backup_${TIMESTAMP}"
    
    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_DIR"
    
    # Backup databases
    log "Backing up PostgreSQL database..."
    docker-compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/postgres_${BACKUP_NAME}.sql"
    
    log "Backing up MongoDB database..."
    docker-compose exec -T mongodb mongodump --db "$MONGO_DATABASE" --archive > "$BACKUP_DIR/mongodb_${BACKUP_NAME}.archive"
    
    # Backup application data
    log "Backing up application data..."
    tar -czf "$BACKUP_DIR/app_data_${BACKUP_NAME}.tar.gz" logs/ || true
    
    success "Backup created: $BACKUP_NAME"
    echo "$BACKUP_NAME" > "$BACKUP_DIR/latest_backup.txt"
}

# Build new image
build_image() {
    log "Building new Docker image..."
    
    # Build the image
    docker build -t "$DOCKER_IMAGE" .
    
    # Tag with timestamp for rollback capability
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    docker tag "$DOCKER_IMAGE" "$APP_NAME:$TIMESTAMP"
    
    success "Docker image built successfully"
}

# Health check function
health_check() {
    local url="$1"
    local max_attempts=30
    local attempt=1
    
    log "Performing health check on $url..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null; then
            success "Health check passed"
            return 0
        fi
        
        log "Health check attempt $attempt/$max_attempts failed, retrying in 10 seconds..."
        sleep 10
        ((attempt++))
    done
    
    error "Health check failed after $max_attempts attempts"
}

# Deploy application
deploy() {
    log "Starting deployment..."
    
    # Copy production environment file
    cp .env.production .env
    
    # Pull latest images for dependencies
    log "Pulling latest dependency images..."
    docker-compose -f docker-compose.prod.yml pull postgres mongodb redis nginx
    
    # Start the application with zero-downtime deployment
    log "Starting new application containers..."
    docker-compose -f docker-compose.prod.yml up -d --no-deps app
    
    # Wait for application to be ready
    sleep 30
    
    # Perform health check
    health_check "http://localhost:3000/health/simple"
    
    # Update other services if needed
    log "Updating other services..."
    docker-compose -f docker-compose.prod.yml up -d
    
    # Clean up old images (keep last 3)
    log "Cleaning up old Docker images..."
    docker images "$APP_NAME" --format "table {{.Repository}}:{{.Tag}}\t{{.CreatedAt}}" | tail -n +4 | awk '{print $1}' | xargs -r docker rmi || true
    
    success "Deployment completed successfully"
}

# Rollback function
rollback() {
    log "Starting rollback process..."
    
    # Get the latest backup
    if [ ! -f "$BACKUP_DIR/latest_backup.txt" ]; then
        error "No backup found for rollback"
    fi
    
    BACKUP_NAME=$(cat "$BACKUP_DIR/latest_backup.txt")
    
    # Stop current application
    docker-compose -f docker-compose.prod.yml stop app
    
    # Restore databases
    log "Restoring PostgreSQL database..."
    docker-compose -f docker-compose.prod.yml exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$BACKUP_DIR/postgres_${BACKUP_NAME}.sql"
    
    log "Restoring MongoDB database..."
    docker-compose -f docker-compose.prod.yml exec -T mongodb mongorestore --db "$MONGO_DATABASE" --archive < "$BACKUP_DIR/mongodb_${BACKUP_NAME}.archive"
    
    # Get previous image
    PREVIOUS_IMAGE=$(docker images "$APP_NAME" --format "{{.Repository}}:{{.Tag}}" | sed -n '2p')
    if [ -z "$PREVIOUS_IMAGE" ]; then
        error "No previous image found for rollback"
    fi
    
    # Update docker-compose to use previous image
    sed -i "s|image: $DOCKER_IMAGE|image: $PREVIOUS_IMAGE|g" docker-compose.prod.yml
    
    # Start with previous image
    docker-compose -f docker-compose.prod.yml up -d app
    
    # Health check
    health_check "http://localhost:3000/health/simple"
    
    success "Rollback completed successfully"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    # Wait for databases to be ready
    sleep 10
    
    # Run TypeORM migrations
    docker-compose -f docker-compose.prod.yml exec app npm run migration:run
    
    success "Database migrations completed"
}

# Performance test
performance_test() {
    log "Running performance tests..."
    
    # Basic performance test using curl
    log "Testing API response times..."
    
    # Test health endpoint
    RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}' http://localhost:3000/health/simple)
    log "Health endpoint response time: ${RESPONSE_TIME}s"
    
    # Test main API
    RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}' http://localhost:3000/api/v1/info)
    log "API endpoint response time: ${RESPONSE_TIME}s"
    
    success "Performance tests completed"
}

# Main deployment function
main() {
    log "Starting deployment process for $APP_NAME"
    
    case "${1:-deploy}" in
        "deploy")
            check_prerequisites
            create_backup
            build_image
            deploy
            run_migrations
            performance_test
            success "Deployment process completed successfully!"
            ;;
        "rollback")
            rollback
            ;;
        "backup")
            create_backup
            ;;
        "health-check")
            health_check "http://localhost:3000/health/simple"
            ;;
        *)
            echo "Usage: $0 {deploy|rollback|backup|health-check}"
            echo "  deploy      - Full deployment process (default)"
            echo "  rollback    - Rollback to previous version"
            echo "  backup      - Create backup only"
            echo "  health-check - Check application health"
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"