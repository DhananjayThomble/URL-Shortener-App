#!/bin/bash

# Performance Testing Script for NestJS URL Shortener
# This script runs comprehensive performance tests and generates reports

set -e

# Configuration
APP_URL="http://localhost:3000"
RESULTS_DIR="./performance/results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="$RESULTS_DIR/$TIMESTAMP"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Create results directory
mkdir -p "$REPORT_DIR"

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if application is running
    if ! curl -f -s "$APP_URL/health/simple" > /dev/null; then
        error "Application is not running at $APP_URL"
    fi
    
    # Check if Artillery is installed
    if ! command -v artillery &> /dev/null; then
        warning "Artillery not found, installing..."
        npm install -g artillery
    fi
    
    # Check if Apache Bench is available
    if ! command -v ab &> /dev/null; then
        warning "Apache Bench (ab) not found, some tests will be skipped"
    fi
    
    success "Prerequisites check passed"
}

# Baseline performance test
baseline_test() {
    log "Running baseline performance test..."
    
    # Simple health check test
    log "Testing health endpoint..."
    if command -v ab &> /dev/null; then
        ab -n 1000 -c 10 -g "$REPORT_DIR/health_baseline.tsv" "$APP_URL/health/simple" > "$REPORT_DIR/health_baseline.txt" 2>&1
    fi
    
    # Test API info endpoint
    log "Testing info endpoint..."
    if command -v ab &> /dev/null; then
        ab -n 500 -c 5 -g "$REPORT_DIR/info_baseline.tsv" "$APP_URL/info" > "$REPORT_DIR/info_baseline.txt" 2>&1
    fi
    
    success "Baseline tests completed"
}

# Load testing with Artillery
load_test() {
    log "Running load tests with Artillery..."
    
    # Run comprehensive load test
    artillery run performance/artillery-config.yml --output "$REPORT_DIR/artillery_results.json" > "$REPORT_DIR/artillery_output.txt" 2>&1
    
    # Generate HTML report
    artillery report "$REPORT_DIR/artillery_results.json" --output "$REPORT_DIR/artillery_report.html"
    
    success "Load tests completed"
}

# Stress testing
stress_test() {
    log "Running stress tests..."
    
    if command -v ab &> /dev/null; then
        # High concurrency test
        log "Running high concurrency test..."
        ab -n 5000 -c 100 -g "$REPORT_DIR/stress_high_concurrency.tsv" "$APP_URL/health/simple" > "$REPORT_DIR/stress_high_concurrency.txt" 2>&1
        
        # Sustained load test
        log "Running sustained load test..."
        ab -n 10000 -c 50 -g "$REPORT_DIR/stress_sustained.tsv" "$APP_URL/health/simple" > "$REPORT_DIR/stress_sustained.txt" 2>&1
    fi
    
    success "Stress tests completed"
}

# Database performance test
database_test() {
    log "Running database performance tests..."
    
    # Test URL creation (database write operations)
    log "Testing URL creation performance..."
    
    # Create test script for URL creation
    cat > "$REPORT_DIR/url_creation_test.js" << 'EOF'
const axios = require('axios');
const { performance } = require('perf_hooks');

async function testUrlCreation() {
    const results = [];
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    
    for (let i = 0; i < 100; i++) {
        const start = performance.now();
        
        try {
            const response = await axios.post(`${baseUrl}/api/v1/urls`, {
                originalUrl: `https://example${i}.com`
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test_token'
                },
                timeout: 5000
            });
            
            const end = performance.now();
            results.push({
                iteration: i,
                responseTime: end - start,
                status: response.status,
                success: true
            });
        } catch (error) {
            const end = performance.now();
            results.push({
                iteration: i,
                responseTime: end - start,
                status: error.response?.status || 0,
                success: false,
                error: error.message
            });
        }
    }
    
    // Calculate statistics
    const successfulRequests = results.filter(r => r.success);
    const avgResponseTime = successfulRequests.reduce((sum, r) => sum + r.responseTime, 0) / successfulRequests.length;
    const minResponseTime = Math.min(...successfulRequests.map(r => r.responseTime));
    const maxResponseTime = Math.max(...successfulRequests.map(r => r.responseTime));
    
    console.log(JSON.stringify({
        totalRequests: results.length,
        successfulRequests: successfulRequests.length,
        failedRequests: results.length - successfulRequests.length,
        avgResponseTime: avgResponseTime.toFixed(2),
        minResponseTime: minResponseTime.toFixed(2),
        maxResponseTime: maxResponseTime.toFixed(2),
        results: results
    }, null, 2));
}

testUrlCreation().catch(console.error);
EOF
    
    # Run database performance test
    APP_URL="$APP_URL" node "$REPORT_DIR/url_creation_test.js" > "$REPORT_DIR/database_performance.json" 2>&1
    
    success "Database performance tests completed"
}

