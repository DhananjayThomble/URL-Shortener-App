#!/bin/bash

# SnapURL Backend System Validation Script
# Comprehensive validation of all system components and requirements

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Validation results
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    ((PASSED_CHECKS++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
    ((WARNINGS++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((FAILED_CHECKS++))
}

check_item() {
    ((TOTAL_CHECKS++))
    echo -n "Checking $1... "
}

validate_environment() {
    log_info "=== Environment Validation ==="
    
    check_item "Node.js version"
    if command -v node >/dev/null 2>&1; then
        NODE_VERSION=$(node --version)
        if [[ "$NODE_VERSION" =~ ^v1[8-9]\. ]] || [[ "$NODE_VERSION" =~ ^v[2-9][0-9]\. ]]; then
            log_success "Node.js version: $NODE_VERSION"
        else
            log_error "Node.js version $NODE_VERSION is not supported (requires v18+)"
        fi
    else
        log_error "Node.js not found"
    fi
    
    check_item "npm version"
    if command -v npm >/dev/null 2>&1; then
        NPM_VERSION=$(npm --version)
        log_success "npm version: $NPM_VERSION"
    else
        log_error "npm not found"
    fi
    
    check_item "TypeScript compilation"
    if npm run build >/dev/null 2>&1; then
        log_success "TypeScript compilation successful"
    else
        log_error "TypeScript compilation failed"
    fi
}

validate_dependencies() {
    log_info "=== Dependencies Validation ==="
    
    check_item "Package dependencies"
    if [ -f "package.json" ] && [ -f "package-lock.json" ]; then
        if npm ci --silent >/dev/null 2>&1; then
            log_success "All dependencies installed successfully"
        else
            log_error "Failed to install dependencies"
        fi
    else
        log_error "package.json or package-lock.json not found"
    fi
    
    check_item "Security vulnerabilities"
    AUDIT_RESULT=$(npm audit --audit-level=high --json 2>/dev/null || echo '{"vulnerabilities":{}}')
    VULN_COUNT=$(echo "$AUDIT_RESULT" | grep -o '"high":[0-9]*' | cut -d':' -f2 | head -1)
    if [ -z "$VULN_COUNT" ] || [ "$VULN_COUNT" = "0" ]; then
        log_success "No high-severity vulnerabilities found"
    else
        log_error "$VULN_COUNT high-severity vulnerabilities found"
    fi
}

validate_code_quality() {
    log_info "=== Code Quality Validation ==="
    
    check_item "ESLint validation"
    if npm run lint >/dev/null 2>&1; then
        log_success "ESLint validation passed"
    else
        log_error "ESLint validation failed"
    fi
    
    check_item "Prettier formatting"
    if npm run format:check >/dev/null 2>&1; then
        log_success "Code formatting is consistent"
    else
        log_warning "Code formatting issues found (run npm run format to fix)"
    fi
}

validate_tests() {
    log_info "=== Test Validation ==="
    
    check_item "Unit tests"
    if npm run test >/dev/null 2>&1; then
        log_success "Unit tests passed"
    else
        log_error "Unit tests failed"
    fi
    
    check_item "Integration tests"
    if npm run test:e2e >/dev/null 2>&1; then
        log_success "Integration tests passed"
    else
        log_error "Integration tests failed"
    fi
    
    check_item "Test coverage"
    if npm run test:cov >/dev/null 2>&1; then
        # Extract coverage percentage
        COVERAGE=$(npm run test:cov 2>/dev/null | grep -o 'All files.*[0-9]*\.[0-9]*' | grep -o '[0-9]*\.[0-9]*' | tail -1)
        if [ -n "$COVERAGE" ]; then
            if (( $(echo "$COVERAGE >= 80" | bc -l) )); then
                log_success "Test coverage: ${COVERAGE}%"
            else
                log_warning "Test coverage: ${COVERAGE}% (below 80% threshold)"
            fi
        else
            log_warning "Could not determine test coverage"
        fi
    else
        log_error "Test coverage generation failed"
    fi
}

validate_database_config() {
    log_info "=== Database Configuration Validation ==="
    
    check_item "PostgreSQL configuration"
    if grep -q "POSTGRES_" .env.example 2>/dev/null; then
        log_success "PostgreSQL configuration template found"
    else
        log_warning "PostgreSQL configuration template not found"
    fi
    
    check_item "MongoDB configuration"
    if grep -q "MONGODB_" .env.example 2>/dev/null; then
        log_success "MongoDB configuration template found"
    else
        log_warning "MongoDB configuration template not found"
    fi
    
    check_item "Redis configuration"
    if grep -q "REDIS_" .env.example 2>/dev/null; then
        log_success "Redis configuration template found"
    else
        log_warning "Redis configuration template not found"
    fi
}

validate_security_config() {
    log_info "=== Security Configuration Validation ==="
    
    check_item "JWT configuration"
    if grep -q "JWT_SECRET" .env.example 2>/dev/null; then
        log_success "JWT configuration template found"
    else
        log_error "JWT configuration template not found"
    fi
    
    check_item "CORS configuration"
    if grep -q "CORS_" .env.example 2>/dev/null; then
        log_success "CORS configuration template found"
    else
        log_warning "CORS configuration template not found"
    fi
    
    check_item "Rate limiting configuration"
    if grep -q "RATE_LIMIT_" .env.example 2>/dev/null; then
        log_success "Rate limiting configuration template found"
    else
        log_warning "Rate limiting configuration template not found"
    fi
}

validate_monitoring_config() {
    log_info "=== Monitoring Configuration Validation ==="
    
    check_item "Prometheus configuration"
    if [ -f "src/config/monitoring.config.ts" ]; then
        log_success "Monitoring configuration found"
    else
        log_warning "Monitoring configuration not found"
    fi
    
    check_item "Health check endpoints"
    if grep -r "health" src/ >/dev/null 2>&1; then
        log_success "Health check implementation found"
    else
        log_warning "Health check implementation not found"
    fi
    
    check_item "Logging configuration"
    if grep -r "winston\|logger" src/ >/dev/null 2>&1; then
        log_success "Logging implementation found"
    else
        log_warning "Logging implementation not found"
    fi
}

validate_production_readiness() {
    log_info "=== Production Readiness Validation ==="
    
    check_item "Production configuration"
    if [ -f "src/config/production.config.ts" ]; then
        log_success "Production configuration found"
    else
        log_error "Production configuration not found"
    fi
    
    check_item "Environment template"
    if [ -f ".env.production.example" ]; then
        log_success "Production environment template found"
    else
        log_error "Production environment template not found"
    fi
    
    check_item "Docker configuration"
    if [ -f "Dockerfile" ]; then
        log_success "Dockerfile found"
    else
        log_error "Dockerfile not found"
    fi
    
    check_item "CI/CD pipeline"
    if [ -f ".github/workflows/deploy.yml" ]; then
        log_success "CI/CD pipeline configuration found"
    else
        log_warning "CI/CD pipeline configuration not found"
    fi
}

validate_api_documentation() {
    log_info "=== API Documentation Validation ==="
    
    check_item "Swagger configuration"
    if grep -r "@nestjs/swagger" src/ >/dev/null 2>&1; then
        log_success "Swagger integration found"
    else
        log_warning "Swagger integration not found"
    fi
    
    check_item "API versioning"
    if grep -r "version.*v1\|api/v1" src/ >/dev/null 2>&1; then
        log_success "API versioning implementation found"
    else
        log_warning "API versioning implementation not found"
    fi
}

validate_feature_modules() {
    log_info "=== Feature Modules Validation ==="
    
    REQUIRED_MODULES=("auth" "users" "urls" "analytics" "admin")
    
    for module in "${REQUIRED_MODULES[@]}"; do
        check_item "$module module"
        if [ -d "src/modules/$module" ]; then
            log_success "$module module found"
        else
            log_error "$module module not found"
        fi
    done
    
    check_item "Bio pages module"
    if [ -d "src/modules/bio-pages" ] || grep -r "bio.*page" src/ >/dev/null 2>&1; then
        log_success "Bio pages module found"
    else
        log_warning "Bio pages module not found"
    fi
    
    check_item "Tags module"
    if [ -d "src/modules/tags" ] || grep -r "tag" src/modules/ >/dev/null 2>&1; then
        log_success "Tags module found"
    else
        log_warning "Tags module not found"
    fi
}

validate_property_tests() {
    log_info "=== Property-Based Tests Validation ==="
    
    PROPERTY_TESTS=(
        "connection-pooling"
        "authentication-security"
        "security-event-logging"
        "link-alias-uniqueness"
        "link-expiration"
        "analytics-data-capture"
        "device-routing"
        "utm-parameters"
        "password-protection"
        "geo-targeting"
        "bio-page-username-uniqueness"
        "bio-link-ordering"
        "bio-page-visibility"
        "tag-scoped-uniqueness"
        "tag-deletion-cascade"
    )
    
    for test in "${PROPERTY_TESTS[@]}"; do
        check_item "$test property test"
        if [ -f "test/property/$test.property.spec.ts" ]; then
            log_success "$test property test found"
        else
            log_warning "$test property test not found"
        fi
    done
}

generate_report() {
    log_info "=== Validation Summary ==="
    
    echo ""
    echo "📊 VALIDATION RESULTS:"
    echo "  Total Checks: $TOTAL_CHECKS"
    echo "  ✅ Passed: $PASSED_CHECKS"
    echo "  ❌ Failed: $FAILED_CHECKS"
    echo "  ⚠️  Warnings: $WARNINGS"
    echo ""
    
    SUCCESS_RATE=$(( (PASSED_CHECKS * 100) / TOTAL_CHECKS ))
    
    if [ $FAILED_CHECKS -eq 0 ]; then
        if [ $WARNINGS -eq 0 ]; then
            log_success "🎉 ALL VALIDATIONS PASSED! System is ready for production."
            echo "Success Rate: 100%"
        else
            log_warning "✅ All critical validations passed, but there are $WARNINGS warnings to address."
            echo "Success Rate: $SUCCESS_RATE%"
        fi
        return 0
    else
        log_error "❌ $FAILED_CHECKS critical validations failed. System is NOT ready for production."
        echo "Success Rate: $SUCCESS_RATE%"
        echo ""
        echo "Please address the failed validations before deploying to production."
        return 1
    fi
}

main() {
    echo "🔍 SnapURL Backend System Validation"
    echo "===================================="
    echo ""
    
    # Change to the script directory
    cd "$(dirname "$0")/.."
    
    # Run all validations
    validate_environment
    validate_dependencies
    validate_code_quality
    validate_tests
    validate_database_config
    validate_security_config
    validate_monitoring_config
    validate_production_readiness
    validate_api_documentation
    validate_feature_modules
    validate_property_tests
    
    # Generate final report
    generate_report
}

# Run main function
main "$@"