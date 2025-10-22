import { apiClient } from './client';
import { API_ENDPOINTS } from '@/lib/constants';
import type { User } from '@/types';

export const userAPI = {
  /**
   * Get current user profile
   */
  async getProfile(): Promise<User> {
    const response = await apiClient.get<User>(API_ENDPOINTS.users.profile);
    return response.data;
  },

  /**
   * Update current user profile
   */
  async updateProfile(updates: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>(
      API_ENDPOINTS.users.profile,
      updates
    );
    return response.data;
  },

  /**
   * Verify user email
   */
  async verifyEmail(token: string): Promise<void> {
    await apiClient.post(API_ENDPOINTS.users.verifyEmail, { token });
  },

  /**
   * Get user by ID (admin only)
   */
  async getUser(id: string): Promise<User> {
    const response = await apiClient.get<User>(API_ENDPOINTS.users.get(id));
    return response.data;
  },

  /**
   * Update user by ID (admin only)
   */
  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const response = await apiClient.patch<User>(
      API_ENDPOINTS.users.update(id),
      updates
    );
    return response.data;
  },

  /**
   * Delete user by ID (admin only)
   */
  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.users.delete(id));
  },

  /**
   * Change user password
   */
  async changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    await apiClient.post('/users/change-password', {
      currentPassword,
      newPassword,
    });
  },

  /**
   * Delete current user account
   */
  async deleteAccount(password: string): Promise<void> {
    await apiClient.post('/users/delete-account', { password });
  },

  /**
   * Get user preferences
   */
  async getPreferences(): Promise<any> {
    const response = await apiClient.get('/users/preferences');
    return response.data;
  },

  /**
   * Update user preferences
   */
  async updatePreferences(preferences: any): Promise<any> {
    const response = await apiClient.put('/users/preferences', preferences);
    return response.data;
  },

  /**
   * Get user's API keys
   */
  async getApiKeys(): Promise<any[]> {
    const response = await apiClient.get('/users/api-keys');
    return response.data;
  },

  /**
   * Create new API key
   */
  async createApiKey(name: string, permissions: string[]): Promise<any> {
    const response = await apiClient.post('/users/api-keys', {
      name,
      permissions,
    });
    return response.data;
  },

  /**
   * Revoke API key
   */
  async revokeApiKey(keyId: string): Promise<void> {
    await apiClient.delete(`/users/api-keys/${keyId}`);
  },
};