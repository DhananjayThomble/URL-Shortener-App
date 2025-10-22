// App Configuration
export const APP_CONFIG = {
  name: process.env.NEXT_PUBLIC_APP_NAME || 'SnapURL',
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    'The Beginner-Friendly URL Shortener',
  url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001',
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1',
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'development',
} as const;

// Feature Flags
export const FEATURES = {
  analytics: process.env.NEXT_PUBLIC_ENABLE_ANALYTICS === 'true',
  qrCodes: process.env.NEXT_PUBLIC_ENABLE_QR_CODES === 'true',
  customDomains: process.env.NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS === 'true',
  pwa: process.env.NEXT_PUBLIC_ENABLE_PWA === 'true',
} as const;

// API Endpoints
export const API_ENDPOINTS = {
  // Authentication
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    profile: '/auth/profile',
  },
  // URLs
  urls: {
    create: '/urls',
    list: '/urls',
    get: (id: string) => `/urls/${id}`,
    update: (id: string) => `/urls/${id}`,
    delete: (id: string) => `/urls/${id}`,
    analytics: (id: string) => `/urls/${id}/analytics`,
    bulk: '/urls/bulk',
    category: (category: string) => `/urls/category/${category}`,
    search: '/urls/search/tags',
    popular: '/urls/popular/top',
  },
  // Users
  users: {
    profile: '/users/profile',
    verifyEmail: '/users/verify-email',
    get: (id: string) => `/users/${id}`,
    update: (id: string) => `/users/${id}`,
    delete: (id: string) => `/users/${id}`,
  },
  // Admin
  admin: {
    dashboard: '/admin/dashboard',
    users: '/admin/users',
    analytics: '/admin/analytics/overview',
    auditLogs: '/admin/audit-logs',
  },
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  accessToken: 'snapurl_access_token',
  refreshToken: 'snapurl_refresh_token',
  user: 'snapurl_user',
  theme: 'snapurl_theme',
  preferences: 'snapurl_preferences',
} as const;

// Query Keys for TanStack Query
export const QUERY_KEYS = {
  auth: {
    user: ['auth', 'user'],
    profile: ['auth', 'profile'],
  },
  urls: {
    all: ['urls'],
    list: (params?: any) => ['urls', 'list', params],
    detail: (id: string) => ['urls', 'detail', id],
    analytics: (id: string, period?: string) => [
      'urls',
      'analytics',
      id,
      period,
    ],
    category: (category: string) => ['urls', 'category', category],
    popular: (limit?: number) => ['urls', 'popular', limit],
  },
  admin: {
    dashboard: ['admin', 'dashboard'],
    users: (params?: any) => ['admin', 'users', params],
    analytics: ['admin', 'analytics'],
    auditLogs: (params?: any) => ['admin', 'audit-logs', params],
  },
} as const;

// Pagination
export const PAGINATION = {
  defaultLimit: 10,
  maxLimit: 100,
  defaultPage: 1,
} as const;

// URL Validation
export const URL_PATTERNS = {
  url: /^https?:\/\/.+/,
  shortCode: /^[a-zA-Z0-9_-]+$/,
  customBackHalf: /^[a-zA-Z0-9_-]{3,20}$/,
} as const;

// Date Formats
export const DATE_FORMATS = {
  display: 'MMM dd, yyyy',
  displayWithTime: 'MMM dd, yyyy HH:mm',
  iso: "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
  api: 'yyyy-MM-dd',
} as const;

// Analytics Periods
export const ANALYTICS_PERIODS = [
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const;

// URL Categories
export const URL_CATEGORIES = [
  'Business',
  'Personal',
  'Social Media',
  'Marketing',
  'Education',
  'Technology',
  'Entertainment',
  'News',
  'Other',
] as const;

// User Roles
export const USER_ROLES = {
  USER: 'user',
  ADMIN: 'admin',
} as const;

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection.',
  UNAUTHORIZED: 'You are not authorized to perform this action.',
  FORBIDDEN: 'Access denied.',
  NOT_FOUND: 'Resource not found.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  SERVER_ERROR: 'Something went wrong. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please try again later.',
} as const;
