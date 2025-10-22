import { tokenStorage } from './tokenStorage';
import { isSessionExpiringSoon, formatTimeUntilExpiration } from './utils';

export interface SessionInfo {
  isActive: boolean;
  expiresAt: number | null;
  timeUntilExpiration: string;
  isExpiringSoon: boolean;
  warningThreshold: number;
}

export class SessionManager {
  private warningCallbacks: Array<(timeLeft: number) => void> = [];
  private expirationCallbacks: Array<() => void> = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly WARNING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Start monitoring session expiration
   */
  startMonitoring(): void {
    if (this.checkInterval) {
      this.stopMonitoring();
    }

    this.checkInterval = setInterval(() => {
      this.checkSession();
    }, this.CHECK_INTERVAL_MS);

    // Initial check
    this.checkSession();
  }

  /**
   * Stop monitoring session expiration
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get current session information
   */
  getSessionInfo(): SessionInfo {
    const accessToken = tokenStorage.getAccessToken();
    const expiresAt = tokenStorage.getTokenExpiration(accessToken || undefined);
    
    if (!expiresAt) {
      return {
        isActive: false,
        expiresAt: null,
        timeUntilExpiration: 'Unknown',
        isExpiringSoon: false,
        warningThreshold: this.WARNING_THRESHOLD_MS,
      };
    }

    const timeLeft = expiresAt - Date.now();
    const isExpiringSoon = isSessionExpiringSoon(expiresAt, 5);

    return {
      isActive: timeLeft > 0,
      expiresAt,
      timeUntilExpiration: formatTimeUntilExpiration(expiresAt),
      isExpiringSoon,
      warningThreshold: this.WARNING_THRESHOLD_MS,
    };
  }

  /**
   * Add callback for session expiration warnings
   */
  onSessionWarning(callback: (timeLeft: number) => void): () => void {
    this.warningCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.warningCallbacks.indexOf(callback);
      if (index > -1) {
        this.warningCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Add callback for session expiration
   */
  onSessionExpired(callback: () => void): () => void {
    this.expirationCallbacks.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.expirationCallbacks.indexOf(callback);
      if (index > -1) {
        this.expirationCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Extend session by refreshing token
   */
  async extendSession(): Promise<boolean> {
    try {
      // This would typically call the auth store's refresh method
      // For now, we'll just check if refresh is possible
      const refreshToken = tokenStorage.getRefreshToken();
      return !!refreshToken && !tokenStorage.isRefreshTokenExpired();
    } catch {
      return false;
    }
  }

  /**
   * Check session status and trigger callbacks
   */
  private checkSession(): void {
    const sessionInfo = this.getSessionInfo();

    if (!sessionInfo.isActive) {
      // Session has expired
      this.expirationCallbacks.forEach(callback => callback());
      this.stopMonitoring();
      return;
    }

    if (sessionInfo.isExpiringSoon && sessionInfo.expiresAt) {
      // Session is expiring soon
      const timeLeft = sessionInfo.expiresAt - Date.now();
      this.warningCallbacks.forEach(callback => callback(timeLeft));
    }
  }

  /**
   * Get time until next session check
   */
  getNextCheckTime(): number {
    return this.CHECK_INTERVAL_MS;
  }

  /**
   * Force a session check
   */
  forceCheck(): SessionInfo {
    this.checkSession();
    return this.getSessionInfo();
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();

// Auto-start monitoring in browser environment
if (typeof window !== 'undefined') {
  // Start monitoring when user is authenticated
  const startMonitoringIfAuthenticated = () => {
    if (tokenStorage.isAuthenticated()) {
      sessionManager.startMonitoring();
    }
  };

  // Check on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoringIfAuthenticated);
  } else {
    startMonitoringIfAuthenticated();
  }

  // Stop monitoring when page is hidden/unloaded
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      sessionManager.stopMonitoring();
    } else if (tokenStorage.isAuthenticated()) {
      sessionManager.startMonitoring();
    }
  });

  window.addEventListener('beforeunload', () => {
    sessionManager.stopMonitoring();
  });
}