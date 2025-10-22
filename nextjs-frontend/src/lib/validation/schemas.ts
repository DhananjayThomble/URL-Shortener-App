import { z } from 'zod';

// Common validation patterns
export const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s\-\(\)]+$/,
  url: /^https?:\/\/.+/,
  strongPassword: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
  alphanumeric: /^[a-zA-Z0-9]+$/,
  slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
} as const;

// Common validation messages
export const ValidationMessages = {
  required: 'This field is required',
  email: 'Please enter a valid email address',
  phone: 'Please enter a valid phone number',
  url: 'Please enter a valid URL',
  minLength: (min: number) => `Must be at least ${min} characters`,
  maxLength: (max: number) => `Must be no more than ${max} characters`,
  min: (min: number) => `Must be at least ${min}`,
  max: (max: number) => `Must be no more than ${max}`,
  strongPassword: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  passwordMatch: 'Passwords do not match',
  alphanumeric: 'Only letters and numbers are allowed',
  slug: 'Only lowercase letters, numbers, and hyphens are allowed',
} as const;

// Base field schemas
export const BaseSchemas = {
  // String fields
  requiredString: (message?: string) => 
    z.string().min(1, message || ValidationMessages.required),
  
  email: (message?: string) => 
    z.string()
      .min(1, ValidationMessages.required)
      .email(message || ValidationMessages.email),
  
  phone: (message?: string) => 
    z.string()
      .min(1, ValidationMessages.required)
      .regex(ValidationPatterns.phone, message || ValidationMessages.phone),
  
  url: (message?: string) => 
    z.string()
      .min(1, ValidationMessages.required)
      .url(message || ValidationMessages.url),
  
  password: (minLength = 8, message?: string) => 
    z.string()
      .min(1, ValidationMessages.required)
      .min(minLength, ValidationMessages.minLength(minLength))
      .regex(ValidationPatterns.strongPassword, message || ValidationMessages.strongPassword),
  
  slug: (message?: string) => 
    z.string()
      .min(1, ValidationMessages.required)
      .regex(ValidationPatterns.slug, message || ValidationMessages.slug),
  
  // Number fields
  requiredNumber: (message?: string) => 
    z.number({ message: message || ValidationMessages.required }),
  
  positiveNumber: (message?: string) => 
    z.number({ message: ValidationMessages.required })
      .positive(message || 'Must be a positive number'),
  
  // Boolean fields
  requiredBoolean: (message?: string) => 
    z.boolean({ message: message || ValidationMessages.required }),
  
  // Array fields
  requiredArray: <T>(schema: z.ZodType<T>, message?: string) => 
    z.array(schema).min(1, message || 'At least one item is required'),
  
  // Date fields
  requiredDate: (message?: string) => 
    z.date({ message: message || ValidationMessages.required }),
  
  futureDate: (message?: string) => 
    z.date({ message: ValidationMessages.required })
      .refine((date) => date > new Date(), message || 'Date must be in the future'),
  
  pastDate: (message?: string) => 
    z.date({ message: ValidationMessages.required })
      .refine((date) => date < new Date(), message || 'Date must be in the past'),
} as const;

// Authentication schemas
export const AuthSchemas = {
  login: z.object({
    email: BaseSchemas.email(),
    password: z.string().min(1, ValidationMessages.required),
    rememberMe: z.boolean().optional(),
  }),

  register: z.object({
    name: BaseSchemas.requiredString()
      .min(2, ValidationMessages.minLength(2))
      .max(50, ValidationMessages.maxLength(50)),
    email: BaseSchemas.email(),
    password: BaseSchemas.password(),
    confirmPassword: z.string().min(1, ValidationMessages.required),
    acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions'),
  }).refine((data) => data.password === data.confirmPassword, {
    message: ValidationMessages.passwordMatch,
    path: ['confirmPassword'],
  }),

  forgotPassword: z.object({
    email: BaseSchemas.email(),
  }),

  resetPassword: z.object({
    token: BaseSchemas.requiredString(),
    password: BaseSchemas.password(),
    confirmPassword: z.string().min(1, ValidationMessages.required),
  }).refine((data) => data.password === data.confirmPassword, {
    message: ValidationMessages.passwordMatch,
    path: ['confirmPassword'],
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1, ValidationMessages.required),
    newPassword: BaseSchemas.password(),
    confirmPassword: z.string().min(1, ValidationMessages.required),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: ValidationMessages.passwordMatch,
    path: ['confirmPassword'],
  }),
} as const;

