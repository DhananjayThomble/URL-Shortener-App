#!/bin/bash

# Kubernetes deployment script for URL Shortener
# Usage: ./deploy.sh [environment] [action]
# Environment: dev, staging, prod (default: prod)
# Action: deploy, update, delete, status (default: deploy)

set -e

# Configuration
NAMESPACE="url-shortener"
APP_NAME="url-shortener"
ENVIRONMENT="${1:-prod}"
ACTION="${2:-deploy}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if kubectl is installed
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed. Please install kubectl first."
        exit 1
    fi
    
    # Check if kustomize is installed
    if ! command -v kustomize &> /dev/null; then
        log_warning "kustomize is not installed. Using kubectl kustomize instead."
    fi
    
    # Check if we can connect to the cluster
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Cannot connect to Kubernetes cluster. Please check your kubeconfig."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Create namespace if it doesn't exist
create_namespace() {
    log_info "Creating namespace if it doesn't exist..."
    kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -
    log_success "Namespace $NAMESPACE is ready"
}

# Deploy secrets (with warnings about production values)
deploy_secrets() {
    log_info "Deploying secrets..."
    log_warning "Make sure to update secret values for production deployment!"
    log_warning "Default secrets are for development only!"
    
    kubectl apply -f secrets.yaml
    log_success "Secrets deployed"
}

# Deploy configuration
deploy_config() {
    log_info "Deploying configuration..."
    kubectl apply -f configmap.yaml
    log_success "Configuration deployed"
}

# Deploy databases
deploy_databases() {
    log_info "Deploying databases..."
    
    # Deploy PostgreSQL
    log_info "Deploying PostgreSQL..."
    kubectl apply -f postgres.yaml
    
    # Deploy MongoDB
    log_info "Deploying MongoDB..."
    kubectl apply -f mongodb.yaml
    
    # Deploy Redis
    log_info "Deploying Redis..."
    kubectl apply -f redis.yaml
    
    log_success "Databases deployed"
}

# Wait for databases to be ready
wait_for_databases() {
    log_info "Waiting for databases to be ready..."
    
    # Wait for PostgreSQL
    log_info "Waiting for PostgreSQL..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=postgres --timeout=300s -n $NAMESPACE
    
    # Wait for MongoDB
    log_info "Waiting for MongoDB..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=mongodb --timeout=300s -n $NAMESPACE
    
    # Wait for Redis
    log_info "Waiting for Redis..."
    kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=redis --timeout=300s -n $NAMESPACE
    
    log_success "All databases are ready"
}

# Deploy application
deploy_application() {
    log_info "Deploying application..."
    kubectl apply -f app-deployment.yaml
    
    # Wait for application to be ready
    log_info "Waiting for application to be ready..."
    kubectl wait --for=condition=available deployment/url-shortener-app --timeout=300s -n $NAMESPACE
    
    log_success "Application deployed and ready"
}

# Deploy HPA
deploy_hpa() {
    log_info "Deploying Horizontal Pod Autoscaler..."
    kubectl apply -f hpa.yaml
    log_success "HPA deployed"
}

# Deploy ingress
deploy_ingress() {
    log_info "Deploying ingress..."
    log_warning "Make sure to update domain names in ingress.yaml for production!"
    kubectl apply -f ingress.yaml
    log_success "Ingress deployed"
}

# Deploy monitoring
deploy_monitoring() {
    log_info "Deploying monitoring..."
    kubectl apply -f monitoring.yaml
    log_success "Monitoring deployed"
}

# Full deployment
deploy_all() {
    log_info "Starting full deployment for environment: $ENVIRONMENT"
    
    create_namespace
    deploy_secrets
    deploy_config
    deploy_databases
    wait_for_databases
    deploy_application
    deploy_hpa
    deploy_ingress
    deploy_monitoring
    
    log_success "Full deployment completed!"
    show_status
}

# Update deployment
update_deployment() {
    log_info "Updating deployment..."
    
    # Update configuration
    deploy_config
    
    # Update application
    deploy_application
    
    log_success "Deployment updated!"
    show_status
}

# Delete deployment
delete_deployment() {
    log_warning "This will delete the entire $APP_NAME deployment!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deleting deployment..."
        
        # Delete in reverse order
        kubectl delete -f monitoring.yaml --ignore-not-found=true
        kubectl delete -f ingress.yaml --ignore-not-found=true
        kubectl delete -f hpa.yaml --ignore-not-found=true
        kubectl delete -f app-deployment.yaml --ignore-not-found=true
        kubectl delete -f redis.yaml --ignore-not-found=true
        kubectl delete -f mongodb.yaml --ignore-not-found=true
        kubectl delete -f postgres.yaml --ignore-not-found=true
        kubectl delete -f configmap.yaml --ignore-not-found=true
        kubectl delete -f secrets.yaml --ignore-not-found=true
        
        # Optionally delete namespace
        read -p "Delete namespace $NAMESPACE? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            kubectl delete namespace $NAMESPACE --ignore-not-found=true
        fi
        
        log_success "Deployment deleted!"
    else
        log_info "Deletion cancelled"
    fi
}

# Show deployment status
show_status() {
    log_info "Deployment status for namespace: $NAMESPACE"
    
    echo
    echo "=== Pods ==="
    kubectl get pods -n $NAMESPACE -o wide
    
    echo
    echo "=== Services ==="
    kubectl get services -n $NAMESPACE
    
    echo
    echo "=== Ingress ==="
    kubectl get ingress -n $NAMESPACE
    
    echo
    echo "=== HPA ==="
    kubectl get hpa -n $NAMESPACE
    
    echo
    echo "=== PVC ==="
    kubectl get pvc -n $NAMESPACE
    
    # Show application logs (last 10 lines)
    echo
    echo "=== Recent Application Logs ==="
    kubectl logs -l app.kubernetes.io/name=url-shortener -n $NAMESPACE --tail=10 --prefix=true
}

# Show help
show_help() {
    echo "Usage: $0 [environment] [action]"
    echo
    echo "Environment:"
    echo "  dev      - Development environment"
    echo "  staging  - Staging environment"
    echo "  prod     - Production environment (default)"
    echo
    echo "Action:"
    echo "  deploy   - Full deployment (default)"
    echo "  update   - Update existing deployment"
    echo "  delete   - Delete deployment"
    echo "  status   - Show deployment status"
    echo "  help     - Show this help"
    echo
    echo "Examples:"
    echo "  $0                    # Deploy to production"
    echo "  $0 prod deploy        # Deploy to production"
    echo "  $0 staging update     # Update staging deployment"
    echo "  $0 dev status         # Show development status"
    echo "  $0 prod delete        # Delete production deployment"
}

# Main execution
main() {
    case $ACTION in
        deploy)
            check_prerequisites
            deploy_all
            ;;
        update)
            check_prerequisites
            update_deployment
            ;;
        delete)
            check_prerequisites
            delete_deployment
            ;;
        status)
            check_prerequisites
            show_status
            ;;
        help)
            show_help
            ;;
        *)
            log_error "Unknown action: $ACTION"
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main