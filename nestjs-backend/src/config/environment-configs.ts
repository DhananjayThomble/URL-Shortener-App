/**
 * Environment-specific configuration factories
 */

/**
 * Development environment configuration
 */
export const developmentConfig = () => ({
  // Application
  nodeEnv: 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  appVersion: process.env.APP_VERSION || '1.0.0',
  
  // URLs
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  
  // Database
  database: {
    postgres: {
      url: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/url_shortener',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
      username: process.env.DATABASE_USERNAME || 'username',
      password: process.env.DATABASE_PASSWORD || 'password',
      database: process.env.DATABASE_NAME || 'url_shortener',
      synchronize: true, // Only for development
      logging: true,
      ssl: false,
    },
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/url_shortener',
      host: process.env.MONGODB_HOST || 'localhost',
      port: parseInt(process.env.MONGODB_PORT, 10) || 27017,
      database: process.env.MONGODB_DATABASE || 'url_shortener',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'urlshortener:dev:',
    },
  },
  
  // Security
  security: {
    jwt: {
      secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    bcrypt: {
      saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 10, // Lower for dev
    },
    cors: {
      origin: process.env.CORS_ORIGIN || true, // Allow all origins in dev
      credentials: process.env.CORS_CREDENTIALS !== 'false',
    },
  },
  
  // Features
  features: {
    swagger: true, // Enable in development
    metrics: true,
    healthChecks: true,
    distributedTracing: false,
    compression: false, // Disable for easier debugging
    helmet: false, // Disable for easier debugging
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'debug',
    enableConsole: true,
    enableFile: false,
  },
  
  // Cache
  cache: {
    ttl: {
      url: 300, // Shorter TTL for development
      session: 300,
      analytics: 60,
    },
    enableCompression: false,
    enableWarming: false,
  },
  
  // Rate limiting (more lenient for development)
  rateLimit: {
    global: {
      ttl: 60000,
      max: 1000,
    },
    auth: {
      ttl: 900000,
      max: 10,
    },
  },
});

/**
 * Staging environment configuration
 */
export const stagingConfig = () => ({
  // Application
  nodeEnv: 'staging',
  port: parseInt(process.env.PORT, 10) || 3000,
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  appVersion: process.env.APP_VERSION || '1.0.0',
  
  // URLs
  baseUrl: process.env.BASE_URL,
  frontendUrl: process.env.FRONTEND_URL,
  backendUrl: process.env.BACKEND_URL,
  
  // Database
  database: {
    postgres: {
      url: process.env.DATABASE_URL,
      host: process.env.DATABASE_HOST,
      port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
      username: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      synchronize: false, // Never sync in staging/production
      logging: false,
      ssl: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    },
    mongodb: {
      uri: process.env.MONGODB_URI,
      host: process.env.MONGODB_HOST,
      port: parseInt(process.env.MONGODB_PORT, 10) || 27017,
      database: process.env.MONGODB_DATABASE,
    },
    redis: {
      url: process.env.REDIS_URL,
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB, 10) || 0,
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'urlshortener:staging:',
    },
  },
  
  // Security
  security: {
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    bcrypt: {
      saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
    },
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',') || false,
      credentials: process.env.CORS_CREDENTIALS !== 'false',
    },
  },
  
  // Features
  features: {
    swagger: process.env.ENABLE_SWAGGER === 'true',
    metrics: process.env.ENABLE_METRICS !== 'false',
    healthChecks: process.env.ENABLE_HEALTH_CHECKS !== 'false',
    distributedTracing: process.env.ENABLE_DISTRIBUTED_TRACING === 'true',
    compression: process.env.ENABLE_COMPRESSION !== 'false',
    helmet: process.env.ENABLE_HELMET !== 'false',
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: true,
    enableFile: true,
    enableCloudWatch: process.env.CLOUDWATCH_LOG_GROUP ? true : false,
  },
  
  // Cache
  cache: {
    ttl: {
      url: parseInt(process.env.CACHE_TTL_URL, 10) || 3600,
      session: parseInt(process.env.CACHE_TTL_SESSION, 10) || 900,
      analytics: parseInt(process.env.CACHE_TTL_ANALYTICS, 10) || 300,
    },
    enableCompression: process.env.CACHE_ENABLE_COMPRESSION !== 'false',
    enableWarming: process.env.CACHE_ENABLE_WARMING !== 'false',
  },
  
  // Rate limiting
  rateLimit: {
    global: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL, 10) || 60000,
      max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    },
    auth: {
      ttl: parseInt(process.env.RATE_LIMIT_AUTH_TTL, 10) || 900000,
      max: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 5,
    },
  },
});

