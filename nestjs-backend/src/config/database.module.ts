import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from '../modules/users/entities/user.entity';
import { RefreshToken } from '../modules/users/entities/refresh-token.entity';
import { CustomDomain } from '../modules/users/entities/custom-domain.entity';
import { AdminUser } from '../modules/users/entities/admin-user.entity';
import { AuditLog } from '../modules/users/entities/audit-log.entity';
import { Link } from '../modules/urls/entities/link.entity';
import { GeoRule } from '../modules/urls/entities/geo-rule.entity';
import { Tag } from '../modules/urls/entities/tag.entity';
import { LinkTag } from '../modules/urls/entities/link-tag.entity';
import { BioPage } from '../modules/bio-pages/entities/bio-page.entity';
import { BioLink } from '../modules/bio-pages/entities/bio-link.entity';
import { RedisModule } from './redis.module';
import { HealthCheckService } from './health-check.service';

@Module({
  imports: [
    // PostgreSQL configuration with optimized connection pooling
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get('NODE_ENV') === 'production';
        
        return {
          type: 'postgres',
          url: configService.get('DATABASE_URL'),
          host: configService.get('DATABASE_HOST', 'localhost'),
          port: parseInt(configService.get('DATABASE_PORT', '5432'), 10),
          username: configService.get('DATABASE_USERNAME', 'postgres'),
          password: configService.get('DATABASE_PASSWORD', 'password'),
          database: configService.get('DATABASE_NAME', 'url_shortener'),
          entities: [User, RefreshToken, CustomDomain, AdminUser, AuditLog, Link, GeoRule, Tag, LinkTag, BioPage, BioLink],
          migrations: [__dirname + '/../migrations/*{.ts,.js}'],
          migrationsRun: false,
          synchronize: !isProduction, // Only sync in development
          logging: isProduction ? ['error', 'warn'] : ['query', 'error', 'warn'],
          
          // Enhanced SSL configuration for production
          ssl: isProduction ? {
            rejectUnauthorized: configService.get('DB_SSL_REJECT_UNAUTHORIZED', 'false') === 'true',
            ca: configService.get('DB_SSL_CA'),
            cert: configService.get('DB_SSL_CERT'),
            key: configService.get('DB_SSL_KEY'),
          } : false,
          
          // Optimized connection pool configuration
          extra: {
            // Connection pool settings
            max: parseInt(configService.get('DB_POOL_MAX', '20'), 10),
            min: parseInt(configService.get('DB_POOL_MIN', '5'), 10),
            acquire: parseInt(configService.get('DB_POOL_ACQUIRE', '60000'), 10),
            idle: parseInt(configService.get('DB_POOL_IDLE', '10000'), 10),
            evict: parseInt(configService.get('DB_POOL_EVICT', '1000'), 10),
            handleDisconnects: true,
            
            // Query optimization
            statement_timeout: parseInt(configService.get('DB_STATEMENT_TIMEOUT', '30000'), 10),
            query_timeout: parseInt(configService.get('DB_QUERY_TIMEOUT', '30000'), 10),
            
            // Connection optimization
            application_name: 'nestjs-url-shortener',
            tcp_keepalives_idle: 600,
            tcp_keepalives_interval: 30,
            tcp_keepalives_count: 3,
            
            // Performance optimizations
            shared_preload_libraries: 'pg_stat_statements',
            log_statement: isProduction ? 'none' : 'all',
            log_min_duration_statement: isProduction ? 1000 : 0,
            
            // Connection retry configuration
            connectionTimeoutMillis: parseInt(configService.get('DB_CONNECTION_TIMEOUT', '2000'), 10),
            idleTimeoutMillis: parseInt(configService.get('DB_IDLE_TIMEOUT', '30000'), 10),
          },
          
          // Connection retry configuration
          retryAttempts: parseInt(configService.get('DB_RETRY_ATTEMPTS', '3'), 10),
          retryDelay: parseInt(configService.get('DB_RETRY_DELAY', '3000'), 10),
          
          // Connection health check
          keepConnectionAlive: true,
          autoLoadEntities: true,
        };
      },
      inject: [ConfigService],
    }),

    // MongoDB configuration with enhanced connection pooling and replica set support
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const isProduction = configService.get('NODE_ENV') === 'production';
        
        return {
          uri: configService.get('MONGODB_URI', 'mongodb://localhost:27017/url_shortener'),
          
          // Connection pool optimization
          maxPoolSize: parseInt(configService.get('MONGO_POOL_MAX', '20'), 10),
          minPoolSize: parseInt(configService.get('MONGO_POOL_MIN', '5'), 10),
          maxIdleTimeMS: parseInt(configService.get('MONGO_IDLE_TIME', '30000'), 10),
          waitQueueTimeoutMS: parseInt(configService.get('MONGO_WAIT_TIMEOUT', '10000'), 10),
          
          // Connection timeouts
          serverSelectionTimeoutMS: parseInt(configService.get('MONGO_SERVER_TIMEOUT', '5000'), 10),
          socketTimeoutMS: parseInt(configService.get('MONGO_SOCKET_TIMEOUT', '45000'), 10),
          connectTimeoutMS: parseInt(configService.get('MONGO_CONNECT_TIMEOUT', '10000'), 10),
          
          // Performance optimization
          bufferCommands: false,
          compressors: ['zlib'],
          zlibCompressionLevel: 6,
          
          // Read preferences for better performance and replica set support
          readPreference: configService.get('MONGO_READ_PREFERENCE', 'secondaryPreferred'),
          readConcern: { level: configService.get('MONGO_READ_CONCERN', 'local') as any },
          writeConcern: { 
            w: configService.get('MONGO_WRITE_CONCERN_W', 'majority'),
            j: configService.get('MONGO_WRITE_CONCERN_J', 'true') === 'true',
            wtimeout: parseInt(configService.get('MONGO_WRITE_CONCERN_TIMEOUT', '10000'), 10)
          },
          
          // Replica set configuration
          replicaSet: configService.get('MONGO_REPLICA_SET'),
          
          // Authentication - disable for development
          authSource: isProduction ? configService.get('MONGO_AUTH_SOURCE', 'admin') : undefined,
          authMechanism: isProduction ? configService.get('MONGO_AUTH_MECHANISM', 'SCRAM-SHA-256') : undefined,
          
          // SSL/TLS configuration for production
          ssl: isProduction ? configService.get('MONGO_SSL', 'false') === 'true' : false,
          // sslValidate is deprecated, use tlsAllowInvalidCertificates instead
          tlsAllowInvalidCertificates: isProduction ? configService.get('MONGO_SSL_VALIDATE', 'true') !== 'true' : true,
          sslCA: configService.get('MONGO_SSL_CA'),
          sslCert: configService.get('MONGO_SSL_CERT'),
          sslKey: configService.get('MONGO_SSL_KEY'),
          
          // Connection monitoring
          heartbeatFrequencyMS: parseInt(configService.get('MONGO_HEARTBEAT_FREQUENCY', '10000'), 10),
          
          // Retry configuration
          retryWrites: configService.get('MONGO_RETRY_WRITES', 'true') === 'true',
          retryReads: configService.get('MONGO_RETRY_READS', 'true') === 'true',
          
          // Application name for monitoring
          appName: 'nestjs-url-shortener',
          
          // Connection events logging
          connectionFactory: (connection) => {
            connection.on('connected', () => {
              console.log('MongoDB connected successfully');
            });
            connection.on('error', (error) => {
              console.error('MongoDB connection error:', error);
            });
            connection.on('disconnected', () => {
              console.log('MongoDB disconnected');
            });
            return connection;
          },
        };
      },
      inject: [ConfigService],
    }),

    // Redis configuration
    RedisModule,
  ],
  providers: [HealthCheckService],
  exports: [RedisModule, HealthCheckService],
})
export class DatabaseModule {}