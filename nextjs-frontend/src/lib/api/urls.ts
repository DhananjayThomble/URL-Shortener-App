import { apiClient } from './client';
import { API_ENDPOINTS } from '@/lib/constants';
import type {
  URLData,
  CreateURLData,
  UpdateURLData,
  URLListParams,
  PaginatedResponse,
  AnalyticsData,
  BulkURLOperation,
} from '@/types';

export const urlAPI = {
  /**
   * Create a new shortened URL
   */
  async createUrl(urlData: CreateURLData): Promise<URLData> {
    const response = await apiClient.post<URLData>(
      API_ENDPOINTS.urls.create,
      urlData
    );
    return response.data;
  },

  /**
   * Get paginated list of user's URLs
   */
  async getUserUrls(params?: URLListParams): Promise<PaginatedResponse<URLData>> {
    const response = await apiClient.get<PaginatedResponse<URLData>>(
      API_ENDPOINTS.urls.list,
      { params }
    );
    return response.data;
  },

  /**
   * Get a specific URL by ID
   */
  async getUrl(id: string): Promise<URLData> {
    const response = await apiClient.get<URLData>(
      API_ENDPOINTS.urls.get(id)
    );
    return response.data;
  },

  /**
   * Update an existing URL
   */
  async updateUrl(id: string, updates: UpdateURLData): Promise<URLData> {
    const response = await apiClient.patch<URLData>(
      API_ENDPOINTS.urls.update(id),
      updates
    );
    return response.data;
  },

  /**
   * Delete a URL
   */
  async deleteUrl(id: string): Promise<void> {
    await apiClient.delete(API_ENDPOINTS.urls.delete(id));
  },

  /**
   * Get URL analytics
   */
  async getUrlAnalytics(
    id: string,
    period?: '24h' | '7d' | '30d' | '90d'
  ): Promise<AnalyticsData> {
    const response = await apiClient.get<AnalyticsData>(
      API_ENDPOINTS.urls.analytics(id),
      { params: period ? { period } : undefined }
    );
    return response.data;
  },

  /**
   * Create multiple URLs at once
   */
  async bulkCreateUrls(urlsData: CreateURLData[]): Promise<URLData[]> {
    const response = await apiClient.post<URLData[]>(
      API_ENDPOINTS.urls.bulk,
      urlsData
    );
    return response.data;
  },

  /**
   * Get URLs by category
   */
  async getUrlsByCategory(
    category: string,
    params?: URLListParams
  ): Promise<PaginatedResponse<URLData>> {
    const response = await apiClient.get<PaginatedResponse<URLData>>(
      API_ENDPOINTS.urls.category(category),
      { params }
    );
    return response.data;
  },

  /**
   * Search URLs by tags
   */
  async searchUrlsByTags(
    tags: string[],
    params?: URLListParams
  ): Promise<PaginatedResponse<URLData>> {
    const response = await apiClient.post<PaginatedResponse<URLData>>(
      API_ENDPOINTS.urls.search,
      { tags },
      { params }
    );
    return response.data;
  },

  /**
   * Get popular URLs
   */
  async getPopularUrls(limit = 10): Promise<URLData[]> {
    const response = await apiClient.get<URLData[]>(
      API_ENDPOINTS.urls.popular,
      { params: { limit } }
    );
    return response.data;
  },

  /**
   * Set password protection for URL
   */
  async setUrlPassword(id: string, password: string): Promise<void> {
    await apiClient.put(`/urls/${id}/password`, { password });
  },

  /**
   * Remove password protection from URL
   */
  async removeUrlPassword(id: string): Promise<void> {
    await apiClient.delete(`/urls/${id}/password`);
  },

  /**
   * Deactivate a URL
   */
  async deactivateUrl(id: string): Promise<URLData> {
    const response = await apiClient.put<URLData>(`/urls/${id}/deactivate`);
    return response.data;
  },

  /**
   * Reactivate a URL
   */
  async reactivateUrl(id: string): Promise<URLData> {
    const response = await apiClient.put<URLData>(`/urls/${id}/reactivate`);
    return response.data;
  },

  /**
   * Perform bulk operations on URLs
   */
  async bulkOperation(operation: BulkURLOperation): Promise<void> {
    await apiClient.post('/urls/bulk-operation', operation);
  },

  /**
   * Export URLs to various formats
   */
  async exportUrls(
    format: 'csv' | 'excel' | 'json',
    urlIds?: string[]
  ): Promise<Blob> {
    const response = await apiClient.post(
      '/urls/export',
      { format, urlIds },
      {
        headers: {
          Accept: 'application/octet-stream',
        },
      }
    );
    
    // Handle blob response for file downloads
    if (response.data instanceof Blob) {
      return response.data;
    }
    
    // Fallback for non-blob responses
    throw new Error('Invalid export response format');
  },

  /**
   * Get URL redirect information (for public access)
   */
  async getRedirectInfo(shortCode: string): Promise<{
    originalUrl: string;
    requiresPassword: boolean;
    isActive: boolean;
  }> {
    const response = await apiClient.get(`/${shortCode}/info`);
    return response.data;
  },

  /**
   * Validate URL password (for password-protected URLs)
   */
  async validateUrlPassword(
    shortCode: string,
    password: string
  ): Promise<{ valid: boolean; originalUrl?: string }> {
    const response = await apiClient.post(`/${shortCode}/validate-password`, {
      password,
    });
    return response.data;
  },

  /**
   * Get dashboard metrics
   */
  async getDashboardMetrics(): Promise<any> {
    const response = await apiClient.get('/dashboard/metrics');
    return response.data;
  },
};