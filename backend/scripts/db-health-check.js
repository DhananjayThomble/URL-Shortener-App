#!/usr/bin/env node

/**
 * Database Health Check Script
 * Checks the health and connectivity of all databases
 */

const { DataSource } = require('typeorm');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
require('dotenv').config();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[SUCCESS]${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}[WARNING]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
};

// Database configurations
const postgresConfig = {
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  username: process.env.POSTGRES_USER || 'urlshortener',
  password: process.env.POSTGRES_PASSWORD || 'password123',
  database: process.env.POSTGRES_DB || 'urlshortener_dev',
  synchronize: false,
  logging: false,
};

const mongoConfig = {
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/urlshortener_dev',
};

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: 0,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
};

// Health check results
const healthResults = {
  postgres: { status: 'unknown', details: {} },
  mongodb: { status: 'unknown', details: {} },
  redis: { status: 'unknown', details: {} },
};

// PostgreSQL health check
async function checkPostgreSQL() {
  log.info('Checking PostgreSQL connection...');
  
  let dataSource;
  
  try {
    dataSource = new DataSource(postgresConfig);
    await dataSource.initialize();
    
    // Basic connectivity test
    const result = await dataSource.query('SELECT 1 as test');
    if (result[0].test !== 1) {
      throw new Error('Basic query failed');
    }
    
    // Check database version
    const versionResult = await dataSource.query('SELECT version()');
    const version = versionResult[0].version;
    
    // Check connection pool status
    const poolSize = dataSource.driver.master.totalCount;
    const idleConnections = dataSource.driver.master.idleCount;
    const activeConnections = poolSize - idleConnections;
    
    // Check if we can create a table (permissions test)
    try {
      await dataSource.query('CREATE TEMPORARY TABLE health_check_test (id INTEGER)');
      await dataSource.query('DROP TABLE health_check_test');
    } catch (error) {
      throw new Error(`Insufficient permissions: ${error.message}`);
    }
    
    healthResults.postgres = {
      status: 'healthy',
      details: {
        version: version.split(' ')[1],
        host: postgresConfig.host,
        port: postgresConfig.port,
        database: postgresConfig.database,
        poolSize,
        activeConnections,
        idleConnections,
      },
    };
    
    log.success('PostgreSQL is healthy');
    
  } catch (error) {
    healthResults.postgres = {
      status: 'unhealthy',
      details: {
        error: error.message,
        host: postgresConfig.host,
        port: postgresConfig.port,
        database: postgresConfig.database,
      },
    };
    
    log.error(`PostgreSQL health check failed: ${error.message}`);
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// MongoDB health check
async function checkMongoDB() {
  log.info('Checking MongoDB connection...');
  
  let client;
  
  try {
    client = new MongoClient(mongoConfig.uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    
    await client.connect();
    
    // Basic connectivity test
    const db = client.db();
    await db.admin().ping();
    
    // Get server status
    const serverStatus = await db.admin().serverStatus();
    
    // Get database stats
    const dbStats = await db.stats();
    
    // Test basic operations
    const testCollection = db.collection('health_check_test');
    await testCollection.insertOne({ test: true, timestamp: new Date() });
    const testDoc = await testCollection.findOne({ test: true });
    await testCollection.deleteOne({ _id: testDoc._id });
    
    healthResults.mongodb = {
      status: 'healthy',
      details: {
        version: serverStatus.version,
        host: serverStatus.host,
        uptime: serverStatus.uptime,
        connections: serverStatus.connections,
        database: db.databaseName,
        collections: dbStats.collections,
        dataSize: Math.round(dbStats.dataSize / 1024 / 1024 * 100) / 100, // MB
        storageSize: Math.round(dbStats.storageSize / 1024 / 1024 * 100) / 100, // MB
      },
    };
    
    log.success('MongoDB is healthy');
    
  } catch (error) {
    healthResults.mongodb = {
      status: 'unhealthy',
      details: {
        error: error.message,
        uri: mongoConfig.uri.replace(/\/\/.*@/, '//***@'), // Hide credentials
      },
    };
    
    log.error(`MongoDB health check failed: ${error.message}`);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Redis health check
async function checkRedis() {
  log.info('Checking Redis connection...');
  
  let redis;
  
  try {
    redis = new Redis(redisConfig);
    
    // Wait for connection
    await redis.connect();
    
    // Basic connectivity test
    const pong = await redis.ping();
    if (pong !== 'PONG') {
      throw new Error('Ping test failed');
    }
    
    // Get server info
    const info = await redis.info();
    const infoLines = info.split('\r\n');
    const serverInfo = {};
    
    infoLines.forEach(line => {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        serverInfo[key] = value;
      }
    });
    
    // Test basic operations
    const testKey = 'health_check_test';
    await redis.set(testKey, 'test_value', 'EX', 10);
    const testValue = await redis.get(testKey);
    if (testValue !== 'test_value') {
      throw new Error('Set/Get test failed');
    }
    await redis.del(testKey);
    
    // Get memory usage
    const memoryInfo = await redis.info('memory');
    const memoryLines = memoryInfo.split('\r\n');
    let usedMemory = 0;
    let maxMemory = 0;
    
    memoryLines.forEach(line => {
      if (line.startsWith('used_memory:')) {
        usedMemory = parseInt(line.split(':')[1]);
      }
      if (line.startsWith('maxmemory:')) {
        maxMemory = parseInt(line.split(':')[1]);
      }
    });
    
    healthResults.redis = {
      status: 'healthy',
      details: {
        version: serverInfo.redis_version,
        host: redisConfig.host,
        port: redisConfig.port,
        uptime: parseInt(serverInfo.uptime_in_seconds),
        connectedClients: parseInt(serverInfo.connected_clients),
        usedMemory: Math.round(usedMemory / 1024 / 1024 * 100) / 100, // MB
        maxMemory: maxMemory > 0 ? Math.round(maxMemory / 1024 / 1024 * 100) / 100 : 'unlimited', // MB
        keyspaceHits: parseInt(serverInfo.keyspace_hits || 0),
        keyspaceMisses: parseInt(serverInfo.keyspace_misses || 0),
      },
    };
    
    log.success('Redis is healthy');
    
  } catch (error) {
    healthResults.redis = {
      status: 'unhealthy',
      details: {
        error: error.message,
        host: redisConfig.host,
        port: redisConfig.port,
      },
    };
    
    log.error(`Redis health check failed: ${error.message}`);
  } finally {
    if (redis) {
      redis.disconnect();
    }
  }
}

// Generate health report
function generateHealthReport() {
  console.log('\n' + '='.repeat(60));
  console.log('  DATABASE HEALTH REPORT');
  console.log('='.repeat(60));
  
  const databases = ['postgres', 'mongodb', 'redis'];
  let overallHealthy = true;
  
  databases.forEach(db => {
    const result = healthResults[db];
    const status = result.status === 'healthy' ? 
      `${colors.green}✓ HEALTHY${colors.reset}` : 
      `${colors.red}✗ UNHEALTHY${colors.reset}`;
    
    console.log(`\n${db.toUpperCase()}: ${status}`);
    
    if (result.status === 'healthy') {
      Object.entries(result.details).forEach(([key, value]) => {
        if (key !== 'error') {
          console.log(`  ${key}: ${value}`);
        }
      });
    } else {
      console.log(`  Error: ${result.details.error}`);
      overallHealthy = false;
    }
  });
  
  console.log('\n' + '='.repeat(60));
  
  if (overallHealthy) {
    log.success('All databases are healthy');
    return 0;
  } else {
    log.error('One or more databases are unhealthy');
    return 1;
  }
}

// Main health check function
async function main() {
  const startTime = Date.now();
  
  console.log('🏥 Starting database health checks...');
  console.log('');
  
  try {
    // Run all health checks in parallel
    await Promise.all([
      checkPostgreSQL(),
      checkMongoDB(),
      checkRedis(),
    ]);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nHealth checks completed in ${duration}s`);
    
    const exitCode = generateHealthReport();
    process.exit(exitCode);
    
  } catch (error) {
    log.error(`Health check failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

// Handle script interruption
process.on('SIGINT', () => {
  log.warning('Health check interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  log.warning('Health check terminated');
  process.exit(1);
});

// Run the health check
if (require.main === module) {
  main();
}

module.exports = { main, healthResults };