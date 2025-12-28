import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';

// Load environment variables
config();

const configService = new ConfigService();
const isProduction = configService.get('NODE_ENV') === 'production';

const AppDataSource = new DataSource({
  type: 'postgres',
  host: configService.get('DATABASE_HOST', 'localhost'),
  port: parseInt(configService.get('DATABASE_PORT', '5432'), 10),
  username: configService.get('DATABASE_USERNAME', 'postgres'),
  password: configService.get('DATABASE_PASSWORD', 'password'),
  database: configService.get('DATABASE_NAME', 'url_shortener'),
  
  // Entity and migration paths
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  
  // Migration settings
  migrationsRun: false,
  migrationsTableName: 'migrations',
  
  // Development settings
  synchronize: false, // Always false for migrations
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
});

export default AppDataSource;