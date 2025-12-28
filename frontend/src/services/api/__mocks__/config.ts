/**
 * Mock configuration for testing
 */

export const defaultAPIConfig = {
  baseURL: 'http://localhost:3000/api',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
};

export const validateAPIConfiguration = jest.fn();

export const getEnvironmentConfig = jest.fn(() => ({
  apiBaseURL: 'http://localhost:3000/api',
  isDevelopment: true,
  isProduction: false,
}));