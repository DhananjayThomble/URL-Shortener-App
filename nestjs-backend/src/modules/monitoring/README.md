# Monitoring and Observability Module

This module provides comprehensive monitoring and observability capabilities for the NestJS URL Shortener application, including health checks, metrics collection, structured logging, and distributed tracing.

## Features

### 1. Health Checks
- **Basic Health Check**: `/health` - Overall system health status
- **Detailed Health Check**: `/health/detailed` - Detailed status of all services
- **Readiness Probe**: `/health/ready` - Kubernetes readiness probe
- **Liveness Probe**: `/health/live` - Kubernetes liveness probe
- **External Services**: `/health/external` - External service dependencies

### 2. Metrics Collection
- **Prometheus Metrics**: `/metrics` - Prometheus-compatible metrics
- **JSON Metrics**: `/metrics/json` - Metrics in JSON format
- **Business Metrics**: `/metrics/business` - Business-specific metrics
- **Metrics Health**: `/metrics/health` - Metrics service health

### 3. Structured Logging
- Correlation ID tracking across requests
- Structured JSON logging with Winston
- CloudWatch integration for production
- Business-specific logging methods
- Error aggregation and monitoring

### 4. Distributed Tracing
- OpenTelemetry integration
- Jaeger exporter for trace visualization
- Automatic HTTP request tracing
- Business operation tracing
- Database and cache operation tracing

## Configuration

### Environment Variables

```bash
# Logging Configuration
LOG_LEVEL=info                              # Log level (error, warn, info, debug, verbose)

# Prometheus Configuration
ENABLE_PROMETHEUS_TRACING=true              # Enable Prometheus metrics export
PROMETHEUS_METRICS_PORT=9090                # Port for Prometheus metrics server

# Distributed Tracing Configuration
JAEGER_ENDPOINT=http://localhost:14268/api/traces  # Jaeger collector endpoint
ENABLE_DISTRIBUTED_TRACING=true            # Enable distributed tracing

# CloudWatch Configuration (Production)
AWS_CLOUDWATCH_LOG_GROUP=url-shortener     # CloudWatch log group name
AWS_CLOUDWATCH_LOG_STREAM=nestjs-app       # CloudWatch log stream name
AWS_REGION=us-east-1                       # AWS region

# Application Configuration
APP_VERSION=1.0.0                          # Application version for tracing
NODE_ENV=production                        # Environment (affects logging behavior)
```

## Usage

### Health Checks

```typescript
// Inject health check service
constructor(private readonly healthService: HealthCheckService) {}

// Check overall health
const health = await this.healthService.checkDatabaseHealth();

// Check individual service
const postgresHealth = await this.healthService.checkIndividualService('postgresql');
```

### Metrics Collection

```typescript
// Inject metrics service
constructor(private readonly metricsService: MetricsService) {}

// Record business metrics
this.metricsService.recordUrlCreation(userId, hasCustomAlias);
this.metricsService.recordUrlClick(urlId, deviceType, country);
this.metricsService.updateActiveUsers(count);

// Record system metrics
this.metricsService.recordHttpRequest(method, route, statusCode, duration);
this.metricsService.recordError(errorType, module, severity);
```

### Structured Logging

```typescript
// Inject logging service
constructor(private readonly loggingService: LoggingService) {}

// Basic logging with context
this.loggingService.log('Operation completed', {
  userId: 'user123',
  module: 'urls',
  operation: 'create',
  metadata: { urlId: 'url456' }
});

// Business-specific logging
this.loggingService.logUrlCreation(userId, urlId, originalUrl, shortCode);
this.loggingService.logAuthAttempt(email, success, reason);
this.loggingService.logSecurityEvent(eventType, severity, details);

// Set correlation ID for request tracing
const correlationId = this.loggingService.generateCorrelationId();
```

### Distributed Tracing

```typescript
// Inject tracing service
constructor(private readonly tracingService: TracingService) {}

// Trace business operations
const result = await this.tracingService.traceUrlCreation(
  userId,
  originalUrl,
  async () => {
    // Your business logic here
    return await this.createUrl(data);
  }
);

// Trace database operations
const dbResult = await this.tracingService.traceDatabaseOperation(
  'SELECT',
  'links',
  'SELECT * FROM links WHERE id = $1',
  async () => {
    return await this.repository.findOne(id);
  }
);
```

## Monitoring Endpoints

