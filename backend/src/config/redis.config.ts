import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
  keyPrefix: string;
  retryDelayOnFailover: number;
  maxRetriesPerRequest: number;
  lazyConnect: boolean;
  enableReadyCheck: boolean;
  enableOfflineQueue: boolean;
  connectTimeout: number;
  commandTimeout: number;
  family: number;
  keepAlive: number;
  // Clustering support
  cluster?: {
    enabled: boolean;
    nodes: Array<{ host: string; port: number }>;
    options: ClusterOptions;
  };
  // Connection pool settings
  pool: {
    min: number;
    max: number;
  };
}

@Injectable()
export class RedisConfigService {
  private readonly logger = new Logger(RedisConfigService.name);

  constructor(private readonly configService: ConfigService) {}

  getRedisConfig(): RedisConfig {
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const clusterEnabled = this.configService.get('REDIS_CLUSTER_ENABLED', 'false') === 'true';

    const config: RedisConfig = {
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: parseInt(this.configService.get('REDIS_PORT', '6379'), 10),
      password: this.configService.get('REDIS_PASSWORD'),
      db: parseInt(this.configService.get('REDIS_DB', '0'), 10),
      keyPrefix: this.configService.get('REDIS_KEY_PREFIX', 'urlshortener:'),
      retryDelayOnFailover: parseInt(this.configService.get('REDIS_RETRY_DELAY', '100'), 10),
      maxRetriesPerRequest: parseInt(this.configService.get('REDIS_MAX_RETRIES', '3'), 10),
      lazyConnect: this.configService.get('REDIS_LAZY_CONNECT', 'true') === 'true',
      enableReadyCheck: this.configService.get('REDIS_READY_CHECK', 'false') === 'true',
      enableOfflineQueue: this.configService.get('REDIS_OFFLINE_QUEUE', 'true') === 'true',
      connectTimeout: parseInt(this.configService.get('REDIS_CONNECT_TIMEOUT', '10000'), 10),
      commandTimeout: parseInt(this.configService.get('REDIS_COMMAND_TIMEOUT', '5000'), 10),
      family: parseInt(this.configService.get('REDIS_FAMILY', '4'), 10),
      keepAlive: parseInt(this.configService.get('REDIS_KEEP_ALIVE', '30000'), 10),
      pool: {
        min: parseInt(this.configService.get('REDIS_POOL_MIN', '5'), 10),
        max: parseInt(this.configService.get('REDIS_POOL_MAX', '20'), 10),
      },
    };

    // Cluster configuration
    if (clusterEnabled) {
      const clusterNodes = this.parseClusterNodes();
      config.cluster = {
        enabled: true,
        nodes: clusterNodes,
        options: {
          enableReadyCheck: false,
          redisOptions: {
            password: config.password,
            connectTimeout: config.connectTimeout,
            commandTimeout: config.commandTimeout,
            lazyConnect: config.lazyConnect,
            maxRetriesPerRequest: config.maxRetriesPerRequest,
          },
          retryDelayOnFailover: parseInt(this.configService.get('REDIS_CLUSTER_RETRY_DELAY', '100'), 10),
          retryDelayOnClusterDown: parseInt(this.configService.get('REDIS_CLUSTER_DOWN_RETRY_DELAY', '300'), 10),
          maxRedirections: parseInt(this.configService.get('REDIS_CLUSTER_MAX_REDIRECTIONS', '16'), 10),
          scaleReads: this.configService.get('REDIS_CLUSTER_SCALE_READS', 'slave') as 'master' | 'slave' | 'all',
        },
      };
    }

    return config;
  }

  private parseClusterNodes(): Array<{ host: string; port: number }> {
    const nodesString = this.configService.get('REDIS_CLUSTER_NODES', '');
    if (!nodesString) {
      return [];
    }

    try {
      return nodesString.split(',').map(node => {
        const [host, port] = node.trim().split(':');
        return { host, port: parseInt(port, 10) };
      });
    } catch (error) {
      this.logger.error('Failed to parse Redis cluster nodes', error);
      return [];
    }
  }

