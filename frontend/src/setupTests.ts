import '@testing-library/jest-dom';

// Mock import.meta.env for Jest
Object.defineProperty(globalThis, 'import', {
  value: {
    meta: {
      env: {
        VITE_NESTJS_API_URL: 'http://localhost:3000/api/v1',
        DEV: true,
        PROD: false,
      },
    },
  },
});

// Mock the config module to avoid import.meta.env issues
jest.mock('./services/api/config', () => ({
  defaultAPIConfig: {
    baseURL: 'http://localhost:3000/api/v1',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 1000,
  },
  validateAPIConfiguration: jest.fn(),
  getEnvironmentConfig: jest.fn(() => ({
    apiBaseURL: 'http://localhost:3000/api/v1',
    isDevelopment: true,
    isProduction: false,
  })),
}));
