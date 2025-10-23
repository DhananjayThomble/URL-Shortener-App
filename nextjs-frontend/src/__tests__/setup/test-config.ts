/**
 * Test configuration and constants
 */

export const TEST_CONFIG = {
  // API endpoints
  API_BASE_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  
  // Test timeouts
  DEFAULT_TIMEOUT: 5000,
  ASYNC_TIMEOUT: 10000,
  
  // Mock data constants
  MOCK_USER_ID: '1',
  MOCK_ADMIN_ID: 'admin-1',
  MOCK_URL_ID: 'url-1',
  
  // Test user credentials
  VALID_EMAIL: 'test@example.com',
  VALID_PASSWORD: 'password',
  INVALID_EMAIL: 'invalid-email',
  INVALID_PASSWORD: 'wrong',
  
  // Form validation messages
  VALIDATION_MESSAGES: {
    REQUIRED_FIELD: /required/i,
    INVALID_EMAIL: /invalid email/i,
    PASSWORD_TOO_SHORT: /password must be at least/i,
    PASSWORDS_DONT_MATCH: /passwords don't match/i,
    INVALID_URL: /please enter a valid url/i,
  },
  
  // Loading states
  LOADING_MESSAGES: {
    SIGNING_IN: /signing in/i,
    CREATING_ACCOUNT: /creating account/i,
    SHORTENING: /shortening/i,
    LOADING: /loading/i,
    SAVING: /saving/i,
    UPDATING: /updating/i,
    DELETING: /deleting/i,
  },
  
  // Success messages
  SUCCESS_MESSAGES: {
    LOGIN_SUCCESS: /welcome/i,
    REGISTRATION_SUCCESS: /account created/i,
    URL_CREATED: /url shortened successfully/i,
    PROFILE_UPDATED: /profile updated/i,
    PASSWORD_CHANGED: /password changed/i,
  },
  
  // Error messages
  ERROR_MESSAGES: {
    INVALID_CREDENTIALS: /invalid credentials/i,
    SERVER_ERROR: /server error/i,
    NETWORK_ERROR: /network error/i,
    UNAUTHORIZED: /unauthorized/i,
    FORBIDDEN: /forbidden/i,
    NOT_FOUND: /not found/i,
    RATE_LIMITED: /rate limit/i,
  },
}

/**
 * Common test data generators
 */
export const generateTestData = {
  user: (overrides = {}) => ({
    id: TEST_CONFIG.MOCK_USER_ID,
    email: TEST_CONFIG.VALID_EMAIL,
    name: 'Test User',
    isEmailVerified: true,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }),
  
  adminUser: (overrides = {}) => ({
    id: TEST_CONFIG.MOCK_ADMIN_ID,
    email: 'admin@example.com',
    name: 'Admin User',
    isEmailVerified: true,
    role: 'admin' as const,
    permissions: ['user_management', 'analytics_view'],
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }),
  
  url: (overrides = {}) => ({
    id: TEST_CONFIG.MOCK_URL_ID,
    originalUrl: 'https://example.com',
    shortCode: 'abc123',
    customBackHalf: null,
    category: 'general',
    tags: [],
    visitCount: 10,
    isActive: true,
    expiresAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    userId: TEST_CONFIG.MOCK_USER_ID,
    ...overrides,
  }),
  
  analytics: (overrides = {}) => ({
    totalClicks: 100,
    uniqueClicks: 80,
    clicksByDate: [
      { date: '2024-01-01', clicks: 10 },
      { date: '2024-01-02', clicks: 15 },
      { date: '2024-01-03', clicks: 20 },
    ],
    topCountries: [
      { country: 'United States', clicks: 50 },
      { country: 'United Kingdom', clicks: 30 },
    ],
    topDevices: [
      { device: 'Desktop', clicks: 60 },
      { device: 'Mobile', clicks: 40 },
    ],
    topBrowsers: [
      { browser: 'Chrome', percentage: 70 },
      { browser: 'Firefox', percentage: 30 },
    ],
    topReferrers: [
      { referrer: 'google.com', clicks: 40 },
      { referrer: 'direct', clicks: 60 },
    ],
    ...overrides,
  }),
}

/**
 * Test helper functions
 */
export const testHelpers = {
  /**
   * Wait for async operations to complete
   */
  waitForAsync: () => new Promise(resolve => setTimeout(resolve, 0)),
  
  /**
   * Create a mock API response
   */
  createApiResponse: <T>(data: T, success = true) => ({
    data,
    success,
    message: success ? 'Success' : 'Error',
  }),
  
  /**
   * Create a mock error response
   */
  createErrorResponse: (message: string, status = 400) => ({
    message,
    status,
    success: false,
  }),
  
  /**
   * Generate random test data
   */
  randomString: (length = 10) => 
    Math.random().toString(36).substring(2, length + 2),
  
  randomEmail: () => 
    `test${testHelpers.randomString(5)}@example.com`,
  
  randomUrl: () => 
    `https://example${testHelpers.randomString(3)}.com`,
}

/**
 * Test environment setup
 */
export const setupTestEnvironment = () => {
  // Set test environment variables
  process.env.NODE_ENV = 'test'
  process.env.NEXT_PUBLIC_API_URL = TEST_CONFIG.API_BASE_URL
  
  // Configure test timeouts
  jest.setTimeout(TEST_CONFIG.DEFAULT_TIMEOUT)
}

/**
 * Common test patterns
 */
export const testPatterns = {
  /**
   * Test form validation
   */
  async testFormValidation(
    getInput: () => HTMLElement,
    getSubmitButton: () => HTMLElement,
    invalidValue: string,
    expectedError: RegExp
  ) {
    const { userEvent, screen, waitFor } = await import('@testing-library/react')
    const user = userEvent.setup()
    
    const input = getInput()
    const submitButton = getSubmitButton()
    
    await user.clear(input)
    await user.type(input, invalidValue)
    await user.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText(expectedError)).toBeInTheDocument()
    })
  },
  
  /**
   * Test loading states
   */
  async testLoadingState(
    triggerAction: () => Promise<void>,
    expectedLoadingText: RegExp
  ) {
    const { screen, waitFor } = await import('@testing-library/react')
    
    await triggerAction()
    
    await waitFor(() => {
      expect(screen.getByText(expectedLoadingText)).toBeInTheDocument()
    })
  },
  
  /**
   * Test error handling
   */
  async testErrorHandling(
    triggerError: () => Promise<void>,
    expectedErrorText: RegExp
  ) {
    const { screen, waitFor } = await import('@testing-library/react')
    
    await triggerError()
    
    await waitFor(() => {
      expect(screen.getByText(expectedErrorText)).toBeInTheDocument()
    })
  },
}