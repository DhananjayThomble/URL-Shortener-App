const { Client } = require('pg');
const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
require('dotenv').config();

async function testDatabases() {
  console.log('🗄️  Testing Database Connections\n');

  // Test PostgreSQL
  console.log('1. Testing PostgreSQL:');
  try {
    const pgClient = new Client({
      connectionString: process.env.DATABASE_URL
    });
    
    await pgClient.connect();
    console.log('✅ PostgreSQL connection: PASS');
    
    // Check if tables exist
    const tablesResult = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    console.log('   Tables found:', tablesResult.rows.map(r => r.table_name).join(', '));
    
    // Check if users table exists and has the right structure
    if (tablesResult.rows.some(r => r.table_name === 'users')) {
      const userCount = await pgClient.query('SELECT COUNT(*) FROM users');
      console.log('   Users table exists with', userCount.rows[0].count, 'records');
    } else {
      console.log('❌ Users table does not exist');
    }
    
    await pgClient.end();
  } catch (error) {
    console.log('❌ PostgreSQL connection failed:', error.message);
  }

  // Test MongoDB
  console.log('\n2. Testing MongoDB:');
  try {
    const mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    console.log('✅ MongoDB connection: PASS');
    
    const db = mongoClient.db();
    const collections = await db.listCollections().toArray();
    console.log('   Collections found:', collections.map(c => c.name).join(', '));
    
    await mongoClient.close();
  } catch (error) {
    console.log('❌ MongoDB connection failed:', error.message);
  }

  // Test Redis
  console.log('\n3. Testing Redis:');
  try {
    const redis = new Redis(process.env.REDIS_URL);
    const pong = await redis.ping();
    console.log('✅ Redis connection:', pong === 'PONG' ? 'PASS' : 'FAIL');
    
    // Test basic operations
    await redis.set('test_key', 'test_value');
    const value = await redis.get('test_key');
    console.log('   Redis operations:', value === 'test_value' ? 'PASS' : 'FAIL');
    
    await redis.del('test_key');
    await redis.quit();
  } catch (error) {
    console.log('❌ Redis connection failed:', error.message);
  }

  console.log('\n🎯 Database Testing Complete!');
}

testDatabases().catch(console.error);