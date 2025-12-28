/**
 * Production environment configuration
 * Handles production-specific settings for databases, external services, and security
 */

import { registerAs } from '@nestjs/config';

export default registerAs('production', () => ({
  // Database configurations for production
  database: {
    postgresql: {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
      username: process.env.POSTGRES_USERNAME || 'postgres',
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE || 'snapurl_prod',
      ssl: process.env.POSTGRES_SSL === 'true' ? {
        rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false',
        ca: process.env.POSTGRES_SSL_CA,
        cert: process.env.POSTGRES_SSL_CERT,
        key: process.env.POSTGRES_SSL_KEY,
      } : false,
      synchronize: false, // Never use synchronize in production
      logging: process.env.POSTGRES_LOGGING === 'true' ? ['error', 'warn'] : false,
      maxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS, 10) || 100,
      acquireTimeout: parseInt(process.env.POSTGRES_ACQUIRE_TIMEOUT, 10) || 60000,
      timeout: parseInt(process.env.POSTGRES_TIMEOUT, 10) || 60000,
      reconnectTries: parseInt(process.env.POSTGRES_RECONNECT_TRIES, 10) || 3,
      reconnectInterval: parseInt(process.env.POSTGRES_RECONNECT_INTERVAL, 10) || 2000,
    },
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/snapurl_prod',
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 50,
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10) || 5,
        maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME, 10) || 30000,
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT, 10) || 5000,
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT, 10) || 45000,
        connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT, 10) || 10000,
        retryWrites: true,
        w: 'majority',
        readPreference: 'primaryPreferred',
        ssl: process.env.MONGODB_SSL === 'true',
        sslValidate: process.env.MONGODB_SSL_VALIDATE !== 'false',
        sslCA: process.env.MONGODB_SSL_CA,
        sslCert: process.env.MONGODB_SSL_CERT,
        sslKey: process.env.MONGODB_SSL_KEY,
      },
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'snapurl:prod:',
      retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY, 10) || 100,
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES, 10) || 3,
      lazyConnect: true,
      keepAlive: parseInt(process.env.REDIS_KEEP_ALIVE, 10) || 30000,
      family: parseInt(process.env.REDIS_FAMILY, 10) || 4,
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT, 10) || 10000,
      commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT, 10) || 5000,
      // Cluster configuration if using Redis Cluster
      cluster: process.env.REDIS_CLUSTER === 'true' ? {
        enableReadyCheck: false,
        redisOptions: {
          password: process.env.REDIS_PASSWORD,
        },
        clusterRetryDelayOnFailover: 100,
        clusterRetryDelayOnClusterDown: 300,
        clusterMaxRedirections: 6,
        scaleReads: 'slave',
      } : null,
      // Sentinel configuration if using Redis Sentinel
      sentinel: process.env.REDIS_SENTINEL === 'true' ? {
        sentinels: process.env.REDIS_SENTINELS?.split(',').map(s => {
          const [host, port] = s.split(':');
          return { host, port: parseInt(port, 10) };
        }) || [],
        name: process.env.REDIS_SENTINEL_NAME || 'mymaster',
        password: process.env.REDIS_SENTINEL_PASSWORD,
      } : null,
    },
  },

  // External service integrations
  services: {
    email: {
      provider: process.env.EMAIL_PROVIDER || 'smtp',
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
        tls: {
          rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
        },
      },
      sendgrid: {
        apiKey: process.env.SENDGRID_API_KEY,
        from: process.env.SENDGRID_FROM_EMAIL,
      },
      ses: {
        region: process.env.AWS_SES_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        from: process.env.AWS_SES_FROM_EMAIL,
      },
    },
    geoip: {
      provider: process.env.GEOIP_PROVIDER || 'maxmind',
      maxmind: {
        licenseKey: process.env.MAXMIND_LICENSE_KEY,
        userId: process.env.MAXMIND_USER_ID,
        databasePath: process.env.MAXMIND_DATABASE_PATH || '/opt/geoip/GeoLite2-City.mmdb',
        updateInterval: parseInt(process.env.MAXMIND_UPDATE_INTERVAL, 10) || 86400000, // 24 hours
      },
      ipapi: {
        apiKey: process.env.IPAPI_API_KEY,
        baseUrl: process.env.IPAPI_BASE_URL || 'http://api.ipapi.com',
        timeout: parseInt(process.env.IPAPI_TIMEOUT, 10) || 5000,
      },
    },
    monitoring: {
      prometheus: {
        enabled: process.env.PROMETHEUS_ENABLED === 'true',
        endpoint: process.env.PROMETHEUS_ENDPOINT || '/metrics',
        defaultMetrics: process.env.PROMETHEUS_DEFAULT_METRICS !== 'false',
        prefix: process.env.PROMETHEUS_PREFIX || 'snapurl_',
      },
      grafana: {
        enabled: process.env.GRAFANA_ENABLED === 'true',
        url: process.env.GRAFANA_URL,
        apiKey: process.env.GRAFANA_API_KEY,
        dashboardId: process.env.GRAFANA_DASHBOARD_ID,
      },
      sentry: {
        enabled: process.env.SENTRY_ENABLED === 'true',
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || 'production',
        release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,
        profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE) || 0.1,
      },
      datadog: {
        enabled: process.env.DATADOG_ENABLED === 'true',
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        site: process.env.DATADOG_SITE || 'datadoghq.com',
        service: process.env.DATADOG_SERVICE || 'snapurl-backend',
        version: process.env.DATADOG_VERSION || process.env.npm_package_version,
        env: process.env.DATADOG_ENV || 'production',
      },
    },
    storage: {
      provider: process.env.STORAGE_PROVIDER || 'local',
      local: {
        uploadPath: process.env.LOCAL_UPLOAD_PATH || '/opt/snapurl/uploads',
        maxFileSize: parseInt(process.env.LOCAL_MAX_FILE_SIZE, 10) || 10485760, // 10MB
      },
      s3: {
        region: process.env.AWS_S3_REGION || 'us-east-1',
        bucket: process.env.AWS_S3_BUCKET,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        endpoint: process.env.AWS_S3_ENDPOINT,
        forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
        maxFileSize: parseInt(process.env.S3_MAX_FILE_SIZE, 10) || 52428800, // 50MB
      },
      gcs: {
        projectId: process.env.GCS_PROJECT_ID,
        keyFilename: process.env.GCS_KEY_FILENAME,
        bucket: process.env.GCS_BUCKET,
        maxFileSize: parseInt(process.env.GCS_MAX_FILE_SIZE, 10) || 52428800, // 50MB
      },
    },
  },

  // Security configurations
  security: {
    jwt: {
      secret: process.env.JWT_SECRET,
      accessTokenExpiration: process.env.JWT_ACCESS_TOKEN_EXPIRATION || '15m',
      refreshTokenExpiration: process.env.JWT_REFRESH_TOKEN_EXPIRATION || '7d',
      issuer: process.env.JWT_ISSUER || 'snapurl',
      audience: process.env.JWT_AUDIENCE || 'snapurl-users',
    },
    bcrypt: {
      rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    },
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || ['https://snapurl.com'],
      credentials: process.env.CORS_CREDENTIALS === 'true',
      methods: process.env.CORS_METHODS?.split(',') || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: process.env.CORS_ALLOWED_HEADERS?.split(',') || [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
        'X-API-Key',
      ],
      exposedHeaders: process.env.CORS_EXPOSED_HEADERS?.split(',') || ['X-Total-Count'],
      maxAge: parseInt(process.env.CORS_MAX_AGE, 10) || 86400,
    },
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
      message: process.env.RATE_LIMIT_MESSAGE || 'Too many requests from this IP',
      standardHeaders: process.env.RATE_LIMIT_STANDARD_HEADERS !== 'false',
      legacyHeaders: process.env.RATE_LIMIT_LEGACY_HEADERS === 'true',
      skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESSFUL === 'true',
      skipFailedRequests: process.env.RATE_LIMIT_SKIP_FAILED === 'true',
    },
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'", process.env.API_BASE_URL || 'https://api.snapurl.com'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    },
  },

  // Application settings
  app: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    globalPrefix: process.env.GLOBAL_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
    baseUrl: process.env.BASE_URL || 'https://snapurl.com',
    apiBaseUrl: process.env.API_BASE_URL || 'https://api.snapurl.com',
    frontendUrl: process.env.FRONTEND_URL || 'https://snapurl.com',
    maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
    trustProxy: process.env.TRUST_PROXY === 'true',
    compression: {
      enabled: process.env.COMPRESSION_ENABLED !== 'false',
      level: parseInt(process.env.COMPRESSION_LEVEL, 10) || 6,
      threshold: parseInt(process.env.COMPRESSION_THRESHOLD, 10) || 1024,
    },
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    transports: {
      console: {
        enabled: process.env.LOG_CONSOLE_ENABLED !== 'false',
        colorize: process.env.LOG_CONSOLE_COLORIZE === 'true',
      },
      file: {
        enabled: process.env.LOG_FILE_ENABLED === 'true',
        filename: process.env.LOG_FILE_NAME || '/var/log/snapurl/app.log',
        maxSize: process.env.LOG_FILE_MAX_SIZE || '20m',
        maxFiles: parseInt(process.env.LOG_FILE_MAX_FILES, 10) || 5,
        tailable: process.env.LOG_FILE_TAILABLE !== 'false',
      },
      elasticsearch: {
        enabled: process.env.LOG_ELASTICSEARCH_ENABLED === 'true',
        host: process.env.ELASTICSEARCH_HOST || 'localhost:9200',
        index: process.env.ELASTICSEARCH_INDEX || 'snapurl-logs',
        username: process.env.ELASTICSEARCH_USERNAME,
        password: process.env.ELASTICSEARCH_PASSWORD,
        ssl: process.env.ELASTICSEARCH_SSL === 'true',
      },
      cloudwatch: {
        enabled: process.env.LOG_CLOUDWATCH_ENABLED === 'true',
        logGroupName: process.env.CLOUDWATCH_LOG_GROUP || '/aws/ec2/snapurl',
        logStreamName: process.env.CLOUDWATCH_LOG_STREAM || 'backend',
        region: process.env.AWS_REGION || 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    },
  },

  // Performance and optimization
  performance: {
    cache: {
      ttl: parseInt(process.env.CACHE_TTL, 10) || 300, // 5 minutes
      max: parseInt(process.env.CACHE_MAX, 10) || 1000,
      updateAgeOnGet: process.env.CACHE_UPDATE_AGE_ON_GET !== 'false',
      updateAgeOnHas: process.env.CACHE_UPDATE_AGE_ON_HAS !== 'false',
    },
    clustering: {
      enabled: process.env.CLUSTERING_ENABLED === 'true',
      workers: parseInt(process.env.CLUSTERING_WORKERS, 10) || 0, // 0 = auto (CPU cores)
    },
    gracefulShutdown: {
      timeout: parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT, 10) || 30000,
      signals: process.env.GRACEFUL_SHUTDOWN_SIGNALS?.split(',') || ['SIGTERM', 'SIGINT'],
    },
  },

  // Feature flags
  features: {
    analytics: process.env.FEATURE_ANALYTICS !== 'false',
    geoTargeting: process.env.FEATURE_GEO_TARGETING === 'true',
    passwordProtection: process.env.FEATURE_PASSWORD_PROTECTION === 'true',
    customDomains: process.env.FEATURE_CUSTOM_DOMAINS === 'true',
    bioPages: process.env.FEATURE_BIO_PAGES === 'true',
    bulkOperations: process.env.FEATURE_BULK_OPERATIONS === 'true',
    apiRateLimiting: process.env.FEATURE_API_RATE_LIMITING !== 'false',
    realTimeAnalytics: process.env.FEATURE_REAL_TIME_ANALYTICS === 'true',
    advancedMetrics: process.env.FEATURE_ADVANCED_METRICS === 'true',
  },

  // Health check configuration
  health: {
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT, 10) || 5000,
    retries: parseInt(process.env.HEALTH_CHECK_RETRIES, 10) || 3,
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL, 10) || 30000,
    endpoints: {
      liveness: process.env.HEALTH_LIVENESS_ENDPOINT || '/health/live',
      readiness: process.env.HEALTH_READINESS_ENDPOINT || '/health/ready',
      metrics: process.env.HEALTH_METRICS_ENDPOINT || '/health/metrics',
    },
  },
}));