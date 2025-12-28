/**
 * API service exports and initialization
 */

export * from './types';
export * from './config';
export * from './client';
export * from './dto';
export * from './startup';

// Re-export the singleton API client for easy importing
export { apiClient as default } from './client';