### Health Check Endpoints

| Endpoint | Description | Use Case |
|----------|-------------|----------|
| `GET /health` | Basic health check | Load balancer health check |
| `GET /health/detailed` | Detailed service health | Debugging and monitoring |
| `GET /health/ready` | Readiness probe | Kubernetes readiness |
| `GET /health/live` | Liveness probe | Kubernetes liveness |
| `GET /health/external` | External services health | Dependency monitoring |

### Metrics Endpoints

| Endpoint | Description | Format |
|----------|-------------|--------|
| `GET /metrics` | Prometheus metrics | Text/Plain |
| `GET /metrics/json` | All metrics | JSON |
| `GET /metrics/business` | Business metrics | JSON |
| `GET /metrics/health` | Metrics service health | JSON |

## Metrics Available

### HTTP Metrics
- `http_requests_total` - Total HTTP requests by method, route, status
- `http_request_duration_seconds` - HTTP request duration histogram

### Business Metrics
- `urls_created_total` - Total URLs created
- `url_clicks_total` - Total URL clicks
- `active_users_current` - Current active users
- `bio_page_views_total` - Bio page views
- `auth_attempts_total` - Authentication attempts

### System Metrics
- `database_connections_active` - Active database connections
- `database_query_duration_seconds` - Database query duration
- `cache_hits_total` / `cache_misses_total` - Cache performance
- `errors_total` - Error counts by type and severity
- `memory_usage_bytes` - Memory usage by type

## Integration with External Systems

### Prometheus
Configure Prometheus to scrape metrics:

```yaml
scrape_configs:
  - job_name: 'nestjs-url-shortener'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

### Grafana Dashboard
Import the provided Grafana dashboard configuration to visualize:
- HTTP request rates and latencies
- Business metrics (URL creation, clicks)
- System health and performance
- Error rates and types

### Jaeger Tracing
Configure Jaeger to collect traces:

```yaml
version: '3'
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"
      - "14268:14268"
    environment:
      - COLLECTOR_OTLP_ENABLED=true
```

### CloudWatch Logs
For production deployment, logs are automatically sent to CloudWatch when configured:

```bash
AWS_CLOUDWATCH_LOG_GROUP=url-shortener
AWS_CLOUDWATCH_LOG_STREAM=nestjs-app
AWS_REGION=us-east-1
```

## Best Practices

### Logging
1. Always include correlation IDs for request tracing
2. Use structured logging with consistent field names
3. Log business events for audit trails
4. Avoid logging sensitive information (passwords, tokens)
5. Use appropriate log levels (error, warn, info, debug)

### Metrics
1. Use labels consistently across metrics
2. Avoid high-cardinality labels (like user IDs in labels)
3. Monitor both technical and business metrics
4. Set up alerting on critical metrics
5. Regular cleanup of old metrics data

### Tracing
1. Trace critical business operations
2. Include relevant attributes in spans
3. Use consistent naming conventions
4. Avoid tracing high-frequency operations that don't add value
5. Monitor trace sampling rates in production

### Health Checks
1. Include all critical dependencies
2. Set appropriate timeouts
3. Provide meaningful error messages
4. Use different endpoints for different purposes (liveness vs readiness)
5. Monitor health check response times

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Check for memory leaks in metrics collection
2. **Slow Health Checks**: Increase database connection timeouts
3. **Missing Traces**: Verify Jaeger endpoint configuration
4. **Log Volume**: Adjust log levels in production
5. **Metrics Gaps**: Check Prometheus scraping configuration

### Debug Commands

```bash
# Check health status
curl http://localhost:3000/health

# Get metrics
curl http://localhost:3000/metrics

# Check specific service health
curl http://localhost:3000/health/detailed

# View business metrics
curl http://localhost:3000/metrics/business
```

## Performance Considerations

- Metrics collection adds ~1-2ms overhead per request
- Structured logging adds ~0.5-1ms overhead per request
- Distributed tracing adds ~2-5ms overhead per traced operation
- Health checks should complete within 5 seconds
- Log rotation is configured to prevent disk space issues
- Metrics are automatically cleaned up after 10 completed/failed jobs

## Security Considerations

- Health check endpoints don't require authentication
- Metrics endpoints should be protected in production
- Sensitive data is never logged or traced
- Correlation IDs are generated securely
- CloudWatch logs are encrypted in transit and at rest