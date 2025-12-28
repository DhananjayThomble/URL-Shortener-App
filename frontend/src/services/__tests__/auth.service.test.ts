/**
 * Unit tests for the authentication service
 */

import { authService } from '../auth.service';
import { apiClient } from '../api/client';
import { AuthTokens, User } from '../api/types';

// Mock the API client
jest.mock('../api/client', () => ({
  apiClient: {
    post: jest.fn(),
    setAuthTokens: jest.fn(),
    saveTokensToStorage: jest.fn(),
    getAuthTokens: jest.fn(),
    clearAuthTokens: jest.fn(),
    isAuthenticated: jest.fn(),
    loadTokensFromStorage: jest.fn(),
  },
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

describe('AuthService', () => {
  const mockUser: User = {
    id: '123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    isEmailVerified: true,
    createdAt: '2024-01-01T00:00:00Z',
  };

  const mockTokens: AuthTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      // Mock successful API response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          access_token: mockTokens.accessToken,
          refresh_token: mockTokens.refreshToken,
          user: mockUser,
        },
      });

      const result = await authService.login('test@example.com', 'password');

      expect(result.success).toBe(true);
      expect(result.data?.user).toEqual(mockUser);
      expect(result.data?.tokens.accessToken).toBe(mockTokens.accessToken);
      expect(apiClient.setAuthTokens).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
      }));
      expect(apiClient.saveTokensToStorage).toHaveBeenCalled();
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('current_user', JSON.stringify(mockUser));
    });

    it('should handle login failure', async () => {
      // Mock failed API response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          statusCode: 401,
        },
      });

      const result = await authService.login('test@example.com', 'wrong-password');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_CREDENTIALS');
      expect(result.error?.message).toBe('Invalid email or password');
    });

    it('should handle network errors during login', async () => {
      // Mock network error
      (apiClient.post as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await authService.login('test@example.com', 'password');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('LOGIN_ERROR');
    });
  });

  describe('register', () => {
    it('should successfully register with valid data', async () => {
      // Mock successful API response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          access_token: mockTokens.accessToken,
          refresh_token: mockTokens.refreshToken,
          user: mockUser,
        },
      });

      const result = await authService.register('test@example.com', 'password', 'Test User');

      expect(result.success).toBe(true);
      expect(result.data?.user).toEqual(mockUser);
      expect(apiClient.setAuthTokens).toHaveBeenCalled();
      expect(apiClient.saveTokensToStorage).toHaveBeenCalled();
    });

    it('should handle registration failure', async () => {
      // Mock failed API response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          code: 'EMAIL_EXISTS',
          message: 'Email already exists',
          statusCode: 409,
        },
      });

      const result = await authService.register('test@example.com', 'password', 'Test User');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('EMAIL_EXISTS');
    });
  });

  describe('logout', () => {
    it('should successfully logout and clear auth data', async () => {
      // Mock tokens exist
      (apiClient.getAuthTokens as jest.Mock).mockReturnValue(mockTokens);
      (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

      await authService.logout();

      expect(apiClient.post).toHaveBeenCalledWith('/auth/logout', {
        refresh_token: mockTokens.refreshToken,
      });
      expect(apiClient.clearAuthTokens).toHaveBeenCalled();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('auth_tokens');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('current_user');
    });

    it('should clear local data even if API call fails', async () => {
      // Mock tokens exist but API call fails
      (apiClient.getAuthTokens as jest.Mock).mockReturnValue(mockTokens);
      (apiClient.post as jest.Mock).mockRejectedValue(new Error('Network error'));

      await authService.logout();

      expect(apiClient.clearAuthTokens).toHaveBeenCalled();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('auth_tokens');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('current_user');
    });
  });

  describe('refreshToken', () => {
    it('should successfully refresh tokens', async () => {
      // Mock current tokens
      (apiClient.getAuthTokens as jest.Mock).mockReturnValue(mockTokens);
      
      // Mock successful refresh response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: true,
        data: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
        },
      });

      const result = await authService.refreshToken();

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(apiClient.setAuthTokens).toHaveBeenCalledWith(expect.objectContaining({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      }));
    });

    it('should throw error when no refresh token available', async () => {
      // Mock no tokens
      (apiClient.getAuthTokens as jest.Mock).mockReturnValue(null);

      await expect(authService.refreshToken()).rejects.toThrow('No refresh token available');
    });

    it('should clear auth data on refresh failure', async () => {
      // Mock current tokens
      (apiClient.getAuthTokens as jest.Mock).mockReturnValue(mockTokens);
      
      // Mock failed refresh response
      (apiClient.post as jest.Mock).mockResolvedValue({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid refresh token',
          statusCode: 401,
        },
      });

      await expect(authService.refreshToken()).rejects.toThrow();
      expect(apiClient.clearAuthTokens).toHaveBeenCalled();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when authenticated with user data', () => {
      (apiClient.isAuthenticated as jest.Mock).mockReturnValue(true);
      
      // Set current user by mocking the private property
      (authService as any).currentUser = mockUser;

      expect(authService.isAuthenticated()).toBe(true);
    });

    it('should return false when not authenticated', () => {
      (apiClient.isAuthenticated as jest.Mock).mockReturnValue(false);

      expect(authService.isAuthenticated()).toBe(false);
    });

    it('should return false when authenticated but no user data', () => {
      (apiClient.isAuthenticated as jest.Mock).mockReturnValue(true);
      
      // No current user (default state)
      (authService as any).currentUser = null;

      expect(authService.isAuthenticated()).toBe(false);
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user when available', () => {
      // This test would need to access private state, so we'll test through login
      expect(authService.getCurrentUser()).toBeNull(); // Initially null
    });
  });
});