  createRedisInstance(): Redis | Cluster {
    const config = this.getRedisConfig();

    if (config.cluster?.enabled && config.cluster.nodes.length > 0) {
      this.logger.log('Creating Redis cluster instance');
      return new Cluster(config.cluster.nodes, config.cluster.options);
    }

    this.logger.log('Creating Redis standalone instance');
    const redisOptions: RedisOptions = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db,
      keyPrefix: config.keyPrefix,
      maxRetriesPerRequest: config.maxRetriesPerRequest,
      lazyConnect: config.lazyConnect,
      enableReadyCheck: config.enableReadyCheck,
      enableOfflineQueue: config.enableOfflineQueue,
      connectTimeout: config.connectTimeout,
      commandTimeout: config.commandTimeout,
      family: config.family,
      keepAlive: config.keepAlive,
    };

    return new Redis(redisOptions);
  }

  async healthCheck(redis: Redis | Cluster): Promise<boolean> {
    try {
      const result = await redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return false;
    }
  }

  setupConnectionEventHandlers(redis: Redis | Cluster): void {
    redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    redis.on('ready', () => {
      this.logger.log('Redis ready to receive commands');
    });

    redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    redis.on('reconnecting', (time) => {
      this.logger.log(`Redis reconnecting in ${time}ms`);
    });

    redis.on('end', () => {
      this.logger.warn('Redis connection ended');
    });

    // Cluster-specific events
    if (redis instanceof Cluster) {
      redis.on('node error', (error, node) => {
        this.logger.error(`Redis cluster node error on ${node.options.host}:${node.options.port}:`, error);
      });

      redis.on('+node', (node) => {
        this.logger.log(`Redis cluster node added: ${node.options.host}:${node.options.port}`);
      });

      redis.on('-node', (node) => {
        this.logger.log(`Redis cluster node removed: ${node.options.host}:${node.options.port}`);
      });
    }
  }
}

// Cache TTL configuration
export interface CacheTTLConfig {
  urlResolution: number;
  userSession: number;
  analytics: number;
  metadata: number;
  popularUrls: number;
  default: number;
  jwtBlacklist: number;
  rateLimiting: number;
  geoLocation: number;
}

export const getCacheTTLConfig = (configService: ConfigService): CacheTTLConfig => ({
  urlResolution: parseInt(configService.get('CACHE_TTL_URL', '3600'), 10), // 1 hour
  userSession: parseInt(configService.get('CACHE_TTL_SESSION', '900'), 10), // 15 minutes
  analytics: parseInt(configService.get('CACHE_TTL_ANALYTICS', '300'), 10), // 5 minutes
  metadata: parseInt(configService.get('CACHE_TTL_METADATA', '86400'), 10), // 24 hours
  popularUrls: parseInt(configService.get('CACHE_TTL_POPULAR', '1800'), 10), // 30 minutes
  default: parseInt(configService.get('CACHE_TTL_DEFAULT', '3600'), 10), // 1 hour
  jwtBlacklist: parseInt(configService.get('CACHE_TTL_JWT_BLACKLIST', '86400'), 10), // 24 hours
  rateLimiting: parseInt(configService.get('CACHE_TTL_RATE_LIMIT', '3600'), 10), // 1 hour
  geoLocation: parseInt(configService.get('CACHE_TTL_GEO_LOCATION', '86400'), 10), // 24 hours
});

// Cache key patterns
export const CACHE_KEYS = {
  URL_RESOLUTION: 'url:resolution:',
  USER_SESSION: 'user:session:',
  ANALYTICS: 'analytics:',
  METADATA: 'metadata:',
  POPULAR_URLS: 'popular:urls',
  JWT_BLACKLIST: 'jwt:blacklist:',
  RATE_LIMIT: 'rate:limit:',
  GEO_LOCATION: 'geo:location:',
  HEALTH_CHECK: 'health:check',
} as const;