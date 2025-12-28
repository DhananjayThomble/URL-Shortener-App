/**
 * API startup validation and connectivity checks
 */

import { apiClient } from './client';
import { validateAPIConfiguration } from './config';

export interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates API configuration and connectivity on application startup
 */
export const validateAPIStartup = async (): Promise<StartupValidationResult> => {
  const result: StartupValidationResult = {
    success: true,
    errors: [],
    warnings: [],
  };

  try {
    // Step 1: Validate environment configuration
    validateAPIConfiguration();
  } catch (error) {
    result.success = false;
    result.errors.push(`Configuration Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return result; // Can't proceed without valid configuration
  }

  try {
    // Step 2: Test API connectivity
    const healthResponse = await apiClient.get('/health');
    
    if (!healthResponse.success) {
      result.warnings.push(
        'API health check failed. The backend may be unavailable. ' +
        'Some features may not work properly.'
      );
    }
  } catch (error) {
    result.warnings.push(
      'Unable to connect to the backend API. ' +
      'Please ensure the NestJS backend is running and accessible.'
    );
  }

  try {
    // Step 3: Load stored authentication tokens
    const tokens = apiClient.loadTokensFromStorage();
    if (tokens) {
      // Validate token format (basic check)
      if (!tokens.accessToken || !tokens.refreshToken) {
        result.warnings.push('Invalid authentication tokens found in storage. Please log in again.');
        apiClient.clearAuthTokens();
        localStorage.removeItem('auth_tokens');
      }
    }
  } catch (error) {
    result.warnings.push('Failed to load authentication tokens from storage.');
  }

  return result;
};

/**
 * Logs startup validation results to console
 */
export const logStartupValidation = (result: StartupValidationResult): void => {
  if (result.success) {
    console.log('✅ API startup validation completed successfully');
  } else {
    console.error('❌ API startup validation failed');
  }

  if (result.errors.length > 0) {
    console.group('🚨 Configuration Errors:');
    result.errors.forEach(error => console.error(`  • ${error}`));
    console.groupEnd();
  }

  if (result.warnings.length > 0) {
    console.group('⚠️ Warnings:');
    result.warnings.forEach(warning => console.warn(`  • ${warning}`));
    console.groupEnd();
  }
};

/**
 * Initialize API client and perform startup validation
 * Call this function early in your application startup
 */
export const initializeAPI = async (): Promise<StartupValidationResult> => {
  const result = await validateAPIStartup();
  logStartupValidation(result);
  return result;
};