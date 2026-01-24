/**
 * Authentication service for NestJS backend integration
 * Handles login, register, logout, and token management
 */

import { apiClient } from './api/client';
import { 
  AuthTokens, 
  User, 
  AuthResponse, 
  LoginRequest, 
  RegisterRequest,
  APIResponse 
} from './api/types';

export interface AuthService {
  login(email: string, password: string): Promise<AuthResponse>;
  register(email: string, password: string, name?: string): Promise<AuthResponse>;
  logout(): Promise<void>;
  refreshToken(): Promise<AuthTokens>;
  getCurrentUser(): User | null;
  isAuthenticated(): boolean;
}

class AuthServiceImpl implements AuthService {
  private currentUser: User | null = null;

  constructor() {
    // Load tokens and user from storage on initialization
    this.initializeFromStorage();
  }

  private initializeFromStorage(): void {
    try {
      const tokens = apiClient.loadTokensFromStorage();
      if (tokens) {
        // Load user data from storage if available
        const userData = localStorage.getItem('current_user');
        if (userData) {
          this.currentUser = JSON.parse(userData);
        }
      }
    } catch (error) {
      console.warn('Failed to initialize auth service from storage:', error);
      this.clearAuthData();
    }
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    try {
      const loginData: LoginRequest = { email, password };
      const response = await apiClient.post<{
        access_token: string;
        refresh_token: string;
        user: User;
      }>('/auth/login', loginData);

      if (response.success && response.data) {
        const { access_token, refresh_token, user } = response.data;
        
        // Create tokens object
        const tokens: AuthTokens = {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresIn: 3600, // Default to 1 hour, should be provided by backend
        };

        // Store tokens and user data
        apiClient.setAuthTokens(tokens);
        apiClient.saveTokensToStorage(tokens);
        this.currentUser = user;
        this.saveUserToStorage(user);

        return {
          success: true,
          data: {
            user,
            tokens,
          },
        };
      } else {
        return {
          success: false,
          error: response.error || {
            code: 'LOGIN_FAILED',
            message: 'Login failed',
            statusCode: 401,
          },
        };
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: {
          code: 'LOGIN_ERROR',
          message: 'An error occurred during login',
          statusCode: 500,
        },
      };
    }
  }

  async register(email: string, password: string, name?: string): Promise<AuthResponse> {
    try {
      const registerData: RegisterRequest = { 
        email, 
        password, 
        name: name || '' 
      };
      
      const response = await apiClient.post<{
        access_token: string;
        refresh_token: string;
        user: User;
      }>('/auth/register', registerData);

      if (response.success && response.data) {
        const { access_token, refresh_token, user } = response.data;
        
        // Create tokens object
        const tokens: AuthTokens = {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresIn: 3600, // Default to 1 hour, should be provided by backend
        };

        // Store tokens and user data
        apiClient.setAuthTokens(tokens);
        apiClient.saveTokensToStorage(tokens);
        this.currentUser = user;
        this.saveUserToStorage(user);

        return {
          success: true,
          data: {
            user,
            tokens,
          },
        };
      } else {
        return {
          success: false,
          error: response.error || {
            code: 'REGISTER_FAILED',
            message: 'Registration failed',
            statusCode: 400,
          },
        };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: {
          code: 'REGISTER_ERROR',
          message: 'An error occurred during registration',
          statusCode: 500,
        },
      };
    }
  }

  async logout(): Promise<void> {
    try {
      const tokens = apiClient.getAuthTokens();
      
      // Call backend logout endpoint if we have tokens
      if (tokens?.refreshToken) {
        await apiClient.post('/auth/logout', {
          refresh_token: tokens.refreshToken,
        });
      }
    } catch (error) {
      console.warn('Logout API call failed:', error);
      // Continue with local cleanup even if API call fails
    } finally {
      // Always clear local auth data
      this.clearAuthData();
    }
  }

  async refreshToken(): Promise<AuthTokens> {
    const currentTokens = apiClient.getAuthTokens();
    
    if (!currentTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await apiClient.post<{
        access_token: string;
        refresh_token?: string;
      }>('/auth/refresh', {
        refresh_token: currentTokens.refreshToken,
      });

      if (response.success && response.data) {
        const { access_token, refresh_token } = response.data;
        
        // Create new tokens object
        const newTokens: AuthTokens = {
          accessToken: access_token,
          refreshToken: refresh_token || currentTokens.refreshToken, // Use new refresh token if provided
          expiresIn: 3600, // Default to 1 hour
        };

        // Update stored tokens
        apiClient.setAuthTokens(newTokens);
        apiClient.saveTokensToStorage(newTokens);

        return newTokens;
      } else {
        throw new Error(response.error?.message || 'Token refresh failed');
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      // Clear auth data on refresh failure
      this.clearAuthData();
      throw error;
    }
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  isAuthenticated(): boolean {
    return apiClient.isAuthenticated() && this.currentUser !== null;
  }

  private saveUserToStorage(user: User): void {
    try {
      localStorage.setItem('current_user', JSON.stringify(user));
    } catch (error) {
      console.warn('Failed to save user to localStorage:', error);
    }
  }

  private clearAuthData(): void {
    // Clear API client tokens
    apiClient.clearAuthTokens();
    
    // Clear local user data
    this.currentUser = null;
    
    // Clear storage
    try {
      localStorage.removeItem('auth_tokens');
      localStorage.removeItem('current_user');
    } catch (error) {
      console.warn('Failed to clear auth data from localStorage:', error);
    }
  }

  // Additional utility methods for advanced auth features
  
  async getCurrentUserProfile(): Promise<User | null> {
    if (!this.isAuthenticated()) {
      return null;
    }

    try {
      const response = await apiClient.post<User>('/auth/profile');
      
      if (response.success && response.data) {
        this.currentUser = response.data;
        this.saveUserToStorage(response.data);
        return response.data;
      }
    } catch (error) {
      console.warn('Failed to fetch user profile:', error);
    }
    
    return this.currentUser;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!this.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const response = await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });

      if (response.success) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: response.error?.message || 'Password change failed' 
        };
      }
    } catch (error) {
      console.error('Change password error:', error);
      return { 
        success: false, 
        error: 'An error occurred while changing password' 
      };
    }
  }

  async forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await apiClient.post('/auth/forgot-password', { email });

      if (response.success) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: response.error?.message || 'Password reset request failed' 
        };
      }
    } catch (error) {
      console.error('Forgot password error:', error);
      return { 
        success: false, 
        error: 'An error occurred while requesting password reset' 
      };
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await apiClient.post('/auth/reset-password', {
        token,
        newPassword,
      });

      if (response.success) {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: response.error?.message || 'Password reset failed' 
        };
      }
    } catch (error) {
      console.error('Reset password error:', error);
      return { 
        success: false, 
        error: 'An error occurred while resetting password' 
      };
    }
  }
}

// Create and export singleton instance
export const authService = new AuthServiceImpl();
