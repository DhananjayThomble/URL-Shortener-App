import { apiClient } from './client';
import type { APIResponse } from '@/types';

export interface UpdateProfileData {
  name?: string;
}

export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  isEmailVerified: boolean;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastLoginIp?: string;
}

export const usersAPI = {
  // Get current user profile
  getProfile: (): Promise<APIResponse<UserProfile>> => {
    return apiClient.get('/users/profile');
  },

  // Update current user profile
  updateProfile: (data: UpdateProfileData): Promise<APIResponse<UserProfile>> => {
    return apiClient.patch('/users/profile', data);
  },

  // Verify user email
  verifyEmail: (): Promise<APIResponse<{ message: string }>> => {
    return apiClient.post('/users/verify-email');
  },

  // Change password (delegated to auth API)
  changePassword: (data: ChangePasswordData): Promise<APIResponse<{ message: string }>> => {
    return apiClient.post('/auth/change-password', data);
  },

  // Export user data
  exportData: (): Promise<APIResponse<{ message: string }>> => {
    return apiClient.post('/users/export-data');
  },

  // Delete user account
  deleteAccount: (): Promise<APIResponse<{ message: string }>> => {
    return apiClient.delete('/users/profile');
  },

  // Get user by ID (admin only)
  getUserById: (id: string): Promise<APIResponse<UserProfile>> => {
    return apiClient.get(`/users/${id}`);
  },

  // Update user by ID (admin only)
  updateUser: (id: string, data: UpdateProfileData): Promise<APIResponse<UserProfile>> => {
    return apiClient.patch(`/users/${id}`, data);
  },

  // Delete user by ID (admin only)
  deleteUser: (id: string): Promise<APIResponse<{ message: string }>> => {
    return apiClient.delete(`/users/${id}`);
  },
};