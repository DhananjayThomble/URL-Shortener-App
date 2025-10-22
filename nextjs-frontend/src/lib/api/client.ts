import { APP_CONFIG } from '@/lib/constants';
import { APIError, NetworkError } from './errors';
import type { APIResponse, RequestOptions } from '@/types';

class APIClient {
  private baseURL: string;
  private accessToken: string | null = null;

  constructor(baseURL: string = APP_CONFIG.apiUrl) {
    this.baseURL = baseURL;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T = any>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const url = `${this.baseURL}${endpoint}`;
    
    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add custom headers from options
    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      });
    }

    // Add authorization header if token is available
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    // Prepare request configuration
    const config: RequestInit = {
      ...options,
      headers,
    };

    // Handle query parameters
    let finalUrl = url;
    if (options.params) {
      const searchParams = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      const queryString = searchParams.toString();
      if (queryString) {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + queryString;
      }
    }

    // Handle request body
    if (options.body && config.method !== 'GET') {
      if (typeof options.body === 'object') {
        config.body = JSON.stringify(options.body);
      } else {
        config.body = options.body;
      }
    }

    try {
      const response = await fetch(finalUrl, config);
      
      // Handle non-JSON responses (like redirects)
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        if (!response.ok) {
          throw APIError.fromResponse(response.status, {
            message: `HTTP ${response.status}: ${response.statusText}`,
          });
        }
        // For successful non-JSON responses, return a generic success response
        return {
          data: null as T,
          success: true,
          message: 'Request completed successfully',
        };
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        if (!response.ok) {
          throw APIError.fromResponse(response.status);
        }
        throw new APIError(
          response.status,
          'Invalid JSON response from server'
        );
      }

      // Handle error responses
      if (!response.ok) {
        throw APIError.fromResponse(response.status, data);
      }

      // Return successful response
      return {
        data: data.data || data,
        success: true,
        message: data.message || 'Request completed successfully',
      };
    } catch (error) {
      // Handle network errors
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new NetworkError();
      }
      
      // Re-throw API errors
      if (error instanceof APIError) {
        throw error;
      }

      // Handle other errors
      throw new APIError(500, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // HTTP method helpers
  async get<T = any>(endpoint: string, options: Omit<RequestOptions, 'method'> = {}): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = any>(endpoint: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  async put<T = any>(endpoint: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  async patch<T = any>(endpoint: string, body?: any, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  async delete<T = any>(endpoint: string, options: Omit<RequestOptions, 'method'> = {}): Promise<APIResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

// Create and export singleton instance
export const apiClient = new APIClient();

// Export class for testing or multiple instances
export { APIClient };