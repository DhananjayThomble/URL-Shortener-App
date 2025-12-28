/**
 * Integration test setup
 * This file is executed before each integration test file
 */

import { GenericContainer, StartedTestContainer } from 'testcontainers';

// Global test containers
let postgresContainer: StartedTestContainer;
let mongoContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;

// Setup test containers before all integration tests
beforeAll(async () => {
  console.log('🐳 Starting test containers for integration tests...');
  
  // Start PostgreSQL container
  postgresContainer = await new GenericContainer('postgres:15-alpine')
    .withEnvironment({
      POSTGRES_DB: 'test_db',
      POSTGRES_USER: 'test_user',
      POSTGRES_PASSWORD: 'test_password',
    })
    .withExposedPorts(5432)
    .start();
  
  // Start MongoDB container
  mongoContainer = await new GenericContainer('mongo:7-jammy')
    .withExposedPorts(27017)
    .start();
  
  // Start Redis container
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();
  
  // Update environment variables with container connection details
  process.env.POSTGRES_HOST = postgresContainer.getHost();
  process.env.POSTGRES_PORT = postgresContainer.getMappedPort(5432).toString();
  process.env.POSTGRES_USER = 'test_user';
  process.env.POSTGRES_PASSWORD = 'test_password';
  process.env.POSTGRES_DB = 'test_db';
  
  process.env.MONGODB_URI = `mongodb://${mongoContainer.getHost()}:${mongoContainer.getMappedPort(27017)}/test_db`;
  
  process.env.REDIS_HOST = redisContainer.getHost();
  process.env.REDIS_PORT = redisContainer.getMappedPort(6379).toString();
  
  console.log('✅ Test containers started successfully');
}, 60000); // 60 second timeout for container startup

// Cleanup test containers after all integration tests
afterAll(async () => {
  console.log('🧹 Stopping test containers...');
  
  if (postgresContainer) {
    await postgresContainer.stop();
  }
  
  if (mongoContainer) {
    await mongoContainer.stop();
  }
  
  if (redisContainer) {
    await redisContainer.stop();
  }
  
  console.log('✅ Test containers stopped successfully');
}, 30000); // 30 second timeout for container cleanup