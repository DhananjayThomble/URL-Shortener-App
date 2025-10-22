/**
 * Security utilities for authentication and session management
 */

export interface SecurityEvent {
  type: 'login' | 'logout' | 'token_refresh' | 'failed_login' | 'suspicious_activity';
  timestamp: number;
  userAgent: string;
  ip?: string;
  details?: Record<string, any>;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
  lastSeen: number;
  isCurrent: boolean;
}

class SecurityManager {
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly EVENTS_STORAGE_KEY = 'snapurl_security_events';
  private readonly DEVICE_ID_KEY = 'snapurl_device_id';

  /**
   * Generate or retrieve device ID
   */
  getDeviceId(): string {
    if (typeof window === 'undefined') return 'server';

    let deviceId = localStorage.getItem(this.DEVICE_ID_KEY);
    
    if (!deviceId) {
      deviceId = this.generateDeviceId();
      localStorage.setItem(this.DEVICE_ID_KEY, deviceId);
    }

    return deviceId;
  }

  /**
   * Generate unique device ID
   */
  private generateDeviceId(): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('Device fingerprint', 2, 2);
    }

    const fingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset(),
      canvas.toDataURL(),
    ].join('|');

    return this.hashString(fingerprint);
  }

  /**
   * Simple hash function for device fingerprinting
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get device information
   */
  getDeviceInfo(): DeviceInfo {
    const userAgent = navigator.userAgent;
    const deviceId = this.getDeviceId();

    return {
      id: deviceId,
      name: this.getDeviceName(userAgent),
      type: this.getDeviceType(userAgent),
      browser: this.getBrowserName(userAgent),
      os: this.getOperatingSystem(userAgent),
      lastSeen: Date.now(),
      isCurrent: true,
    };
  }

  /**
   * Extract device name from user agent
   */
  private getDeviceName(userAgent: string): string {
    if (/iPhone/.test(userAgent)) return 'iPhone';
    if (/iPad/.test(userAgent)) return 'iPad';
    if (/Android/.test(userAgent)) return 'Android Device';
    if (/Windows/.test(userAgent)) return 'Windows PC';
    if (/Macintosh/.test(userAgent)) return 'Mac';
    if (/Linux/.test(userAgent)) return 'Linux PC';
    return 'Unknown Device';
  }

  /**
   * Determine device type
   */
  private getDeviceType(userAgent: string): 'desktop' | 'mobile' | 'tablet' {
    if (/iPad/.test(userAgent)) return 'tablet';
    if (/iPhone|Android.*Mobile/.test(userAgent)) return 'mobile';
    return 'desktop';
  }

  /**
   * Extract browser name
   */
  private getBrowserName(userAgent: string): string {
    if (/Chrome/.test(userAgent)) return 'Chrome';
    if (/Firefox/.test(userAgent)) return 'Firefox';
    if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) return 'Safari';
    if (/Edge/.test(userAgent)) return 'Edge';
    if (/Opera/.test(userAgent)) return 'Opera';
    return 'Unknown Browser';
  }

  /**
   * Extract operating system
   */
  private getOperatingSystem(userAgent: string): string {
    if (/Windows NT 10/.test(userAgent)) return 'Windows 10';
    if (/Windows NT/.test(userAgent)) return 'Windows';
    if (/Mac OS X/.test(userAgent)) return 'macOS';
    if (/iPhone OS/.test(userAgent)) return 'iOS';
    if (/Android/.test(userAgent)) return 'Android';
    if (/Linux/.test(userAgent)) return 'Linux';
    return 'Unknown OS';
  }

  /**
   * Log security event
   */
  logSecurityEvent(event: Omit<SecurityEvent, 'timestamp' | 'userAgent'>): void {
    if (typeof window === 'undefined') return;

    const securityEvent: SecurityEvent = {
      ...event,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };

    const events = this.getSecurityEvents();
    events.push(securityEvent);

    // Keep only last 100 events
    const recentEvents = events.slice(-100);
    
    try {
      localStorage.setItem(this.EVENTS_STORAGE_KEY, JSON.stringify(recentEvents));
    } catch (error) {
      console.warn('Failed to store security event:', error);
    }
  }

  /**
   * Get stored security events
   */
  getSecurityEvents(): SecurityEvent[] {
    if (typeof window === 'undefined') return [];

    try {
      const events = localStorage.getItem(this.EVENTS_STORAGE_KEY);
      return events ? JSON.parse(events) : [];
    } catch {
      return [];
    }
  }

  /**
   * Check for suspicious login activity
   */
  checkSuspiciousActivity(email: string): {
    isSuspicious: boolean;
    reason?: string;
    lockoutUntil?: number;
  } {
    const events = this.getSecurityEvents();
    const now = Date.now();
    const recentFailures = events.filter(
      event =>
        event.type === 'failed_login' &&
        event.details?.email === email &&
        now - event.timestamp < this.LOCKOUT_DURATION
    );

    if (recentFailures.length >= this.MAX_FAILED_ATTEMPTS) {
      const oldestFailure = recentFailures[0];
      const lockoutUntil = oldestFailure.timestamp + this.LOCKOUT_DURATION;

      if (now < lockoutUntil) {
        return {
          isSuspicious: true,
          reason: 'Too many failed login attempts',
          lockoutUntil,
        };
      }
    }

    // Check for rapid login attempts from different devices
    const recentLogins = events.filter(
      event =>
        event.type === 'login' &&
        now - event.timestamp < 5 * 60 * 1000 // Last 5 minutes
    );

    if (recentLogins.length > 3) {
      return {
        isSuspicious: true,
        reason: 'Multiple rapid login attempts detected',
      };
    }

    return { isSuspicious: false };
  }

  /**
   * Clear security events (for privacy)
   */
  clearSecurityEvents(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.EVENTS_STORAGE_KEY);
    }
  }

  /**
   * Get failed login attempts count
   */
  getFailedLoginCount(email: string): number {
    const events = this.getSecurityEvents();
    const now = Date.now();
    
    return events.filter(
      event =>
        event.type === 'failed_login' &&
        event.details?.email === email &&
        now - event.timestamp < this.LOCKOUT_DURATION
    ).length;
  }

  /**
   * Check if account is locked
   */
  isAccountLocked(email: string): boolean {
    const suspiciousActivity = this.checkSuspiciousActivity(email);
    return suspiciousActivity.isSuspicious && !!suspiciousActivity.lockoutUntil;
  }

  /**
   * Get lockout time remaining
   */
  getLockoutTimeRemaining(email: string): number {
    const suspiciousActivity = this.checkSuspiciousActivity(email);
    
    if (suspiciousActivity.lockoutUntil) {
      return Math.max(0, suspiciousActivity.lockoutUntil - Date.now());
    }

    return 0;
  }

  /**
   * Validate password strength in real-time
   */
  validatePasswordStrength(password: string): {
    score: number;
    feedback: string[];
    isStrong: boolean;
  } {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 8) score += 1;
    else feedback.push('Use at least 8 characters');

    if (password.length >= 12) score += 1;

    // Character variety
    if (/[a-z]/.test(password)) score += 1;
    else feedback.push('Add lowercase letters');

    if (/[A-Z]/.test(password)) score += 1;
    else feedback.push('Add uppercase letters');

    if (/\d/.test(password)) score += 1;
    else feedback.push('Add numbers');

    if (/[^a-zA-Z\d]/.test(password)) score += 1;
    else feedback.push('Add special characters');

    // Penalty for common patterns
    if (/(.)\1{2,}/.test(password)) {
      score -= 1;
      feedback.push('Avoid repeated characters');
    }

    if (/123|abc|qwe/i.test(password)) {
      score -= 1;
      feedback.push('Avoid common sequences');
    }

    return {
      score: Math.max(0, score),
      feedback,
      isStrong: score >= 4,
    };
  }

  /**
   * Generate secure session token
   */
  generateSecureToken(length = 32): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
}

// Export singleton instance
export const securityManager = new SecurityManager();

// Export class for testing
export { SecurityManager };