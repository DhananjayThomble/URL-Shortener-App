import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { authAPI, apiClient } from '@/lib/api';
import { tokenStorage } from '@/lib/auth/tokenStorage';
import { setupInterceptors } from '@/lib/api/interceptors';
import { securityManager } from '@/lib/auth/security';
import { sessionManager } from '@/lib/auth/sessionManager';
import type { AuthState, AuthActions, LoginCredentials, RegisterData, User } from '@/types';

interface AuthStore extends AuthState, AuthActions {
  initialize: () => void;
  checkAndRefreshToken: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      user: null,
      tokens: null,
      isLoading: false,
      isAuthenticated: false,

      // Actions
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true });
        
        try {
          // Check for suspicious activity before attempting login
          const suspiciousActivity = securityManager.checkSuspiciousActivity(credentials.email);
          if (suspiciousActivity.isSuspicious) {
            securityManager.logSecurityEvent({
              type: 'suspicious_activity',
              details: { 
                email: credentials.email, 
                reason: suspiciousActivity.reason,
                lockoutUntil: suspiciousActivity.lockoutUntil 
              },
            });
            
            const error = new Error(suspiciousActivity.reason || 'Account temporarily locked');
            set({ isLoading: false });
            throw error;
          }

          const response = await authAPI.login(credentials);
          
          // Store tokens and user data
          tokenStorage.setTokens(response.tokens);
          tokenStorage.setUser(response.user);
          
          // Update API client with access token
          apiClient.setAccessToken(response.tokens.accessToken);
          
          // Log successful login
          securityManager.logSecurityEvent({
            type: 'login',
            details: { 
              email: credentials.email,
              deviceInfo: securityManager.getDeviceInfo()
            },
          });

          // Start session monitoring
          sessionManager.startMonitoring();
          
          // Update store state
          set({
            user: response.user,
            tokens: response.tokens,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          // Log failed login attempt
          securityManager.logSecurityEvent({
            type: 'failed_login',
            details: { 
              email: credentials.email,
              error: error instanceof Error ? error.message : 'Unknown error'
            },
          });
          
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true });
        
        try {
          const response = await authAPI.register(data);
          
          // Debug logging (remove in production)
          if (process.env.NODE_ENV === 'development') {
            console.log('Auth store - registration response:', response);
          }
          
          // Validate response structure
          if (!response || !response.tokens || !response.user) {
            throw new Error('Invalid response structure from server');
          }
          
          if (!response.tokens.accessToken) {
            throw new Error('Access token missing from server response');
          }
          
          // Store tokens and user data
          tokenStorage.setTokens(response.tokens);
          tokenStorage.setUser(response.user);
          
          // Update API client with access token
          apiClient.setAccessToken(response.tokens.accessToken);
          
          // Update store state
          set({
            user: response.user,
            tokens: response.tokens,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          console.error('Registration error:', error);
          set({ isLoading: false });
          throw error;
        }
      },

      logout: () => {
        const { tokens, user } = get();
        
        // Log logout event
        if (user) {
          securityManager.logSecurityEvent({
            type: 'logout',
            details: { 
              email: user.email,
              deviceInfo: securityManager.getDeviceInfo()
            },
          });
        }

        // Stop session monitoring
        sessionManager.stopMonitoring();
        
        // Call logout API if we have a refresh token
        if (tokens?.refreshToken) {
          authAPI.logout(tokens.refreshToken).catch(console.error);
        }
        
        // Clear all stored data
        tokenStorage.clearAll();
        apiClient.setAccessToken(null);
        
        // Reset store state
        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      refreshToken: async () => {
        const refreshToken = tokenStorage.getRefreshToken();
        
        if (!refreshToken) {
          get().logout();
          throw new Error('No refresh token available');
        }

        try {
          const response = await authAPI.refreshToken(refreshToken);
          
          // Update tokens
          const newTokens = {
            accessToken: response.tokens.accessToken,
            refreshToken: response.tokens.refreshToken,
            expiresIn: response.tokens.expiresIn,
          };
          
          tokenStorage.setTokens(newTokens);
          apiClient.setAccessToken(newTokens.accessToken);

          // Log token refresh
          const { user } = get();
          if (user) {
            securityManager.logSecurityEvent({
              type: 'token_refresh',
              details: { 
                email: user.email,
                deviceInfo: securityManager.getDeviceInfo()
              },
            });
          }
          
          // Update store state
          set({ tokens: newTokens });
          
          return newTokens;
        } catch (error) {
          // If refresh fails, logout user
          get().logout();
          throw error;
        }
      },

      updateUser: (userData: Partial<User>) => {
        const { user } = get();
        if (!user) return;

        const updatedUser = { ...user, ...userData };
        tokenStorage.setUser(updatedUser);
        
        set({ user: updatedUser });
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      // Initialize auth state from storage
      initialize: () => {
        const { user, hasRefreshToken } = tokenStorage.initialize();
        
        if (user && hasRefreshToken) {
          set({
            user,
            isAuthenticated: true,
          });

          // Start session monitoring for existing session
          sessionManager.startMonitoring();

          // Try to refresh token on initialization
          if (!tokenStorage.isRefreshTokenExpired()) {
            get().refreshToken().catch(() => {
              // If refresh fails on init, just clear state
              get().logout();
            });
          } else {
            // Refresh token is expired, logout
            get().logout();
          }
        }
      },

      // Check and refresh token if needed
      checkAndRefreshToken: async () => {
        const { isAuthenticated } = get();
        
        if (!isAuthenticated) return false;

        // Check if access token is expired
        if (tokenStorage.isAccessTokenExpired()) {
          try {
            await get().refreshToken();
            return true;
          } catch {
            return false;
          }
        }

        return true;
      },
    }),
    {
      name: 'auth-store',
      // Only persist non-sensitive data in devtools
      partialize: (state: AuthStore) => ({
        isAuthenticated: state.isAuthenticated,
        isLoading: state.isLoading,
        user: state.user ? { id: state.user.id, email: state.user.email, name: state.user.name } : null,
      }),
    }
  )
);

// Setup API interceptors with auth callbacks
setupInterceptors({
  getRefreshToken: () => tokenStorage.getRefreshToken(),
  refreshTokens: async () => {
    const tokens = await useAuthStore.getState().refreshToken();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  },
  logout: () => useAuthStore.getState().logout(),
});

// Initialize auth store on module load
if (typeof window !== 'undefined') {
  useAuthStore.getState().initialize();
}