import { apiClient } from './client';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  LoginCredentials,
  RegisterData,
  AuthResponse,
  TokenResponse,
  User,
} from '@/types';

export const authAPI = {
  /**
   * Login user with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    // Filter out frontend-only fields before sending to backend
    const { twoFactorCode, rememberMe, ...backendData } = credentials as any;
    
    // Debug logging (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('Login request payload:', backendData);
    }
    
    const response = await apiClient.post<any>(
      API_ENDPOINTS.auth.login,
      backendData
    );
    
    // Transform backend response to match frontend expectations
    const responseData = response.data;
    
    // Handle different possible response structures
    let transformedResponse: AuthResponse;
    
    if (responseData.access_token) {
      // Backend returns flat structure with access_token
      transformedResponse = {
        user: {
          id: responseData.id || responseData.user?.id,
          email: responseData.email || responseData.user?.email,
          name: responseData.name || responseData.user?.name,
          isEmailVerified: responseData.isEmailVerified || responseData.user?.isEmailVerified || false,
          role: responseData.role || responseData.user?.role || 'user',
          createdAt: responseData.createdAt || responseData.user?.createdAt || new Date().toISOString(),
          updatedAt: responseData.updatedAt || responseData.user?.updatedAt || new Date().toISOString(),
        },
        tokens: {
          accessToken: responseData.access_token,
          refreshToken: responseData.refresh_token || responseData.refreshToken || '',
          expiresIn: responseData.expires_in || responseData.expiresIn || 3600,
        },
      };
    } else if (responseData.tokens) {
      // Backend returns expected structure
      transformedResponse = responseData;
    } else {
      throw new Error('Invalid response structure from server');
    }
    
    return transformedResponse;
  },

  /**
   * Register new user
   */
  async register(userData: RegisterData): Promise<AuthResponse> {
    // Filter out frontend-only fields before sending to backend
    const { confirmPassword, acceptTerms, ...backendData } = userData;
    
    const response = await apiClient.post<any>(
      API_ENDPOINTS.auth.register,
      backendData
    );
    
    // Debug logging (remove in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('Registration response:', response);
      console.log('Response data:', response.data);
    }
    
    // Transform backend response to match frontend expectations
    const responseData = response.data;
    
    // Handle different possible response structures
    let transformedResponse: AuthResponse;
    
    if (responseData.access_token) {
      // Backend returns flat structure with access_token
      transformedResponse = {
        user: {
          id: responseData.id || responseData.user?.id,
          email: responseData.email || responseData.user?.email,
          name: responseData.name || responseData.user?.name,
          isEmailVerified: responseData.isEmailVerified || responseData.user?.isEmailVerified || false,
          role: responseData.role || responseData.user?.role || 'user',
          createdAt: responseData.createdAt || responseData.user?.createdAt || new Date().toISOString(),
          updatedAt: responseData.updatedAt || responseData.user?.updatedAt || new Date().toISOString(),
        },
        tokens: {
          accessToken: responseData.access_token,
          refreshToken: responseData.refresh_token || responseData.refreshToken || '',
          expiresIn: responseData.expires_in || responseData.expiresIn || 3600,
        },
      };
    } else if (responseData.tokens) {
      // Backend returns expected structure
      transformedResponse = responseData;
    } else {
      throw new Error('Invalid response structure from server');
    }
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Transformed response:', transformedResponse);
    }
    return transformedResponse;
  },

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const response = await apiClient.post<TokenResponse>(
      API_ENDPOINTS.auth.refresh,
      { refreshToken }
    );
    return response.data;
  },

  /**
   * Logout user (invalidate current session)
   */
  async logout(refreshToken: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.auth.logout, { refreshToken });
  },

  /**
   * Logout from all devices (invalidate all sessions)
   */
  async logoutAll(refreshToken: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.auth.logout, { refreshToken });
  },

  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const response = await apiClient.get<User>(API_ENDPOINTS.auth.profile);
    return response.data;
  },

  /**
   * Update user profile
   */
  async updateProfile(updates: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>(
      API_ENDPOINTS.auth.profile,
      updates
    );
    return response.data;
  },

  /**
   * Request password reset
   */
  async requestPasswordReset(email: string): Promise<void> {
    await apiClient.post('/auth/forgot-password', { email });
  },

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/reset-password', {
      token,
      password: newPassword,
    });
  },

  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<void> {
    await apiClient.post('/auth/verify-email', { token });
  },

  /**
   * Resend email verification
   */
  async resendEmailVerification(): Promise<void> {
    await apiClient.post('/auth/resend-verification');
  },
};