# Memory and resource monitoring
resource_monitoring() {
    log "Starting resource monitoring..."
    
    # Monitor system resources during tests
    cat > "$REPORT_DIR/monitor_resources.sh" << 'EOF'
#!/bin/bash
MONITOR_DURATION=${1:-300}  # Default 5 minutes
INTERVAL=5

echo "timestamp,cpu_percent,memory_percent,disk_io,network_io" > resources.csv

for ((i=0; i<$((MONITOR_DURATION/INTERVAL)); i++)); do
    timestamp=$(date +%s)
    
    # Get CPU usage
    cpu_percent=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//')
    
    # Get memory usage
    memory_info=$(free | grep Mem)
    total_mem=$(echo $memory_info | awk '{print $2}')
    used_mem=$(echo $memory_info | awk '{print $3}')
    memory_percent=$(echo "scale=2; $used_mem * 100 / $total_mem" | bc)
    
    # Get disk I/O (simplified)
    disk_io=$(iostat -d 1 1 | tail -n +4 | awk '{sum += $4} END {print sum}')
    
    # Get network I/O (simplified)
    network_io=$(cat /proc/net/dev | grep eth0 | awk '{print $2 + $10}')
    
    echo "$timestamp,$cpu_percent,$memory_percent,$disk_io,$network_io" >> resources.csv
    
    sleep $INTERVAL
done
EOF
    
    chmod +x "$REPORT_DIR/monitor_resources.sh"
    
    # Start monitoring in background
    cd "$REPORT_DIR"
    ./monitor_resources.sh 600 &  # Monitor for 10 minutes
    MONITOR_PID=$!
    cd - > /dev/null
    
    log "Resource monitoring started (PID: $MONITOR_PID)"
}

# Application metrics collection
collect_metrics() {
    log "Collecting application metrics..."
    
    # Collect metrics before tests
    curl -s "$APP_URL/metrics" > "$REPORT_DIR/metrics_before.txt"
    
    # Collect health status
    curl -s "$APP_URL/health" > "$REPORT_DIR/health_before.json"
    
    success "Initial metrics collected"
}

# Generate performance report
generate_report() {
    log "Generating performance report..."
    
    # Collect final metrics
    curl -s "$APP_URL/metrics" > "$REPORT_DIR/metrics_after.txt"
    curl -s "$APP_URL/health" > "$REPORT_DIR/health_after.json"
    
    # Stop resource monitoring
    if [ ! -z "$MONITOR_PID" ]; then
        kill $MONITOR_PID 2>/dev/null || true
    fi
    
    # Generate summary report
    cat > "$REPORT_DIR/performance_summary.md" << EOF
# Performance Test Report

**Test Date:** $(date)
**Application URL:** $APP_URL
**Test Duration:** $(date -d @$(($(date +%s) - START_TIME)) -u +%H:%M:%S)

## Test Results

### Baseline Tests
- Health endpoint performance: See \`health_baseline.txt\`
- Info endpoint performance: See \`info_baseline.txt\`

### Load Tests
- Artillery load test results: See \`artillery_report.html\`
- Detailed results: See \`artillery_results.json\`

### Stress Tests
- High concurrency test: See \`stress_high_concurrency.txt\`
- Sustained load test: See \`stress_sustained.txt\`

### Database Performance
- URL creation performance: See \`database_performance.json\`

### Resource Monitoring
- System resource usage: See \`resources.csv\`

### Application Metrics
- Metrics before tests: See \`metrics_before.txt\`
- Metrics after tests: See \`metrics_after.txt\`
- Health status before: See \`health_before.json\`
- Health status after: See \`health_after.json\`

## Recommendations

Based on the test results, consider the following optimizations:

1. **Response Time Optimization**
   - If average response time > 200ms, investigate database query optimization
   - Consider implementing additional caching layers

2. **Throughput Optimization**
   - If requests/second < expected, consider horizontal scaling
   - Optimize database connection pooling

3. **Resource Optimization**
   - If CPU usage > 70%, consider code optimization or scaling
   - If memory usage > 80%, investigate memory leaks

4. **Database Optimization**
   - If database response time > 100ms, add indexes or optimize queries
   - Consider read replicas for read-heavy workloads

## Files Generated

EOF
    
    # List all generated files
    ls -la "$REPORT_DIR" >> "$REPORT_DIR/performance_summary.md"
    
    success "Performance report generated at $REPORT_DIR/performance_summary.md"
}

# Security performance test
security_test() {
    log "Running security performance tests..."
    
    # Test rate limiting
    log "Testing rate limiting..."
    for i in {1..50}; do
        curl -s -w "%{http_code},%{time_total}\n" "$APP_URL/api/v1/urls" -o /dev/null >> "$REPORT_DIR/rate_limit_test.csv"
        sleep 0.1
    done
    
    # Test authentication performance
    log "Testing authentication performance..."
    if command -v ab &> /dev/null; then
        ab -n 100 -c 5 -H "Authorization: Bearer test_token" "$APP_URL/api/v1/users/profile" > "$REPORT_DIR/auth_performance.txt" 2>&1
    fi
    
    success "Security performance tests completed"
}

# Main execution
main() {
    START_TIME=$(date +%s)
    
    log "Starting performance testing suite..."
    log "Results will be saved to: $REPORT_DIR"
    
    check_prerequisites
    collect_metrics
    resource_monitoring
    
    baseline_test
    load_test
    stress_test
    database_test
    security_test
    
    generate_report
    
    success "Performance testing completed!"
    success "View the report at: $REPORT_DIR/performance_summary.md"
    
    if [ -f "$REPORT_DIR/artillery_report.html" ]; then
        success "View Artillery report at: $REPORT_DIR/artillery_report.html"
    fi
}

# Run main function
main "$@"