/**
 * Property-based test setup
 * This file is executed before each property-based test file
 */

import * as fc from 'fast-check';

// Configure fast-check for property-based tests
beforeAll(() => {
  console.log('🎲 Setting up property-based testing with fast-check...');
  
  // Global configuration for fast-check
  fc.configureGlobal({
    numRuns: 100, // Number of test cases to generate
    verbose: process.env.NODE_ENV !== 'test', // Verbose output in development
    seed: process.env.PROPERTY_TEST_SEED ? parseInt(process.env.PROPERTY_TEST_SEED) : undefined,
    endOnFailure: true, // Stop on first failure
  });
  
  console.log('✅ Property-based testing configured');
});

// Common arbitraries for property-based tests
export const Arbitraries = {
  // User-related arbitraries
  email: () => fc.emailAddress(),
  password: () => fc.string({ minLength: 8, maxLength: 128 }).filter(s => 
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(s)
  ),
  username: () => fc.string({ minLength: 3, maxLength: 30 }).filter(s => 
    /^[a-zA-Z0-9_-]+$/.test(s)
  ),
  fullName: () => fc.string({ minLength: 1, maxLength: 100 }).filter(s => 
    s.trim().length > 0
  ),
  
  // URL-related arbitraries
  url: () => fc.webUrl(),
  shortCode: () => fc.string({ minLength: 6, maxLength: 10 }).filter(s => 
    /^[a-zA-Z0-9]+$/.test(s)
  ),
  customAlias: () => fc.string({ minLength: 3, maxLength: 50 }).filter(s => 
    /^[a-zA-Z0-9_-]+$/.test(s)
  ),
  
  // Tag-related arbitraries
  tagName: () => fc.string({ minLength: 1, maxLength: 50 }).filter(s => 
    s.trim().length > 0
  ),
  hexColor: () => fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`),
  
  // Bio page arbitraries
  bioPageUsername: () => fc.string({ minLength: 3, maxLength: 50 }).filter(s => 
    /^[a-zA-Z0-9_-]+$/.test(s)
  ),
  bioText: () => fc.string({ minLength: 0, maxLength: 500 }),
  theme: () => fc.constantFrom('default', 'modern', 'professional', 'creative'),
  buttonStyle: () => fc.constantFrom('rounded', 'square', 'pill'),
  
  // Analytics arbitraries
  ipAddress: () => fc.ipV4(),
  userAgent: () => fc.constantFrom(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
  ),
  country: () => fc.constantFrom('US', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'BR'),
  device: () => fc.constantFrom('Desktop', 'Mobile', 'Tablet'),
  browser: () => fc.constantFrom('Chrome', 'Firefox', 'Safari', 'Edge'),
  
  // Date arbitraries
  pastDate: () => fc.date({ max: new Date() }),
  futureDate: () => fc.date({ min: new Date() }),
  dateRange: () => fc.tuple(fc.date(), fc.date()).map(([d1, d2]) => 
    d1 <= d2 ? [d1, d2] : [d2, d1]
  ),
  
  // Utility arbitraries
  positiveInteger: () => fc.integer({ min: 1 }),
  nonEmptyString: () => fc.string({ minLength: 1 }).filter(s => s.trim().length > 0),
  uuid: () => fc.uuid(),
  
  // Complex object arbitraries
  user: () => fc.record({
    email: Arbitraries.email(),
    password: Arbitraries.password(),
    fullName: Arbitraries.fullName(),
    username: Arbitraries.username(),
    isEmailVerified: fc.boolean(),
  }),
  
  link: () => fc.record({
    originalUrl: Arbitraries.url(),
    shortCode: Arbitraries.shortCode(),
    customAlias: fc.option(Arbitraries.customAlias()),
    title: fc.option(Arbitraries.nonEmptyString()),
    isActive: fc.boolean(),
    expiresAt: fc.option(Arbitraries.futureDate()),
  }),
  
  tag: () => fc.record({
    name: Arbitraries.tagName(),
    color: Arbitraries.hexColor(),
  }),
  
  bioPage: () => fc.record({
    username: Arbitraries.bioPageUsername(),
    title: fc.option(Arbitraries.nonEmptyString()),
    bio: fc.option(Arbitraries.bioText()),
    theme: Arbitraries.theme(),
    backgroundColor: Arbitraries.hexColor(),
    textColor: Arbitraries.hexColor(),
    buttonStyle: Arbitraries.buttonStyle(),
    isPublic: fc.boolean(),
  }),
};

// Property test utilities
export const PropertyTestUtils = {
  // Helper to create property tests with consistent configuration
  property: <T>(arb: fc.Arbitrary<T>, predicate: (t: T) => boolean | void) => {
    return fc.property(arb, predicate);
  },
  
  // Helper to assert property tests
  assert: <T>(property: fc.IProperty<T>, params?: fc.Parameters<T>) => {
    return fc.assert(property, {
      numRuns: 100,
      verbose: false,
      ...params,
    });
  },
  
  // Helper to create async property tests
  asyncProperty: <T>(arb: fc.Arbitrary<T>, predicate: (t: T) => Promise<boolean>) => {
    return fc.asyncProperty(arb, predicate);
  },
  
  // Helper to assert async property tests
  assertAsync: <T>(property: fc.IAsyncProperty<T>, params?: fc.Parameters<T>) => {
    return fc.assert(property, {
      numRuns: 100,
      verbose: false,
      ...params,
    });
  },
};