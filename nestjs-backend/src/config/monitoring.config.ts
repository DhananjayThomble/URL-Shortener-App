/**
 * Monitoring and Alerting Configuration
 * Sets up Prometheus metrics, Grafana dashboards, and alerting rules
 */

import { registerAs } from '@nestjs/config';

export default registerAs('monitoring', () => ({
  // Prometheus configuration
  prometheus: {
    enabled: process.env.PROMETHEUS_ENABLED === 'true',
    endpoint: process.env.PROMETHEUS_ENDPOINT || '/metrics',
    port: parseInt(process.env.PROMETHEUS_PORT, 10) || 9090,
    defaultMetrics: process.env.PROMETHEUS_DEFAULT_METRICS !== 'false',
    prefix: process.env.PROMETHEUS_PREFIX || 'snapurl_',
    collectDefaultMetrics: true,
    timeout: parseInt(process.env.PROMETHEUS_TIMEOUT, 10) || 10000,
    register: {
      clear: process.env.PROMETHEUS_CLEAR_REGISTER === 'true',
    },
  },

  // Grafana configuration
  grafana: {
    enabled: process.env.GRAFANA_ENABLED === 'true',
    url: process.env.GRAFANA_URL || 'http://localhost:3000',
    apiKey: process.env.GRAFANA_API_KEY,
    username: process.env.GRAFANA_USERNAME || 'admin',
    password: process.env.GRAFANA_PASSWORD || 'admin',
    orgId: parseInt(process.env.GRAFANA_ORG_ID, 10) || 1,
    dashboards: {
      folder: process.env.GRAFANA_DASHBOARD_FOLDER || 'SnapURL',
      tags: process.env.GRAFANA_DASHBOARD_TAGS?.split(',') || ['snapurl', 'backend'],
      refresh: process.env.GRAFANA_DASHBOARD_REFRESH || '30s',
      timeRange: process.env.GRAFANA_DASHBOARD_TIME_RANGE || '1h',
    },
    datasource: {
      name: process.env.GRAFANA_DATASOURCE_NAME || 'Prometheus',
      type: 'prometheus',
      url: process.env.GRAFANA_PROMETHEUS_URL || 'http://localhost:9090',
      access: 'proxy',
      isDefault: true,
    },
  },

  // Alerting configuration
  alerting: {
    enabled: process.env.ALERTING_ENABLED === 'true',
    rules: {
      // Application health alerts
      healthCheck: {
        enabled: process.env.ALERT_HEALTH_CHECK_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_HEALTH_CHECK_THRESHOLD) || 0.95,
        duration: process.env.ALERT_HEALTH_CHECK_DURATION || '5m',
        severity: process.env.ALERT_HEALTH_CHECK_SEVERITY || 'critical',
      },
      
      // Database connectivity alerts
      databaseConnection: {
        enabled: process.env.ALERT_DB_CONNECTION_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_DB_CONNECTION_THRESHOLD) || 0.9,
        duration: process.env.ALERT_DB_CONNECTION_DURATION || '2m',
        severity: process.env.ALERT_DB_CONNECTION_SEVERITY || 'critical',
      },

      // Response time alerts
      responseTime: {
        enabled: process.env.ALERT_RESPONSE_TIME_ENABLED !== 'false',
        threshold: parseInt(process.env.ALERT_RESPONSE_TIME_THRESHOLD, 10) || 2000, // 2 seconds
        duration: process.env.ALERT_RESPONSE_TIME_DURATION || '5m',
        severity: process.env.ALERT_RESPONSE_TIME_SEVERITY || 'warning',
      },

      // Error rate alerts
      errorRate: {
        enabled: process.env.ALERT_ERROR_RATE_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_ERROR_RATE_THRESHOLD) || 0.05, // 5%
        duration: process.env.ALERT_ERROR_RATE_DURATION || '5m',
        severity: process.env.ALERT_ERROR_RATE_SEVERITY || 'warning',
      },

      // Memory usage alerts
      memoryUsage: {
        enabled: process.env.ALERT_MEMORY_USAGE_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_MEMORY_USAGE_THRESHOLD) || 0.85, // 85%
        duration: process.env.ALERT_MEMORY_USAGE_DURATION || '10m',
        severity: process.env.ALERT_MEMORY_USAGE_SEVERITY || 'warning',
      },

      // CPU usage alerts
      cpuUsage: {
        enabled: process.env.ALERT_CPU_USAGE_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_CPU_USAGE_THRESHOLD) || 0.8, // 80%
        duration: process.env.ALERT_CPU_USAGE_DURATION || '10m',
        severity: process.env.ALERT_CPU_USAGE_SEVERITY || 'warning',
      },

      // Disk usage alerts
      diskUsage: {
        enabled: process.env.ALERT_DISK_USAGE_ENABLED !== 'false',
        threshold: parseFloat(process.env.ALERT_DISK_USAGE_THRESHOLD) || 0.9, // 90%
        duration: process.env.ALERT_DISK_USAGE_DURATION || '15m',
        severity: process.env.ALERT_DISK_USAGE_SEVERITY || 'critical',
      },

      // Rate limiting alerts
      rateLimitHit: {
        enabled: process.env.ALERT_RATE_LIMIT_ENABLED !== 'false',
        threshold: parseInt(process.env.ALERT_RATE_LIMIT_THRESHOLD, 10) || 100,
        duration: process.env.ALERT_RATE_LIMIT_DURATION || '5m',
        severity: process.env.ALERT_RATE_LIMIT_SEVERITY || 'warning',
      },
    },

    // Notification channels
    notifications: {
      slack: {
        enabled: process.env.SLACK_NOTIFICATIONS_ENABLED === 'true',
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        channel: process.env.SLACK_CHANNEL || '#alerts',
        username: process.env.SLACK_USERNAME || 'SnapURL Monitor',
        iconEmoji: process.env.SLACK_ICON_EMOJI || ':warning:',
      },
      
      email: {
        enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true',
        recipients: process.env.EMAIL_ALERT_RECIPIENTS?.split(',') || [],
        subject: process.env.EMAIL_ALERT_SUBJECT || '[SnapURL] Alert: {{alertname}}',
        template: process.env.EMAIL_ALERT_TEMPLATE || 'default',
      },

      webhook: {
        enabled: process.env.WEBHOOK_NOTIFICATIONS_ENABLED === 'true',
        url: process.env.WEBHOOK_NOTIFICATION_URL,
        method: process.env.WEBHOOK_METHOD || 'POST',
        headers: process.env.WEBHOOK_HEADERS ? JSON.parse(process.env.WEBHOOK_HEADERS) : {},
        timeout: parseInt(process.env.WEBHOOK_TIMEOUT, 10) || 10000,
      },

      pagerduty: {
        enabled: process.env.PAGERDUTY_NOTIFICATIONS_ENABLED === 'true',
        integrationKey: process.env.PAGERDUTY_INTEGRATION_KEY,
        severity: process.env.PAGERDUTY_SEVERITY || 'error',
        component: process.env.PAGERDUTY_COMPONENT || 'snapurl-backend',
        group: process.env.PAGERDUTY_GROUP || 'backend',
        class: process.env.PAGERDUTY_CLASS || 'application',
      },
    },
  },

  // Custom metrics configuration
  customMetrics: {
    // Business metrics
    urlShortening: {
      enabled: process.env.METRIC_URL_SHORTENING_ENABLED !== 'false',
      buckets: process.env.METRIC_URL_SHORTENING_BUCKETS?.split(',').map(Number) || [0.1, 0.5, 1, 2, 5],
    },
    
    urlRedirection: {
      enabled: process.env.METRIC_URL_REDIRECTION_ENABLED !== 'false',
      buckets: process.env.METRIC_URL_REDIRECTION_BUCKETS?.split(',').map(Number) || [0.01, 0.05, 0.1, 0.5, 1],
    },

    authentication: {
      enabled: process.env.METRIC_AUTHENTICATION_ENABLED !== 'false',
      buckets: process.env.METRIC_AUTHENTICATION_BUCKETS?.split(',').map(Number) || [0.1, 0.5, 1, 2, 5],
    },

    databaseOperations: {
      enabled: process.env.METRIC_DATABASE_OPERATIONS_ENABLED !== 'false',
      buckets: process.env.METRIC_DATABASE_BUCKETS?.split(',').map(Number) || [0.01, 0.05, 0.1, 0.5, 1, 2],
    },

    cacheOperations: {
      enabled: process.env.METRIC_CACHE_OPERATIONS_ENABLED !== 'false',
      buckets: process.env.METRIC_CACHE_BUCKETS?.split(',').map(Number) || [0.001, 0.005, 0.01, 0.05, 0.1],
    },

    // User activity metrics
    userRegistrations: {
      enabled: process.env.METRIC_USER_REGISTRATIONS_ENABLED !== 'false',
    },

    activeUsers: {
      enabled: process.env.METRIC_ACTIVE_USERS_ENABLED !== 'false',
      timeWindows: process.env.METRIC_ACTIVE_USERS_WINDOWS?.split(',') || ['1h', '24h', '7d'],
    },

    // System metrics
    memoryUsage: {
      enabled: process.env.METRIC_MEMORY_USAGE_ENABLED !== 'false',
      interval: parseInt(process.env.METRIC_MEMORY_INTERVAL, 10) || 30000, // 30 seconds
    },

    cpuUsage: {
      enabled: process.env.METRIC_CPU_USAGE_ENABLED !== 'false',
      interval: parseInt(process.env.METRIC_CPU_INTERVAL, 10) || 30000, // 30 seconds
    },

    eventLoop: {
      enabled: process.env.METRIC_EVENT_LOOP_ENABLED !== 'false',
      interval: parseInt(process.env.METRIC_EVENT_LOOP_INTERVAL, 10) || 10000, // 10 seconds
    },
  },

  // Health check configuration
  healthChecks: {
    enabled: process.env.HEALTH_CHECKS_ENABLED !== 'false',
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 30000, // 30 seconds
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT, 10) || 5000, // 5 seconds
    retries: parseInt(process.env.HEALTH_CHECK_RETRIES, 10) || 3,
    
    checks: {
      database: {
        enabled: process.env.HEALTH_CHECK_DATABASE_ENABLED !== 'false',
        timeout: parseInt(process.env.HEALTH_CHECK_DATABASE_TIMEOUT, 10) || 5000,
      },
      
      redis: {
        enabled: process.env.HEALTH_CHECK_REDIS_ENABLED !== 'false',
        timeout: parseInt(process.env.HEALTH_CHECK_REDIS_TIMEOUT, 10) || 3000,
      },
      
      externalServices: {
        enabled: process.env.HEALTH_CHECK_EXTERNAL_ENABLED !== 'false',
        timeout: parseInt(process.env.HEALTH_CHECK_EXTERNAL_TIMEOUT, 10) || 10000,
        services: process.env.HEALTH_CHECK_EXTERNAL_SERVICES?.split(',') || [],
      },
    },
  },

  // Log aggregation configuration
  logAggregation: {
    enabled: process.env.LOG_AGGREGATION_ENABLED === 'true',
    
    elasticsearch: {
      enabled: process.env.ELASTICSEARCH_ENABLED === 'true',
      host: process.env.ELASTICSEARCH_HOST || 'localhost:9200',
      index: process.env.ELASTICSEARCH_INDEX || 'snapurl-logs',
      username: process.env.ELASTICSEARCH_USERNAME,
      password: process.env.ELASTICSEARCH_PASSWORD,
      ssl: process.env.ELASTICSEARCH_SSL === 'true',
      apiVersion: process.env.ELASTICSEARCH_API_VERSION || '7.x',
    },

    fluentd: {
      enabled: process.env.FLUENTD_ENABLED === 'true',
      host: process.env.FLUENTD_HOST || 'localhost',
      port: parseInt(process.env.FLUENTD_PORT, 10) || 24224,
      tag: process.env.FLUENTD_TAG || 'snapurl.backend',
      timeout: parseInt(process.env.FLUENTD_TIMEOUT, 10) || 3000,
    },

    cloudwatch: {
      enabled: process.env.CLOUDWATCH_LOGS_ENABLED === 'true',
      logGroupName: process.env.CLOUDWATCH_LOG_GROUP || '/aws/ec2/snapurl',
      logStreamName: process.env.CLOUDWATCH_LOG_STREAM || 'backend',
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  },

  // Tracing configuration
  tracing: {
    enabled: process.env.TRACING_ENABLED === 'true',
    
    jaeger: {
      enabled: process.env.JAEGER_ENABLED === 'true',
      endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces',
      serviceName: process.env.JAEGER_SERVICE_NAME || 'snapurl-backend',
      sampler: {
        type: process.env.JAEGER_SAMPLER_TYPE || 'const',
        param: parseFloat(process.env.JAEGER_SAMPLER_PARAM) || 1,
      },
    },

    zipkin: {
      enabled: process.env.ZIPKIN_ENABLED === 'true',
      endpoint: process.env.ZIPKIN_ENDPOINT || 'http://localhost:9411/api/v2/spans',
      serviceName: process.env.ZIPKIN_SERVICE_NAME || 'snapurl-backend',
      sampleRate: parseFloat(process.env.ZIPKIN_SAMPLE_RATE) || 0.1,
    },
  },
}));