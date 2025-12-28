# Performance Testing Suite

This directory contains comprehensive performance testing scenarios for the NestJS backend, designed to validate system performance under various load conditions and establish performance baselines.

## Overview

The performance testing suite includes:

1. **Load Testing** - Tests system performance under expected load conditions
2. **Benchmark Testing** - Establishes performance baselines and monitors regressions
3. **Stress Testing** - Tests system behavior under extreme conditions
4. **Performance Monitoring** - Utilities for measuring and analyzing performance metrics

## Test Files

### 1. Load Testing (`load-testing.spec.ts`)

Tests system performance under various load conditions:

- **Link Creation Load Testing**
  - Concurrent link creation requests (50 concurrent requests)
  - Bulk link creation with different batch sizes (10, 25, 50, 100)
  - Performance degradation analysis

- **Link Access Load Testing**
  - High-volume link access requests (1000 requests in batches)
  - Mixed read/write operations simulation
  - Real-world traffic pattern testing

- **Analytics Load Testing**
  - Concurrent analytics queries (50 concurrent queries)
  - Dashboard analytics under load
  - Complex query performance testing

**Performance Expectations:**
- 95% success rate for link creation
- Average response time < 200ms for link creation
- > 50 RPS for link access
- Average response time < 30ms for link access

### 2. Benchmark Testing (`benchmark.spec.ts`)

Establishes performance baselines and monitors regressions:

- **API Endpoint Benchmarks**
  - Link creation performance (100 iterations)
  - Link access performance (500 iterations)
  - Analytics query performance (50 iterations)

- **Database Operation Benchmarks**
  - Database write operations (200 iterations)
  - Database read operations (300 iterations)
  - Complex query performance

**Performance Baselines:**
- Link creation: > 50 req/s, 95% success rate, < 100ms avg response time
- Link access: > 200 req/s, 98% success rate, < 20ms avg response time
- Analytics queries: > 10 req/s, 95% success rate, < 500ms avg response time
- Database writes: > 30 writes/s, 95% success rate
- Database reads: > 100 reads/s, 98% success rate

### 3. Stress Testing (`stress-testing.spec.ts`)

Tests system behavior under extreme conditions:

- **High Volume Stress Tests**
  - Extreme concurrent link creation (500 concurrent requests)
  - Sustained high-volume link access (2000 requests over 30 seconds)

- **Resource Exhaustion Tests**
  - Memory pressure testing (200 iterations with large payloads)
  - Database connection exhaustion (100 concurrent operations)

- **Error Recovery Tests**
  - Temporary service disruption recovery (20-second continuous testing)
  - System stability under sustained load

- **Cascading Failure Tests**
  - Multi-phase load testing with increasing complexity
  - System adaptation under progressive load

**Stress Test Expectations:**
- > 70% success rate under extreme load (500 concurrent requests)
- > 85% success rate for sustained load
- Memory increase < 500MB under stress
- System recovery and adaptation capabilities

## Performance Monitoring Utilities

### Performance Monitor (`test/utils/performance-monitor.ts`)

Comprehensive performance monitoring utilities:

- **PerformanceMonitor Class**
  - Real-time performance metrics collection
  - Response time statistics (min, max, avg, P50, P95, P99)
  - Memory usage tracking
  - Error breakdown analysis
  - Throughput calculation

- **PerformanceReporter Class**
  - Performance metrics persistence
  - Benchmark history tracking
  - Trend analysis and reporting
  - Performance regression detection

- **LoadTestRunner Class**
  - Configurable load test execution
  - Duration-based and iteration-based testing
  - Concurrent worker management
  - Ramp-up time configuration

## Configuration

### Jest Configuration (`jest-performance.json`)

Specialized Jest configuration for performance testing:

- Extended timeout (300 seconds)
- Single worker execution (`maxWorkers: 1`)
- ES module support for nanoid
- Test environment setup
- Coverage collection

### Package.json Scripts

Performance testing scripts:

```bash
npm run test:performance    # Run all performance tests
npm run test:load          # Run load testing only
npm run test:benchmark     # Run benchmark testing only
npm run test:stress        # Run stress testing only
```

## Running Performance Tests

### Prerequisites

Before running performance tests, ensure:

1. **Database Services Running**
   - PostgreSQL server running on localhost:5432
   - MongoDB server running on localhost:27017
   - Redis server running on localhost:6379

2. **Environment Configuration**
   - `.env.test` file configured with database connections
   - `BASE_URL` environment variable set

3. **Dependencies Installed**
   - All npm dependencies installed
   - `cross-env` package for Windows compatibility

