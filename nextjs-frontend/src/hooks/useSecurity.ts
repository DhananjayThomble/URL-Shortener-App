'use client';

import { useCallback, useEffect, useState } from 'react';
import { securityManager, type SecurityEvent, type DeviceInfo } from '@/lib/auth/security';

export interface UseSecurityReturn {
  deviceInfo: DeviceInfo;
  securityEvents: SecurityEvent[];
  logSecurityEvent: (event: Omit<SecurityEvent, 'timestamp' | 'userAgent'>) => void;
  checkSuspiciousActivity: (email: string) => {
    isSuspicious: boolean;
    reason?: string;
    lockoutUntil?: number;
  };
  isAccountLocked: (email: string) => boolean;
  getLockoutTimeRemaining: (email: string) => number;
  getFailedLoginCount: (email: string) => number;
  validatePasswordStrength: (password: string) => {
    score: number;
    feedback: string[];
    isStrong: boolean;
  };
  clearSecurityEvents: () => void;
}

export function useSecurity(): UseSecurityReturn {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => {
    if (typeof window !== 'undefined') {
      return securityManager.getDeviceInfo();
    }
    return {
      id: 'server',
      name: 'Server',
      type: 'desktop',
      browser: 'Unknown',
      os: 'Unknown',
      lastSeen: Date.now(),
      isCurrent: true,
    };
  });

  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);

  // Load security events on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDeviceInfo(securityManager.getDeviceInfo());
      setSecurityEvents(securityManager.getSecurityEvents());
    }
  }, []);

  // Log security event
  const logSecurityEvent = useCallback((event: Omit<SecurityEvent, 'timestamp' | 'userAgent'>) => {
    securityManager.logSecurityEvent(event);
    setSecurityEvents(securityManager.getSecurityEvents());
  }, []);

  // Check for suspicious activity
  const checkSuspiciousActivity = useCallback((email: string) => {
    return securityManager.checkSuspiciousActivity(email);
  }, []);

  // Check if account is locked
  const isAccountLocked = useCallback((email: string) => {
    return securityManager.isAccountLocked(email);
  }, []);

  // Get lockout time remaining
  const getLockoutTimeRemaining = useCallback((email: string) => {
    return securityManager.getLockoutTimeRemaining(email);
  }, []);

  // Get failed login count
  const getFailedLoginCount = useCallback((email: string) => {
    return securityManager.getFailedLoginCount(email);
  }, []);

  // Validate password strength
  const validatePasswordStrength = useCallback((password: string) => {
    return securityManager.validatePasswordStrength(password);
  }, []);

  // Clear security events
  const clearSecurityEvents = useCallback(() => {
    securityManager.clearSecurityEvents();
    setSecurityEvents([]);
  }, []);

  return {
    deviceInfo,
    securityEvents,
    logSecurityEvent,
    checkSuspiciousActivity,
    isAccountLocked,
    getLockoutTimeRemaining,
    getFailedLoginCount,
    validatePasswordStrength,
    clearSecurityEvents,
  };
}

export default useSecurity;