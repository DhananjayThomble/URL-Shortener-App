import { apiClient } from './client';
import type { APIResponse, PaginatedResponse } from '@/types';

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  permissions: AdminPermission[];
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export enum AdminPermission {
  USER_MANAGEMENT = 'user_management',
  URL_MANAGEMENT = 'url_management',
  ANALYTICS_VIEW = 'analytics_view',
  SYSTEM_CONFIG = 'system_config',
  AUDIT_LOGS = 'audit_logs',
}

export interface CreateAdminData {
  email: string;
  password: string;
  name: string;
  permissions: AdminPermission[];
}

export interface UpdateAdminData {
  name?: string;
  permissions?: AdminPermission[];
  isActive?: boolean;
}

export interface DashboardStats {
  users: {
    total: number;
    newThisMonth: number;
    activeThisWeek: number;
  };
  urls: {
    total: number;
    createdThisMonth: number;
    totalClicks: number;
  };
  analytics: {
    clicksToday: number;
    clicksThisWeek: number;
    topCountries: Array<{ country: string; clicks: number }>;
    topDevices: Array<{ device: string; clicks: number }>;
  };
  system: {
    cacheHitRate: number;
    avgResponseTime: number;
    uptime: number;
  };
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  database: {
    status: 'connected' | 'disconnected';
    responseTime: number;
  };
  redis: {
    status: 'connected' | 'disconnected';
    responseTime: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
  };
}

export interface AuditLog {
  id: string;
  adminId: string;
  action: string;
  resource: string;
  resourceId: string;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  isEmailVerified: boolean;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt?: string;
  urlCount: number;
  totalClicks: number;
}

export const adminAPI = {
  // Authentication
  login: (email: string, password: string): Promise<APIResponse<{ token: string; admin: AdminUser }>> => {
    return apiClient.post('/admin/auth/login', { email, password });
  },

  logout: (): Promise<APIResponse<void>> => {
    return apiClient.post('/admin/auth/logout');
  },

  changePassword: (currentPassword: string, newPassword: string): Promise<APIResponse<{ message: string }>> => {
    return apiClient.post('/admin/auth/change-password', { currentPassword, newPassword });
  },

  // Dashboard
  getDashboardStats: (): Promise<APIResponse<DashboardStats>> => {
    return apiClient.get('/admin/dashboard');
  },

  getSystemHealth: (): Promise<APIResponse<SystemHealth>> => {
    return apiClient.get('/admin/health');
  },

  // Admin Management
  createAdmin: (data: CreateAdminData): Promise<APIResponse<{ admin: AdminUser; message: string }>> => {
    return apiClient.post('/admin/admins', data);
  },

  getAllAdmins: (): Promise<APIResponse<{ admins: AdminUser[] }>> => {
    return apiClient.get('/admin/admins');
  },

  getAdminById: (id: string): Promise<APIResponse<{ admin: AdminUser }>> => {
    return apiClient.get(`/admin/admins/${id}`);
  },

  updateAdmin: (id: string, data: UpdateAdminData): Promise<APIResponse<{ admin: AdminUser; message: string }>> => {
    return apiClient.put(`/admin/admins/${id}`, data);
  },

  deleteAdmin: (id: string): Promise<APIResponse<void>> => {
    return apiClient.delete(`/admin/admins/${id}`);
  },

  // User Management
  getAllUsers: (page = 1, limit = 20): Promise<APIResponse<{ users: UserListItem[]; pagination: any }>> => {
    return apiClient.get('/admin/users', { params: { page, limit } });
  },

  getUserById: (id: string): Promise<APIResponse<{ user: UserListItem }>> => {
    return apiClient.get(`/admin/users/${id}`);
  },

  deactivateUser: (id: string, reason: string): Promise<APIResponse<{ message: string }>> => {
    return apiClient.post(`/admin/users/${id}/deactivate`, { reason });
  },

  // Audit Logs
  getAuditLogs: (limit = 100): Promise<APIResponse<{ logs: AuditLog[]; total: number }>> => {
    return apiClient.get('/admin/audit-logs', { params: { limit } });
  },

  getUserAuditLogs: (userId: string, limit = 50): Promise<APIResponse<{ logs: AuditLog[]; userId: string; total: number }>> => {
    return apiClient.get(`/admin/audit-logs/user/${userId}`, { params: { limit } });
  },

  getSecurityLogs: (limit = 100): Promise<APIResponse<{ logs: AuditLog[]; total: number }>> => {
    return apiClient.get('/admin/audit-logs/security', { params: { limit } });
  },

  // Analytics
  getAnalyticsOverview: (): Promise<APIResponse<{
    overview: {
      totalUsers: number;
      totalUrls: number;
      totalClicks: number;
      cacheHitRate: number;
    };
    trends: {
      newUsersThisMonth: number;
      newUrlsThisMonth: number;
      clicksToday: number;
      clicksThisWeek: number;
    };
    topCountries: Array<{ country: string; clicks: number }>;
    topDevices: Array<{ device: string; clicks: number }>;
  }>> => {
    return apiClient.get('/admin/analytics/overview');
  },
};