### Execution Commands

```bash
# Run all performance tests
npm run test:performance

# Run specific test suites
npm run test:load          # Load testing
npm run test:benchmark     # Benchmark testing
npm run test:stress        # Stress testing

# Run specific test with custom timeout
npm run test:benchmark -- --testTimeout=300000 --testNamePattern="link creation"
```

### Test Environment Setup

The performance tests use the same test setup as other test suites:

- **Test Data Manager** - Creates and manages test scenarios
- **Database Cleanup** - Ensures clean state between tests
- **User Authentication** - Creates test users and tokens
- **Test Data Factory** - Generates realistic test data

## Performance Metrics and Reporting

### Metrics Collected

- **Response Time Statistics**: min, max, average, P50, P95, P99
- **Throughput**: requests per second
- **Success Rate**: percentage of successful requests
- **Memory Usage**: initial, peak, and final memory consumption
- **Error Breakdown**: categorized error analysis

### Reporting Features

- **Console Output**: Real-time performance metrics during test execution
- **JSON Reports**: Structured performance data for analysis
- **Trend Analysis**: Historical performance comparison
- **Benchmark History**: Performance regression tracking

### Report Files

Performance reports are saved to:

- `test/reports/performance-report.json` - Detailed performance metrics
- `test/reports/benchmark-history.json` - Historical benchmark data
- `test/reports/benchmark-results.json` - Benchmark execution results

## Performance Expectations and SLAs

### Service Level Objectives (SLOs)

1. **Link Creation**
   - Throughput: > 50 requests/second
   - Success Rate: > 95%
   - Response Time: < 100ms average, < 200ms P95

2. **Link Access**
   - Throughput: > 200 requests/second
   - Success Rate: > 98%
   - Response Time: < 20ms average, < 50ms P95

3. **Analytics Queries**
   - Throughput: > 10 requests/second
   - Success Rate: > 95%
   - Response Time: < 500ms average, < 1000ms P95

4. **System Stability**
   - Memory Usage: < 1GB increase under normal load
   - Error Recovery: System should recover within 30 seconds
   - Concurrent Users: Support > 100 concurrent users

### Performance Thresholds

- **Warning Threshold**: 10% degradation from baseline
- **Critical Threshold**: 25% degradation from baseline
- **Failure Threshold**: 50% degradation from baseline

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Ensure all database services are running
   - Check connection strings in `.env.test`
   - Verify network connectivity

2. **Memory Issues**
   - Increase Node.js memory limit: `--max-old-space-size=4096`
   - Monitor memory usage during tests
   - Check for memory leaks in application code

3. **Timeout Errors**
   - Increase Jest timeout in configuration
   - Check system resources and load
   - Verify database performance

4. **ES Module Issues**
   - Ensure Jest configuration supports ES modules
   - Check `transformIgnorePatterns` for nanoid
   - Verify TypeScript compilation settings

### Performance Optimization Tips

1. **Database Optimization**
   - Use connection pooling
   - Implement proper indexing
   - Optimize query patterns

2. **Caching Strategy**
   - Implement Redis caching for frequently accessed data
   - Use appropriate cache TTL values
   - Monitor cache hit rates

3. **Application Optimization**
   - Use async/await properly
   - Implement request batching
   - Optimize serialization/deserialization

## Integration with CI/CD

The performance testing suite is designed to integrate with CI/CD pipelines:

- **Automated Execution**: Tests can run automatically on deployment
- **Performance Regression Detection**: Compare results with historical baselines
- **Quality Gates**: Fail deployments if performance degrades significantly
- **Monitoring Integration**: Export metrics to monitoring systems

## Future Enhancements

Planned improvements for the performance testing suite:

1. **Real-world Traffic Simulation**: More realistic user behavior patterns
2. **Distributed Load Testing**: Multi-node load generation
3. **Performance Profiling**: CPU and memory profiling integration
4. **Custom Metrics**: Business-specific performance indicators
5. **Automated Alerting**: Performance degradation notifications
6. **Performance Dashboards**: Real-time performance monitoring

## Conclusion

This comprehensive performance testing suite provides:

- **Baseline Establishment**: Clear performance expectations and SLOs
- **Regression Detection**: Automated performance monitoring
- **Scalability Validation**: System behavior under various load conditions
- **Quality Assurance**: Performance-focused quality gates
- **Continuous Improvement**: Data-driven performance optimization

The suite ensures the NestJS backend maintains high performance standards while supporting the growing demands of the URL shortening service.