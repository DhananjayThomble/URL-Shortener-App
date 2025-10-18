import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';

// Load environment variables
config();

const configService = new ConfigService();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: configService.get('DATABASE_HOST', 'localhost'),
  port: configService.get('DATABASE_PORT', 5432),
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
  logging: configService.get('NODE_ENV') === 'development' ? ['query', 'error'] : ['error'],
  
  // SSL configuration for production
  ssl: configService.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
  
  // Connection pool configuration
  extra: {
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
  },
});

export default AppDataSource;