import { apiClient } from './client';
import { API_ENDPOINTS } from '@/lib/constants';
import type { User, PaginatedResponse, SystemAnalytics } from '@/types';

export const adminAPI = {
  /**
   * Get admin dashboard statistics
   */
  async getDashboard(): Promise<SystemAnalytics> {
    const response = await apiClient.get<SystemAnalytics>(
      API_ENDPOINTS.admin.dashboard
    );
    return response.data;
  },

  /**
   * Get system health status
   */
  async getHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: Record<string, { status: string; responseTime?: number }>;
    uptime: number;
  }> {
    const response = await apiClient.get('/admin/health');
    return response.data;
  },

  /**
   * Get all users with pagination and filtering
   */
  async getUsers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedResponse<User>> {
    const response = await apiClient.get<PaginatedResponse<User>>(
      API_ENDPOINTS.admin.users,
      { params }
    );
    return response.data;
  },

  /**
   * Get user by ID
   */
  async getUser(id: string): Promise<User> {
    const response = await apiClient.get<User>(`/admin/users/${id}`);
    return response.data;
  },

  /**
   * Update user
   */
  async updateUser(id: string, updates: Partial<User>): Promise<User> {
    const response = await apiClient.put<User>(`/admin/users/${id}`, updates);
    return response.data;
  },

  /**
   * Deactivate user
   */
  async deactivateUser(id: string, reason?: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/deactivate`, { reason });
  },

  /**
   * Reactivate user
   */
  async reactivateUser(id: string): Promise<void> {
    await apiClient.post(`/admin/users/${id}/reactivate`);
  },

  /**
   * Delete user
   */
  async deleteUser(id: string): Promise<void> {
    await apiClient.delete(`/admin/users/${id}`);
  },

  /**
   * Get system analytics
   */
  async getAnalytics(params?: {
    period?: '24h' | '7d' | '30d' | '90d';
    startDate?: string;
    endDate?: string;
  }): Promise<SystemAnalytics> {
    const response = await apiClient.get<SystemAnalytics>(
      API_ENDPOINTS.admin.analytics,
      { params }
    );
    return response.data;
  },

  /**
   * Get audit logs
   */
  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    userId?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<
    PaginatedResponse<{
      id: string;
      userId: string;
      action: string;
      resource: string;
      details: any;
      ipAddress: string;
      userAgent: string;
      timestamp: string;
    }>
  > {
    const response = await apiClient.get(API_ENDPOINTS.admin.auditLogs, {
      params,
    });
    return response.data;
  },

  /**
   * Get audit logs for specific user
   */
  async getUserAuditLogs(
    userId: string,
    params?: {
      page?: number;
      limit?: number;
      action?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<any> {
    const response = await apiClient.get(`/admin/audit-logs/user/${userId}`, {
      params,
    });
    return response.data;
  },

  /**
   * Get security audit logs
   */
  async getSecurityLogs(params?: {
    page?: number;
    limit?: number;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    startDate?: string;
    endDate?: string;
  }): Promise<any> {
    const response = await apiClient.get('/admin/audit-logs/security', {
      params,
    });
    return response.data;
  },

  /**
   * Create admin user
   */
  async createAdmin(adminData: {
    email: string;
    name: string;
    password: string;
    permissions: string[];
  }): Promise<User> {
    const response = await apiClient.post<User>('/admin/admins', adminData);
    return response.data;
  },

  /**
   * Get all admin users
   */
  async getAdmins(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedResponse<User>> {
    const response = await apiClient.get<PaginatedResponse<User>>(
      '/admin/admins',
      { params }
    );
    return response.data;
  },

  /**
   * Update admin user
   */
  async updateAdmin(id: string, updates: Partial<User>): Promise<User> {
    const response = await apiClient.put<User>(`/admin/admins/${id}`, updates);
    return response.data;
  },

  /**
   * Delete admin user
   */
  async deleteAdmin(id: string): Promise<void> {
    await apiClient.delete(`/admin/admins/${id}`);
  },

  /**
   * Get system configuration
   */
  async getConfig(): Promise<any> {
    const response = await apiClient.get('/admin/config');
    return response.data;
  },

  /**
   * Update system configuration
   */
  async updateConfig(config: any): Promise<any> {
    const response = await apiClient.put('/admin/config', config);
    return response.data;
  },

  /**
   * Get system metrics
   */
  async getMetrics(): Promise<{
    cpu: number;
    memory: number;
    disk: number;
    network: { in: number; out: number };
    activeConnections: number;
    requestsPerMinute: number;
  }> {
    const response = await apiClient.get('/admin/metrics');
    return response.data;
  },

  /**
   * Perform system maintenance tasks
   */
  async performMaintenance(task: 'cleanup' | 'optimize' | 'backup'): Promise<{
    success: boolean;
    message: string;
    details?: any;
  }> {
    const response = await apiClient.post('/admin/maintenance', { task });
    return response.data;
  },
};