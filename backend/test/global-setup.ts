/**
 * Global setup for all tests
 * This runs once before all test suites
 */

import { config } from 'dotenv';

export default async function globalSetup() {
  // Load test environment variables
  config({ path: '.env.test' });
  
  // Set test environment
  process.env.NODE_ENV = 'test';
  
  console.log('🧪 Global test setup completed');
  console.log(`📊 Test environment: ${process.env.NODE_ENV}`);
  console.log(`🗄️  Test database: ${process.env.POSTGRES_DB}`);
}