/**
 * Production environment configuration
 */
export const productionConfig = () => {
  // Import the comprehensive production configuration
  const prodConfig = require('./production.config').default();
  
  // Return the production configuration with backward compatibility
  return {
    // Application
    nodeEnv: 'production',
    port: prodConfig.app.port,
    apiPrefix: prodConfig.app.globalPrefix + '/' + prodConfig.app.apiVersion,
    appVersion: process.env.APP_VERSION || '1.0.0',
    
    // URLs
    baseUrl: prodConfig.app.baseUrl,
    frontendUrl: prodConfig.app.frontendUrl,
    backendUrl: prodConfig.app.apiBaseUrl,
    
    // Database (map to existing structure for compatibility)
    database: {
      postgres: {
        url: process.env.DATABASE_URL,
        host: prodConfig.database.postgresql.host,
        port: prodConfig.database.postgresql.port,
        username: prodConfig.database.postgresql.username,
        password: prodConfig.database.postgresql.password,
        database: prodConfig.database.postgresql.database,
        synchronize: prodConfig.database.postgresql.synchronize,
        logging: prodConfig.database.postgresql.logging,
        ssl: prodConfig.database.postgresql.ssl,
        pool: {
          min: 5,
          max: prodConfig.database.postgresql.maxConnections,
          idleTimeoutMillis: 30000,
          acquireTimeoutMillis: prodConfig.database.postgresql.acquireTimeout,
        },
      },
      mongodb: {
        uri: prodConfig.database.mongodb.uri,
        host: prodConfig.database.mongodb.uri.includes('localhost') ? 'localhost' : 'managed',
        port: 27017,
        database: prodConfig.database.mongodb.uri.split('/').pop()?.split('?')[0] || 'snapurl_prod',
        ssl: prodConfig.database.mongodb.options.ssl,
        replicaSet: process.env.MONGO_REPLICA_SET,
        readPreference: prodConfig.database.mongodb.options.readPreference,
      },
      redis: {
        url: process.env.REDIS_URL,
        host: prodConfig.database.redis.host,
        port: prodConfig.database.redis.port,
        password: prodConfig.database.redis.password,
        db: prodConfig.database.redis.db,
        keyPrefix: prodConfig.database.redis.keyPrefix,
        cluster: prodConfig.database.redis.cluster !== null,
        retryDelayOnFailover: prodConfig.database.redis.retryDelayOnFailover,
        maxRetriesPerRequest: prodConfig.database.redis.maxRetriesPerRequest,
      },
    },
    
    // Security
    security: {
      jwt: {
        secret: prodConfig.security.jwt.secret,
        expiresIn: prodConfig.security.jwt.accessTokenExpiration,
        refreshSecret: process.env.JWT_REFRESH_SECRET || prodConfig.security.jwt.secret + '_refresh',
        refreshExpiresIn: prodConfig.security.jwt.refreshTokenExpiration,
      },
      bcrypt: {
        saltRounds: prodConfig.security.bcrypt.rounds,
      },
      cors: {
        origin: prodConfig.security.cors.origin,
        credentials: prodConfig.security.cors.credentials,
      },
      headers: {
        hstsMaxAge: prodConfig.security.helmet.hsts.maxAge,
        cspPolicy: JSON.stringify(prodConfig.security.helmet.contentSecurityPolicy.directives),
      },
    },
    
    // Features
    features: {
      swagger: false, // Disable in production by default
      metrics: prodConfig.services.monitoring.prometheus.enabled,
      healthChecks: true,
      distributedTracing: prodConfig.services.monitoring.sentry.enabled,
      compression: prodConfig.app.compression.enabled,
      helmet: true,
    },
    
    // Logging
    logging: {
      level: prodConfig.logging.level,
      enableConsole: prodConfig.logging.transports.console.enabled,
      enableFile: prodConfig.logging.transports.file.enabled,
      enableCloudWatch: prodConfig.logging.transports.cloudwatch.enabled,
    },
    
    // Cache
    cache: {
      ttl: {
        url: prodConfig.performance.cache.ttl,
        session: prodConfig.performance.cache.ttl,
        analytics: prodConfig.performance.cache.ttl,
      },
      enableCompression: true,
      enableWarming: true,
      autoOptimize: true,
    },
    
    // Rate limiting
    rateLimit: {
      global: {
        ttl: prodConfig.security.rateLimit.windowMs,
        max: prodConfig.security.rateLimit.max,
      },
      auth: {
        ttl: 900000, // 15 minutes
        max: 5,
      },
      urlCreation: {
        ttl: 60000, // 1 minute
        max: 10,
      },
    },
    
    // Performance
    performance: {
      requestTimeout: 30000,
      maxRequestSize: prodConfig.app.maxRequestSize,
      shutdownTimeout: prodConfig.performance.gracefulShutdown.timeout,
      keepAliveTimeout: 5000,
    },
    
    // Monitoring
    monitoring: {
      prometheusPort: 9090,
      healthCheckTimeout: prodConfig.health.timeout,
      enablePrometheusTracing: prodConfig.services.monitoring.prometheus.enabled,
    },
    
    // Additional production-specific configurations
    production: prodConfig, // Include the full production config for advanced features
  };
};

