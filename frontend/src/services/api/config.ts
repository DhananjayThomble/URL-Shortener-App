/**
 * API configuration and environment variable handling
 */

import { APIClientConfig } from './types';

// Environment variable validation
const validateEnvironment = (): void => {
  const requiredVars = ['VITE_NESTJS_API_URL'];
  const missingVars = requiredVars.filter(varName => !import.meta.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}. ` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
};

// Get API base URL from environment
const getAPIBaseURL = (): string => {
  const baseURL = import.meta.env.VITE_NESTJS_API_URL;
  
  if (!baseURL) {
    throw new Error(
      'VITE_NESTJS_API_URL environment variable is not set. ' +
      'Please add it to your .env file.'
    );
  }
  
  // Ensure URL doesn't end with slash
  return baseURL.replace(/\/$/, '');
};

// Default API client configuration
export const defaultAPIConfig: APIClientConfig = {
  baseURL: getAPIBaseURL(),
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
};

// Validate environment on module load
export const validateAPIConfiguration = (): void => {
  try {
    validateEnvironment();
    getAPIBaseURL();
  } catch (error) {
    console.error('API Configuration Error:', error);
    throw error;
  }
};

// Export environment getters
export const getEnvironmentConfig = () => ({
  apiBaseURL: getAPIBaseURL(),
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
});