// User profile schemas
export const UserSchemas = {
  profile: z.object({
    name: BaseSchemas.requiredString()
      .min(2, ValidationMessages.minLength(2))
      .max(50, ValidationMessages.maxLength(50)),
    email: BaseSchemas.email(),
    phone: BaseSchemas.phone().optional().or(z.literal('')),
    bio: z.string().max(500, ValidationMessages.maxLength(500)).optional(),
    website: BaseSchemas.url().optional().or(z.literal('')),
    location: z.string().max(100, ValidationMessages.maxLength(100)).optional(),
    avatar: z.string().url().optional(),
  }),

  preferences: z.object({
    theme: z.enum(['light', 'dark', 'system']),
    language: z.string().min(2).max(5),
    timezone: z.string(),
    emailNotifications: z.boolean(),
    pushNotifications: z.boolean(),
    marketingEmails: z.boolean(),
  }),
} as const;

// URL shortener schemas
export const UrlSchemas = {
  createUrl: z.object({
    originalUrl: BaseSchemas.url('Please enter a valid URL'),
    customSlug: z.string()
      .regex(ValidationPatterns.slug, ValidationMessages.slug)
      .min(3, ValidationMessages.minLength(3))
      .max(50, ValidationMessages.maxLength(50))
      .optional()
      .or(z.literal('')),
    title: z.string()
      .max(100, ValidationMessages.maxLength(100))
      .optional(),
    description: z.string()
      .max(500, ValidationMessages.maxLength(500))
      .optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    expiresAt: z.date().optional(),
    password: z.string().optional(),
    isPublic: z.boolean().default(true),
  }),

  updateUrl: z.object({
    title: z.string()
      .max(100, ValidationMessages.maxLength(100))
      .optional(),
    description: z.string()
      .max(500, ValidationMessages.maxLength(500))
      .optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    expiresAt: z.date().optional(),
    password: z.string().optional(),
    isPublic: z.boolean().optional(),
  }),

  bulkCreate: z.object({
    urls: z.array(z.object({
      originalUrl: BaseSchemas.url(),
      customSlug: z.string().optional(),
      title: z.string().optional(),
    })).min(1, 'At least one URL is required').max(100, 'Maximum 100 URLs allowed'),
  }),
} as const;

// Contact and feedback schemas
export const ContactSchemas = {
  contact: z.object({
    name: BaseSchemas.requiredString()
      .min(2, ValidationMessages.minLength(2))
      .max(50, ValidationMessages.maxLength(50)),
    email: BaseSchemas.email(),
    subject: BaseSchemas.requiredString()
      .min(5, ValidationMessages.minLength(5))
      .max(100, ValidationMessages.maxLength(100)),
    message: BaseSchemas.requiredString()
      .min(10, ValidationMessages.minLength(10))
      .max(1000, ValidationMessages.maxLength(1000)),
    category: z.enum(['general', 'support', 'bug', 'feature', 'business']),
  }),

  feedback: z.object({
    rating: z.number().min(1).max(5),
    comment: z.string()
      .max(500, ValidationMessages.maxLength(500))
      .optional(),
    category: z.enum(['usability', 'performance', 'features', 'design', 'other']),
    wouldRecommend: z.boolean(),
  }),
} as const;

// Admin schemas
export const AdminSchemas = {
  userManagement: z.object({
    userId: BaseSchemas.requiredString(),
    action: z.enum(['activate', 'deactivate', 'delete', 'promote', 'demote']),
    reason: z.string().max(200, ValidationMessages.maxLength(200)).optional(),
  }),

  systemSettings: z.object({
    siteName: BaseSchemas.requiredString().max(50),
    siteDescription: z.string().max(200).optional(),
    maintenanceMode: z.boolean(),
    registrationEnabled: z.boolean(),
    maxUrlsPerUser: BaseSchemas.positiveNumber(),
    defaultUrlExpiry: BaseSchemas.positiveNumber().optional(),
  }),
} as const;

// Export all schemas
export const ValidationSchemas = {
  ...AuthSchemas,
  ...UserSchemas,
  ...UrlSchemas,
  ...ContactSchemas,
  ...AdminSchemas,
} as const;

// Type inference helpers
export type LoginFormData = z.infer<typeof AuthSchemas.login>;
export type RegisterFormData = z.infer<typeof AuthSchemas.register>;
export type ForgotPasswordFormData = z.infer<typeof AuthSchemas.forgotPassword>;
export type ResetPasswordFormData = z.infer<typeof AuthSchemas.resetPassword>;
export type ChangePasswordFormData = z.infer<typeof AuthSchemas.changePassword>;
export type ProfileFormData = z.infer<typeof UserSchemas.profile>;
export type PreferencesFormData = z.infer<typeof UserSchemas.preferences>;
export type CreateUrlFormData = z.infer<typeof UrlSchemas.createUrl>;
export type UpdateUrlFormData = z.infer<typeof UrlSchemas.updateUrl>;
export type ContactFormData = z.infer<typeof ContactSchemas.contact>;
export type FeedbackFormData = z.infer<typeof ContactSchemas.feedback>;