/**
 * Test environment configuration
 */
export const testConfig = () => ({
  // Application
  nodeEnv: 'test',
  port: parseInt(process.env.PORT, 10) || 3001, // Different port for tests
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  appVersion: process.env.APP_VERSION || '1.0.0-test',
  
  // URLs
  baseUrl: process.env.BASE_URL || 'http://localhost:3001',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3002',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3001',
  
  // Database (use test databases)
  database: {
    postgres: {
      url: process.env.DATABASE_URL || 'postgresql://username:password@localhost:5432/url_shortener_test',
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT, 10) || 5432,
      username: process.env.DATABASE_USERNAME || 'username',
      password: process.env.DATABASE_PASSWORD || 'password',
      database: process.env.DATABASE_NAME || 'url_shortener_test',
      synchronize: true, // Allow sync for tests
      logging: false, // Disable logging for tests
      dropSchema: true, // Drop schema before each test run
    },
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/url_shortener_test',
      host: process.env.MONGODB_HOST || 'localhost',
      port: parseInt(process.env.MONGODB_PORT, 10) || 27017,
      database: process.env.MONGODB_DATABASE || 'url_shortener_test',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT, 10) || 6379,
      password: process.env.REDIS_PASSWORD || '',
      db: parseInt(process.env.REDIS_DB, 10) || 15, // Use different DB for tests
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'urlshortener:test:',
    },
  },
  
  // Security (relaxed for tests)
  security: {
    jwt: {
      secret: process.env.JWT_SECRET || 'test-jwt-secret',
      expiresIn: process.env.JWT_EXPIRES_IN || '1h', // Longer for tests
      refreshSecret: process.env.JWT_REFRESH_SECRET || 'test-refresh-secret',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '1d',
    },
    bcrypt: {
      saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 4, // Lower for faster tests
    },
    cors: {
      origin: true, // Allow all origins in tests
      credentials: true,
    },
  },
  
  // Features (minimal for tests)
  features: {
    swagger: false,
    metrics: false,
    healthChecks: false,
    distributedTracing: false,
    compression: false,
    helmet: false,
  },
  
  // Logging (minimal for tests)
  logging: {
    level: process.env.LOG_LEVEL || 'error', // Only errors in tests
    enableConsole: false,
    enableFile: false,
  },
  
  // Cache (disabled for tests)
  cache: {
    ttl: {
      url: 0, // No caching in tests
      session: 0,
      analytics: 0,
    },
    enableCompression: false,
    enableWarming: false,
  },
  
  // Rate limiting (disabled for tests)
  rateLimit: {
    global: {
      ttl: 60000,
      max: 10000, // Very high limit for tests
    },
    auth: {
      ttl: 60000,
      max: 1000,
    },
  },
});