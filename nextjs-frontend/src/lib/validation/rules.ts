/**
 * Advanced Validation Rules and Utilities
 * 
 * Provides reusable validation rules and utilities for complex form validation scenarios.
 */
import { z } from 'zod';

// Common validation patterns
export const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-\(\)]+$/,
  url: /^https?:\/\/.+/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  username: /^[a-zA-Z0-9_]{3,20}$/,
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
} as const;

// Custom validation functions
export const ValidationRules = {
  /**
   * Validates email format
   */
  email: (message = 'Please enter a valid email address') =>
    z.string().regex(ValidationPatterns.email, message),

  /**
   * Validates phone number format
   */
  phone: (message = 'Please enter a valid phone number') =>
    z.string().regex(ValidationPatterns.phone, message),

  /**
   * Validates URL format
   */
  url: (message = 'Please enter a valid URL') =>
    z.string().regex(ValidationPatterns.url, message),

  /**
   * Validates slug format (URL-friendly string)
   */
  slug: (message = 'Please enter a valid slug (lowercase, numbers, hyphens only)') =>
    z.string().regex(ValidationPatterns.slug, message),

  /**
   * Validates username format
   */
  username: (message = 'Username must be 3-20 characters, letters, numbers, and underscores only') =>
    z.string().regex(ValidationPatterns.username, message),

  /**
   * Validates strong password
   */
  strongPassword: (message = 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character') =>
    z.string().regex(ValidationPatterns.strongPassword, message),

  /**
   * Validates password with custom requirements
   */
  password: (options: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumbers?: boolean;
    requireSpecialChars?: boolean;
    message?: string;
  } = {}) => {
    const {
      minLength = 8,
      requireUppercase = true,
      requireLowercase = true,
      requireNumbers = true,
      requireSpecialChars = true,
      message,
    } = options;

    return z.string()
      .min(minLength, `Password must be at least ${minLength} characters`)
      .refine((password) => {
        if (requireUppercase && !/[A-Z]/.test(password)) return false;
        if (requireLowercase && !/[a-z]/.test(password)) return false;
        if (requireNumbers && !/\d/.test(password)) return false;
        if (requireSpecialChars && !/[@$!%*?&]/.test(password)) return false;
        return true;
      }, message || 'Password does not meet requirements');
  },

  /**
   * Validates file size
   */
  fileSize: (maxSizeInMB: number, message?: string) =>
    z.instanceof(File).refine(
      (file) => file.size <= maxSizeInMB * 1024 * 1024,
      message || `File size must be less than ${maxSizeInMB}MB`
    ),

  /**
   * Validates file type
   */
  fileType: (allowedTypes: string[], message?: string) =>
    z.instanceof(File).refine(
      (file) => allowedTypes.includes(file.type),
      message || `File type must be one of: ${allowedTypes.join(', ')}`
    ),

  /**
   * Validates image file
   */
  imageFile: (maxSizeInMB = 5, message?: string) =>
    z.instanceof(File)
      .refine(
        (file) => file.type.startsWith('image/'),
        'File must be an image'
      )
      .refine(
        (file) => file.size <= maxSizeInMB * 1024 * 1024,
        message || `Image size must be less than ${maxSizeInMB}MB`
      ),
} as const;

// Utility functions for validation
export const ValidationUtils = {
  /**
   * Creates a schema for dynamic form fields
   */
  createDynamicSchema: (fields: Record<string, z.ZodType<any>>) => {
    return z.object(fields);
  },

  /**
   * Validates a single field value
   */
  validateField: async (schema: z.ZodType<any>, value: any) => {
    try {
      await schema.parseAsync(value);
      return { success: true, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return {
          success: false,
          error: error.issues[0]?.message || 'Validation failed',
        };
      }
      return { success: false, error: 'Unknown validation error' };
    }
  },

  /**
   * Transforms validation errors for display
   */
  formatValidationErrors: (error: z.ZodError) => {
    const errors: Record<string, string> = {};
    error.issues.forEach((err) => {
      const path = err.path.join('.');
      errors[path] = err.message;
    });
    return errors;
  },
} as const;

// Export types
export type ValidationRule = keyof typeof ValidationRules;
export type ValidationPattern = keyof typeof ValidationPatterns;