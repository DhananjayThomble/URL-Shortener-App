'use client';

import { useEffect, useState, useCallback } from 'react';
import { sessionManager, type SessionInfo } from '@/lib/auth/sessionManager';
import { useAuthStore } from '@/stores/authStore';

export interface UseSessionReturn {
  sessionInfo: SessionInfo;
  extendSession: () => Promise<boolean>;
  isSessionWarning: boolean;
  timeUntilExpiration: string;
  refreshSession: () => void;
}

export function useSession(): UseSessionReturn {
  const { isAuthenticated, refreshToken } = useAuthStore();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>(() => 
    sessionManager.getSessionInfo()
  );
  const [isSessionWarning, setIsSessionWarning] = useState(false);

  // Update session info periodically
  const updateSessionInfo = useCallback(() => {
    const info = sessionManager.getSessionInfo();
    setSessionInfo(info);
    setIsSessionWarning(info.isExpiringSoon);
  }, []);

  // Extend session by refreshing tokens
  const extendSession = useCallback(async (): Promise<boolean> => {
    try {
      await refreshToken();
      updateSessionInfo();
      return true;
    } catch (error) {
      console.error('Failed to extend session:', error);
      return false;
    }
  }, [refreshToken, updateSessionInfo]);

  // Force refresh session info
  const refreshSession = useCallback(() => {
    updateSessionInfo();
  }, [updateSessionInfo]);

  useEffect(() => {
    if (!isAuthenticated) {
      sessionManager.stopMonitoring();
      setSessionInfo({
        isActive: false,
        expiresAt: null,
        timeUntilExpiration: 'Not authenticated',
        isExpiringSoon: false,
        warningThreshold: 0,
      });
      setIsSessionWarning(false);
      return;
    }

    // Start monitoring when authenticated
    sessionManager.startMonitoring();

    // Set up session warning callback
    const unsubscribeWarning = sessionManager.onSessionWarning((timeLeft) => {
      setIsSessionWarning(true);
      updateSessionInfo();
    });

    // Set up session expiration callback
    const unsubscribeExpiration = sessionManager.onSessionExpired(() => {
      setIsSessionWarning(false);
      updateSessionInfo();
    });

    // Update session info immediately
    updateSessionInfo();

    // Set up periodic updates
    const interval = setInterval(updateSessionInfo, 30000); // Every 30 seconds

    return () => {
      clearInterval(interval);
      unsubscribeWarning();
      unsubscribeExpiration();
      sessionManager.stopMonitoring();
    };
  }, [isAuthenticated, updateSessionInfo]);

  return {
    sessionInfo,
    extendSession,
    isSessionWarning,
    timeUntilExpiration: sessionInfo.timeUntilExpiration,
    refreshSession,
  };
}

export default useSession;