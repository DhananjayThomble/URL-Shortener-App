/**
 * Global test setup file
 * This file is executed before each test file
 */

import 'reflect-metadata';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Set test environment
process.env.NODE_ENV = 'test';

// Increase test timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidUUID(): R;
      toBeValidEmail(): R;
      toBeValidUrl(): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  toBeValidUUID(received: string) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = uuidRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid UUID`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid UUID`,
        pass: false,
      };
    }
  },
  
  toBeValidEmail(received: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = emailRegex.test(received);
    
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid email`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid email`,
        pass: false,
      };
    }
  },
  
  toBeValidUrl(received: string) {
    try {
      new URL(received);
      return {
        message: () => `expected ${received} not to be a valid URL`,
        pass: true,
      };
    } catch {
      return {
        message: () => `expected ${received} to be a valid URL`,
        pass: false,
      };
    }
  },
});

// Mock console methods in test environment to reduce noise
if (process.env.NODE_ENV === 'test') {
  const originalConsole = { ...console };
  
  beforeAll(() => {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = originalConsole.error; // Keep error for debugging
  });
  
  afterAll(() => {
    Object.assign(console, originalConsole);
  });
}

// Global test data factories
export const TestDataFactory = {
  createUser: (overrides = {}) => ({
    email: 'test@example.com',
    password: 'Test123!',
    fullName: 'Test User',
    username: 'testuser',
    isEmailVerified: true,
    ...overrides,
  }),
  
  createLink: (overrides = {}) => ({
    originalUrl: 'https://example.com',
    title: 'Test Link',
    shortCode: 'test123',
    isActive: true,
    ...overrides,
  }),
  
  createTag: (overrides = {}) => ({
    name: 'Test Tag',
    color: '#3b82f6',
    ...overrides,
  }),
  
  createBioPage: (overrides = {}) => ({
    username: 'testbio',
    title: 'Test Bio',
    bio: 'This is a test bio page',
    theme: 'default',
    backgroundColor: '#ffffff',
    textColor: '#000000',
    buttonStyle: 'rounded',
    isPublic: true,
    ...overrides,
  }),
};

// Test database utilities
export const TestDatabaseUtils = {
  async clearDatabase(dataSource: any) {
    const entities = dataSource.entityMetadatas;
    
    for (const entity of entities) {
      const repository = dataSource.getRepository(entity.name);
      await repository.clear();
    }
  },
  
  async seedTestData(dataSource: any) {
    // Add common test data seeding logic here
    // This can be used across different test suites
  },
};

// Property-based testing utilities
export const PropertyTestUtils = {
  // Common generators for property-based tests
  validEmail: () => `test${Math.random().toString(36).substring(7)}@example.com`,
  validUrl: () => `https://example${Math.random().toString(36).substring(7)}.com`,
  validPassword: () => `Test${Math.random().toString(36).substring(7)}!`,
  shortCode: (length = 8) => Math.random().toString(36).substring(2, 2 + length),
};