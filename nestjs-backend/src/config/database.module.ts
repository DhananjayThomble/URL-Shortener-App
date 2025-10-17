import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    // PostgreSQL configuration
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get('DATABASE_URL'),
        host: configService.get('DATABASE_HOST', 'localhost'),
        port: configService.get('DATABASE_PORT', 5432),
        username: configService.get('DATABASE_USERNAME', 'postgres'),
        password: configService.get('DATABASE_PASSWORD', 'password'),
        database: configService.get('DATABASE_NAME', 'url_shortener'),
        entities: [__dirname + '/../**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/../migrations/*{.ts,.js}'],
        migrationsRun: false, // Set to true for auto-run in development
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
        ssl: configService.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
        extra: {
          // Connection pool configuration
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
      }),
      inject: [ConfigService],
    }),

    // MongoDB configuration
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get('MONGODB_URI', 'mongodb://localhost:27017/url_shortener'),
        useNewUrlParser: true,
        useUnifiedTopology: true,
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
        bufferMaxEntries: 0,
        compressors: ['zlib'],
        zlibCompressionLevel: 6,
        // Read preferences for better performance
        readPreference: 'secondaryPreferred',
        readConcern: { level: 'local' },
        writeConcern: { w: 'majority', j: true, wtimeout: 10000 },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}