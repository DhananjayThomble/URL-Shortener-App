#!/bin/bash

# SnapURL Backend Deployment Script
# Usage: ./scripts/deploy.sh [environment] [options]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="staging"
SKIP_TESTS=false
SKIP_BUILD=false
FORCE_DEPLOY=false
DRY_RUN=false

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
SnapURL Backend Deployment Script

Usage: $0 [environment] [options]

Environments:
    staging     Deploy to staging environment (default)
    production  Deploy to production environment

Options:
    --skip-tests        Skip running tests before deployment
    --skip-build        Skip building Docker image
    --force             Force deployment even if tests fail
    --dry-run           Show what would be deployed without actually deploying
    --help              Show this help message

Examples:
    $0 staging
    $0 production --skip-tests
    $0 staging --dry-run
    $0 production --force

Environment Variables:
    AWS_PROFILE         AWS profile to use (default: default)
    DOCKER_REGISTRY     Docker registry URL
    IMAGE_TAG           Docker image tag (default: latest)
    CLUSTER_NAME        ECS cluster name
    SERVICE_NAME        ECS service name

EOF
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if required tools are installed
    command -v docker >/dev/null 2>&1 || { log_error "Docker is required but not installed."; exit 1; }
    command -v aws >/dev/null 2>&1 || { log_error "AWS CLI is required but not installed."; exit 1; }
    command -v npm >/dev/null 2>&1 || { log_error "npm is required but not installed."; exit 1; }
    
    # Check if Docker is running
    docker info >/dev/null 2>&1 || { log_error "Docker is not running."; exit 1; }
    
    # Check AWS credentials
    aws sts get-caller-identity >/dev/null 2>&1 || { log_error "AWS credentials not configured."; exit 1; }
    
    log_success "Prerequisites check passed"
}

run_tests() {
    if [ "$SKIP_TESTS" = true ]; then
        log_warning "Skipping tests"
        return 0
    fi
    
    log_info "Running tests..."
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        npm ci
    fi
    
    # Run linting
    log_info "Running linting..."
    npm run lint || {
        if [ "$FORCE_DEPLOY" = false ]; then
            log_error "Linting failed. Use --force to deploy anyway."
            exit 1
        else
            log_warning "Linting failed but continuing due to --force flag"
        fi
    }
    
    # Run unit tests
    log_info "Running unit tests..."
    npm run test || {
        if [ "$FORCE_DEPLOY" = false ]; then
            log_error "Unit tests failed. Use --force to deploy anyway."
            exit 1
        else
            log_warning "Unit tests failed but continuing due to --force flag"
        fi
    }
    
    # Run integration tests
    log_info "Running integration tests..."
    npm run test:e2e || {
        if [ "$FORCE_DEPLOY" = false ]; then
            log_error "Integration tests failed. Use --force to deploy anyway."
            exit 1
        else
            log_warning "Integration tests failed but continuing due to --force flag"
        fi
    }
    
    log_success "All tests passed"
}

build_image() {
    if [ "$SKIP_BUILD" = true ]; then
        log_warning "Skipping Docker image build"
        return 0
    fi
    
    log_info "Building Docker image..."
    
    # Set default values
    DOCKER_REGISTRY=${DOCKER_REGISTRY:-"your-registry.com"}
    IMAGE_TAG=${IMAGE_TAG:-"latest"}
    IMAGE_NAME="snapurl-backend"
    FULL_IMAGE_NAME="${DOCKER_REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    
    if [ "$DRY_RUN" = true ]; then
        log_info "DRY RUN: Would build image: $FULL_IMAGE_NAME"
        return 0
    fi
    
    # Build the image
    docker build -t "$FULL_IMAGE_NAME" . || {
        log_error "Docker build failed"
        exit 1
    }
    
    # Push the image
    log_info "Pushing Docker image to registry..."
    docker push "$FULL_IMAGE_NAME" || {
        log_error "Docker push failed"
        exit 1
    }
    
    log_success "Docker image built and pushed: $FULL_IMAGE_NAME"
}

