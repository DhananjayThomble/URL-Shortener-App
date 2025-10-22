import { STORAGE_KEYS } from '@/lib/constants';
import type { AuthTokens, User } from '@/types';

class TokenStorage {
  private readonly ACCESS_TOKEN_KEY = STORAGE_KEYS.accessToken;
  private readonly REFRESH_TOKEN_KEY = STORAGE_KEYS.refreshToken;
  private readonly USER_KEY = STORAGE_KEYS.user;

  // In-memory storage for access token (more secure)
  private accessToken: string | null = null;

  /**
   * Check if we're running in the browser
   */
  private get isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  /**
   * Set authentication tokens
   */
  setTokens(tokens: AuthTokens): void {
    // Store access token in memory only
    this.accessToken = tokens.accessToken;

    if (this.isBrowser) {
      // Store refresh token in localStorage (could be httpOnly cookie in production)
      localStorage.setItem(this.REFRESH_TOKEN_KEY, tokens.refreshToken);
    }
  }

  /**
   * Get access token from memory
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Get refresh token from localStorage
   */
  getRefreshToken(): string | null {
    if (!this.isBrowser) return null;
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Set user data
   */
  setUser(user: User): void {
    if (this.isBrowser) {
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
  }

  /**
   * Get user data
   */
  getUser(): User | null {
    if (!this.isBrowser) return null;
    
    const userData = localStorage.getItem(this.USER_KEY);
    if (!userData) return null;

    try {
      return JSON.parse(userData);
    } catch {
      // Clear invalid data
      this.clearUser();
      return null;
    }
  }

  /**
   * Clear all authentication data
   */
  clearTokens(): void {
    this.accessToken = null;

    if (this.isBrowser) {
      localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    }
  }

  /**
   * Clear user data
   */
  clearUser(): void {
    if (this.isBrowser) {
      localStorage.removeItem(this.USER_KEY);
    }
  }

  /**
   * Clear all authentication and user data
   */
  clearAll(): void {
    this.clearTokens();
    this.clearUser();
  }

  /**
   * Check if user is authenticated (has valid tokens)
   */
  isAuthenticated(): boolean {
    return !!(this.getAccessToken() && this.getRefreshToken());
  }

  /**
   * Initialize token storage (restore from localStorage on app start)
   */
  initialize(): { user: User | null; hasRefreshToken: boolean } {
    const user = this.getUser();
    const hasRefreshToken = !!this.getRefreshToken();

    return { user, hasRefreshToken };
  }

  /**
   * Get token expiration time (decode JWT payload)
   */
  getTokenExpiration(token?: string): number | null {
    const tokenToCheck = token || this.getAccessToken();
    if (!tokenToCheck) return null;

    try {
      const payload = JSON.parse(atob(tokenToCheck.split('.')[1]));
      return payload.exp * 1000; // Convert to milliseconds
    } catch {
      return null;
    }
  }

  /**
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    const expiration = this.getTokenExpiration();
    if (!expiration) return true;

    // Add 30 second buffer
    return Date.now() >= expiration - 30000;
  }

  /**
   * Check if refresh token is expired
   */
  isRefreshTokenExpired(): boolean {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return true;

    const expiration = this.getTokenExpiration(refreshToken);
    if (!expiration) return true;

    return Date.now() >= expiration;
  }
}

// Export singleton instance
export const tokenStorage = new TokenStorage();

// Export class for testing
export { TokenStorage };