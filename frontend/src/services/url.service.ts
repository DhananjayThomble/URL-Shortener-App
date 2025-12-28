/**
 * URL Management Service
 * Handles all URL-related operations with the NestJS backend
 */

import { apiClient } from './api/client';
import { 
  CreateUrlRequest, 
  UpdateUrlRequest, 
  URL, 
  QRCodeOptions, 
  QRCodeResponse
} from './api/dto';
import { 
  URLListParams, 
  PaginatedResponse, 
  APIResponse 
} from './api/types';

export class URLService {
  private readonly baseEndpoint = '/urls';

  /**
   * Create a new shortened URL
   */
  async createURL(data: CreateUrlRequest): Promise<URL | null> {
    try {
      const response = await apiClient.post<URL>(`${this.baseEndpoint}`, data);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to create URL:', response.error);
        // Check if it's a backend configuration issue
        if (response.error?.code === 'MONGODB_ERROR') {
          throw new Error('Backend database is not properly configured. Please check MongoDB connection.');
        }
        return null;
      }
    } catch (error) {
      console.error('Error creating URL:', error);
      // Re-throw with user-friendly message for database issues
      if (error.message?.includes('MONGODB_ERROR') || error.message?.includes('database')) {
        throw new Error('URL shortening service is temporarily unavailable. Please try again later.');
      }
      throw error;
    }
  }

  /**
   * Get paginated list of URLs with optional filtering and search
   */
  async getURLs(params: URLListParams = {}): Promise<PaginatedResponse<URL> | null> {
    try {
      const queryParams = new URLSearchParams();
      
      // Add pagination parameters
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.sortBy) queryParams.append('sortBy', params.sortBy);
      if (params.order) queryParams.append('order', params.order);
      
      // Add filtering parameters
      if (params.search) queryParams.append('search', params.search);
      if (params.isActive !== undefined) queryParams.append('isActive', params.isActive.toString());
      if (params.category) queryParams.append('category', params.category);
      
      // Add tag filtering
      if (params.tags && params.tags.length > 0) {
        params.tags.forEach(tag => queryParams.append('tags', tag));
      }
      if (params.tagOperator) queryParams.append('tagOperator', params.tagOperator);

      const queryString = queryParams.toString();
      const endpoint = queryString ? `${this.baseEndpoint}?${queryString}` : this.baseEndpoint;
      
      const response = await apiClient.get<PaginatedResponse<URL>>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to fetch URLs:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching URLs:', error);
      return null;
    }
  }

  /**
   * Get a single URL by ID
   */
  async getURL(id: string): Promise<URL | null> {
    try {
      const response = await apiClient.get<URL>(`${this.baseEndpoint}/${id}`);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to fetch URL:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching URL:', error);
      return null;
    }
  }

  /**
   * Update an existing URL
   */
  async updateURL(id: string, data: UpdateUrlRequest): Promise<URL | null> {
    try {
      const response = await apiClient.patch<URL>(`${this.baseEndpoint}/${id}`, data);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to update URL:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error updating URL:', error);
      return null;
    }
  }

  /**
   * Delete a URL
   */
  async deleteURL(id: string): Promise<boolean> {
    try {
      const response = await apiClient.delete(`${this.baseEndpoint}/${id}`);
      
      if (response.success) {
        return true;
      } else {
        console.error('Failed to delete URL:', response.error);
        return false;
      }
    } catch (error) {
      console.error('Error deleting URL:', error);
      return false;
    }
  }

  /**
   * Generate QR code for a URL
   */
  async generateQRCode(id: string, options: QRCodeOptions = {}): Promise<QRCodeResponse | null> {
    try {
      const response = await apiClient.post<QRCodeResponse>(
        `${this.baseEndpoint}/${id}/qr-code`, 
        options
      );
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to generate QR code:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      return null;
    }
  }

  /**
   * Search URLs with advanced filtering
   */
  async searchURLs(query: string, filters: Partial<URLListParams> = {}): Promise<PaginatedResponse<URL> | null> {
    const searchParams: URLListParams = {
      search: query,
      ...filters
    };
    
    return this.getURLs(searchParams);
  }

  /**
   * Get URLs by tag
   */
  async getURLsByTag(tagName: string, params: Partial<URLListParams> = {}): Promise<PaginatedResponse<URL> | null> {
    const tagParams: URLListParams = {
      tags: [tagName],
      ...params
    };
    
    return this.getURLs(tagParams);
  }

  /**
   * Get URLs by multiple tags
   */
  async getURLsByTags(
    tags: string[], 
    operator: 'AND' | 'OR' = 'OR', 
    params: Partial<URLListParams> = {}
  ): Promise<PaginatedResponse<URL> | null> {
    const tagParams: URLListParams = {
      tags,
      tagOperator: operator,
      ...params
    };
    
    return this.getURLs(tagParams);
  }

  /**
   * Get active URLs only
   */
  async getActiveURLs(params: Partial<URLListParams> = {}): Promise<PaginatedResponse<URL> | null> {
    const activeParams: URLListParams = {
      isActive: true,
      ...params
    };
    
    return this.getURLs(activeParams);
  }

  /**
   * Get expired URLs
   */
  async getExpiredURLs(params: Partial<URLListParams> = {}): Promise<PaginatedResponse<URL> | null> {
    const expiredParams: URLListParams = {
      isActive: false,
      ...params
    };
    
    return this.getURLs(expiredParams);
  }

  /**
   * Bulk activate/deactivate URLs
   */
  async bulkUpdateStatus(ids: string[], isActive: boolean): Promise<boolean> {
    try {
      const response = await apiClient.patch(`${this.baseEndpoint}/bulk/status`, {
        ids,
        isActive
      });
      
      if (response.success) {
        return true;
      } else {
        console.error('Failed to bulk update URL status:', response.error);
        return false;
      }
    } catch (error) {
      console.error('Error bulk updating URL status:', error);
      return false;
    }
  }

  /**
   * Check if custom alias is available
   */
  async checkAliasAvailability(alias: string): Promise<boolean> {
    try {
      const response = await apiClient.get<{ available: boolean }>(`${this.baseEndpoint}/check-alias/${encodeURIComponent(alias)}`);
      
      if (response.success && response.data) {
        return response.data.available;
      } else {
        console.error('Failed to check alias availability:', response.error);
        return false;
      }
    } catch (error) {
      console.error('Error checking alias availability:', error);
      return false;
    }
  }

  /**
   * Get URL statistics
   */
  async getURLStats(id: string): Promise<any | null> {
    try {
      const response = await apiClient.get(`${this.baseEndpoint}/${id}/stats`);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to fetch URL stats:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching URL stats:', error);
      return null;
    }
  }
}

// Create and export a singleton instance
export const urlService = new URLService();