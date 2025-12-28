/**
 * End-to-end test setup
 * This file is executed before each e2e test file
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';

// Global application instance for e2e tests
let app: INestApplication;

// Setup application before all e2e tests
beforeAll(async () => {
  console.log('🚀 Setting up NestJS application for e2e tests...');
  
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleFixture.createNestApplication();
  
  // Apply the same configuration as in main.ts
  app.setGlobalPrefix('api');
  
  await app.init();
  
  console.log('✅ NestJS application ready for e2e tests');
}, 30000);

// Cleanup application after all e2e tests
afterAll(async () => {
  console.log('🧹 Closing NestJS application...');
  
  if (app) {
    await app.close();
  }
  
  console.log('✅ NestJS application closed successfully');
});

// Export app instance for use in e2e tests
export { app };