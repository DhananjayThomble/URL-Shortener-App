/**
 * Base API client with Axios configuration, error handling, and authentication
 */

import axios, { AxiosInstance, AxiosError, AxiosResponse, AxiosRequestConfig } from 'axios';
import { APIClientConfig, APIError, APIResponse, AuthTokens } from './types';
import { defaultAPIConfig } from './config';

export class APIClient {
  private axiosInstance: AxiosInstance;
  private config: APIClientConfig;
  private authTokens: AuthTokens | null = null;

  constructor(config: APIClientConfig = defaultAPIConfig) {
    this.config = config;
    this.axiosInstance = this.createAxiosInstance();
    this.setupInterceptors();
  }

  private createAxiosInstance(): AxiosInstance {
    return axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private setupInterceptors(): void {
    // Request interceptor for adding auth tokens
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.authTokens?.accessToken) {
          config.headers.Authorization = `Bearer ${this.authTokens.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for handling auth errors and retries
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        // Handle 401 errors with token refresh
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            await this.refreshAuthTokens();
            // Retry original request with new token
            if (this.authTokens?.accessToken) {
              originalRequest.headers = originalRequest.headers || {};
              originalRequest.headers.Authorization = `Bearer ${this.authTokens.accessToken}`;
              return this.axiosInstance.request(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, clear tokens and redirect to login
            this.clearAuthTokens();
            this.handleAuthenticationFailure();
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  private async refreshAuthTokens(): Promise<void> {
    if (!this.authTokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post(
        `${this.config.baseURL}/auth/refresh`,
        { refreshToken: this.authTokens.refreshToken }
      );

      if (response.data.success && response.data.data.tokens) {
        this.setAuthTokens(response.data.data.tokens);
        this.saveTokensToStorage(response.data.data.tokens);
      } else {
        throw new Error('Token refresh failed');
      }
    } catch (error) {
      this.clearAuthTokens();
      throw error;
    }
  }

  private handleAuthenticationFailure(): void {
    // Clear tokens from storage
    localStorage.removeItem('auth_tokens');
    
    // Redirect to login page
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  private handleError(error: AxiosError): APIError {
    if (error.response) {
      // Server responded with error status
      const responseData = error.response.data as any;
      return {
        code: responseData?.error?.code || 'SERVER_ERROR',
        message: responseData?.error?.message || 'Server error occurred',
        statusCode: error.response.status,
        details: responseData?.error?.details,
      };
    } else if (error.request) {
      // Network error
      return {
        code: 'NETWORK_ERROR',
        message: 'Network connection failed. Please check your internet connection.',
        statusCode: 0,
      };
    } else {
      // Request setup error
      return {
        code: 'REQUEST_ERROR',
        message: error.message || 'Request configuration error',
        statusCode: 0,
      };
    }
  }

  private async retryRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    attempt: number = 1
  ): Promise<AxiosResponse<T>> {
    try {
      return await requestFn();
    } catch (error) {
      const apiError = this.handleError(error as AxiosError);
      
      // Retry logic for network errors and 5xx server errors
      const shouldRetry = 
        attempt < this.config.retryAttempts &&
        (apiError.code === 'NETWORK_ERROR' || apiError.statusCode >= 500);

      if (shouldRetry) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retryRequest(requestFn, attempt + 1);
      }

      throw error;
    }
  }

  // Public methods for making API requests
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<APIResponse<T>> {
    try {
      const response = await this.retryRequest(() => 
        this.axiosInstance.get<T>(url, config)
      );
      
      // Handle NestJS backend direct response format
      // If response.data has success field, it's already wrapped
      if (response.data && typeof response.data === 'object' && 'success' in response.data) {
        return response.data as APIResponse<T>;
      }
      
      // Otherwise, wrap the response in our APIResponse format
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this.handleError(error as AxiosError),
      };
    }
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<APIResponse<T>> {
    try {
      const response = await this.retryRequest(() =>
        this.axiosInstance.post<T>(url, data, config)
      );
      
      // Handle NestJS backend direct response format
      // If response.data has success field, it's already wrapped
      if (response.data && typeof response.data === 'object' && 'success' in response.data) {
        return response.data as APIResponse<T>;
      }
      
      // Otherwise, wrap the response in our APIResponse format
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this.handleError(error as AxiosError),
      };
    }
  }

  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<APIResponse<T>> {
    try {
      const response = await this.retryRequest(() =>
        this.axiosInstance.put<T>(url, data, config)
      );
      
      // Handle NestJS backend direct response format
      // If response.data has success field, it's already wrapped
      if (response.data && typeof response.data === 'object' && 'success' in response.data) {
        return response.data as APIResponse<T>;
      }
      
      // Otherwise, wrap the response in our APIResponse format
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this.handleError(error as AxiosError),
      };
    }
  }

  async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<APIResponse<T>> {
    try {
      const response = await this.retryRequest(() =>
        this.axiosInstance.patch<T>(url, data, config)
      );
      
      // Handle NestJS backend direct response format
      // If response.data has success field, it's already wrapped
      if (response.data && typeof response.data === 'object' && 'success' in response.data) {
        return response.data as APIResponse<T>;
      }
      
      // Otherwise, wrap the response in our APIResponse format
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this.handleError(error as AxiosError),
      };
    }
  }

  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<APIResponse<T>> {
    try {
      const response = await this.retryRequest(() =>
        this.axiosInstance.delete<T>(url, config)
      );
      
      // Handle NestJS backend direct response format
      // If response.data has success field, it's already wrapped
      if (response.data && typeof response.data === 'object' && 'success' in response.data) {
        return response.data as APIResponse<T>;
      }
      
      // Otherwise, wrap the response in our APIResponse format
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this.handleError(error as AxiosError),
      };
    }
  }

  // Authentication token management
  setAuthTokens(tokens: AuthTokens): void {
    this.authTokens = tokens;
  }

  getAuthTokens(): AuthTokens | null {
    return this.authTokens;
  }

  clearAuthTokens(): void {
    this.authTokens = null;
  }

  isAuthenticated(): boolean {
    return !!this.authTokens?.accessToken;
  }

  // Token storage management
  saveTokensToStorage(tokens: AuthTokens): void {
    try {
      localStorage.setItem('auth_tokens', JSON.stringify(tokens));
    } catch (error) {
      console.warn('Failed to save tokens to localStorage:', error);
    }
  }

  loadTokensFromStorage(): AuthTokens | null {
    try {
      const stored = localStorage.getItem('auth_tokens');
      if (stored) {
        const tokens = JSON.parse(stored) as AuthTokens;
        this.setAuthTokens(tokens);
        return tokens;
      }
    } catch (error) {
      console.warn('Failed to load tokens from localStorage:', error);
    }
    return null;
  }

  // Utility methods
  getBaseURL(): string {
    return this.config.baseURL;
  }

  updateConfig(newConfig: Partial<APIClientConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.axiosInstance.defaults.baseURL = this.config.baseURL;
    this.axiosInstance.defaults.timeout = this.config.timeout;
  }
}

// Create and export a singleton instance
export const apiClient = new APIClient();