deploy_to_ecs() {
    log_info "Deploying to ECS..."
    
    # Set environment-specific variables
    case $ENVIRONMENT in
        staging)
            CLUSTER_NAME=${CLUSTER_NAME:-"snapurl-staging"}
            SERVICE_NAME=${SERVICE_NAME:-"snapurl-backend-staging"}
            ;;
        production)
            CLUSTER_NAME=${CLUSTER_NAME:-"snapurl-production"}
            SERVICE_NAME=${SERVICE_NAME:-"snapurl-backend-production"}
            ;;
        *)
            log_error "Unknown environment: $ENVIRONMENT"
            exit 1
            ;;
    esac
    
    if [ "$DRY_RUN" = true ]; then
        log_info "DRY RUN: Would deploy to cluster: $CLUSTER_NAME, service: $SERVICE_NAME"
        return 0
    fi
    
    # Update ECS service
    log_info "Updating ECS service: $SERVICE_NAME in cluster: $CLUSTER_NAME"
    aws ecs update-service \
        --cluster "$CLUSTER_NAME" \
        --service "$SERVICE_NAME" \
        --force-new-deployment || {
        log_error "ECS service update failed"
        exit 1
    }
    
    # Wait for deployment to complete
    log_info "Waiting for deployment to complete..."
    aws ecs wait services-stable \
        --cluster "$CLUSTER_NAME" \
        --services "$SERVICE_NAME" || {
        log_error "Deployment failed or timed out"
        exit 1
    }
    
    log_success "Deployment completed successfully"
}

run_smoke_tests() {
    log_info "Running smoke tests..."
    
    # Set environment-specific URLs
    case $ENVIRONMENT in
        staging)
            BASE_URL="https://api-staging.snapurl.com"
            ;;
        production)
            BASE_URL="https://api.snapurl.com"
            ;;
        *)
            log_error "Unknown environment: $ENVIRONMENT"
            exit 1
            ;;
    esac
    
    if [ "$DRY_RUN" = true ]; then
        log_info "DRY RUN: Would run smoke tests against: $BASE_URL"
        return 0
    fi
    
    # Wait for service to be ready
    log_info "Waiting for service to be ready..."
    sleep 30
    
    # Basic health check
    log_info "Testing health endpoint..."
    curl -f "$BASE_URL/health" || {
        log_error "Health check failed"
        exit 1
    }
    
    # API health check
    log_info "Testing API health endpoint..."
    curl -f "$BASE_URL/api/v1/health" || {
        log_error "API health check failed"
        exit 1
    }
    
    # Database connectivity test
    log_info "Testing database connectivity..."
    curl -f "$BASE_URL/api/v1/health/ready" || {
        log_error "Database connectivity test failed"
        exit 1
    }
    
    log_success "All smoke tests passed"
}

cleanup() {
    log_info "Cleaning up..."
    # Add any cleanup tasks here
    log_success "Cleanup completed"
}

main() {
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            staging|production)
                ENVIRONMENT="$1"
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --skip-build)
                SKIP_BUILD=true
                shift
                ;;
            --force)
                FORCE_DEPLOY=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    log_info "Starting deployment to $ENVIRONMENT environment"
    
    if [ "$DRY_RUN" = true ]; then
        log_warning "DRY RUN MODE - No actual changes will be made"
    fi
    
    # Set up trap for cleanup
    trap cleanup EXIT
    
    # Run deployment steps
    check_prerequisites
    run_tests
    build_image
    deploy_to_ecs
    run_smoke_tests
    
    log_success "Deployment to $ENVIRONMENT completed successfully! 🚀"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        log_info "Production deployment completed. Monitor the application at:"
        log_info "  - Application: https://api.snapurl.com"
        log_info "  - Health: https://api.snapurl.com/health"
        log_info "  - Metrics: https://api.snapurl.com/metrics"
    fi
}

# Run main function
main "$@"