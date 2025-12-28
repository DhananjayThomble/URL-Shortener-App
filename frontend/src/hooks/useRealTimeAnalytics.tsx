import { useState, useEffect, useCallback, useRef } from 'react';
import { analyticsService } from '@/services/analytics.service';
import { RealTimeUpdate, RealTimeAnalytics } from '@/services/api/dto';
import { useAuth } from './useAuth';

export interface UseRealTimeAnalyticsOptions {
  urlId?: string;
  enabled?: boolean;
  onUpdate?: (update: RealTimeUpdate) => void;
}

export const useRealTimeAnalytics = (options: UseRealTimeAnalyticsOptions = {}) => {
  const { urlId, enabled = true, onUpdate } = options;
  const { user } = useAuth();
  const [realTimeData, setRealTimeData] = useState<RealTimeAnalytics | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const handleRealTimeUpdate = useCallback((update: RealTimeUpdate) => {
    // Update real-time data based on the update
    setRealTimeData(prev => {
      if (!prev) return prev;

      const newData = { ...prev };
      
      if (update.type === 'click') {
        newData.activeVisitors = Math.max(0, newData.activeVisitors);
        newData.recentClicks = [
          {
            timestamp: update.data.timestamp,
            country: update.data.country,
            device: update.data.device,
            referrer: update.data.referrer,
          },
          ...newData.recentClicks.slice(0, 9) // Keep only last 10 clicks
        ];
      } else if (update.type === 'visitor') {
        newData.activeVisitors += 1;
      }

      return newData;
    });

    // Call external update handler if provided
    if (onUpdate) {
      onUpdate(update);
    }
  }, [onUpdate]);

  const connect = useCallback(async () => {
    if (!user || !enabled) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch initial real-time data
      const initialData = await analyticsService.getRealTimeAnalytics('dashboard');

      if (initialData) {
        setRealTimeData(initialData);
      }

      // Subscribe to real-time updates (temporarily disabled until WebSocket is implemented)
      // const unsubscribe = urlId
      //   ? analyticsService.subscribeToRealTime(urlId, handleRealTimeUpdate)
      //   : analyticsService.subscribeToDashboardRealTime(handleRealTimeUpdate);

      // unsubscribeRef.current = unsubscribe;
      setIsConnected(true); // Simulate connection for now
    } catch (error) {
      console.error('Error connecting to real-time analytics:', error);
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  }, [user, enabled, urlId, handleRealTimeUpdate]);

  const disconnect = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  return {
    realTimeData,
    isConnected,
    loading,
    connect,
    disconnect,
    reconnect,
  };
};

// Hook for managing real-time analytics notifications
export interface AnalyticsNotification {
  id: string;
  type: 'milestone' | 'spike' | 'achievement';
  title: string;
  message: string;
  timestamp: string;
  data?: any;
}

export const useAnalyticsNotifications = () => {
  const [notifications, setNotifications] = useState<AnalyticsNotification[]>([]);

  const addNotification = useCallback((notification: Omit<AnalyticsNotification, 'id' | 'timestamp'>) => {
    const newNotification: AnalyticsNotification = {
      ...notification,
      id: `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    setNotifications(prev => [newNotification, ...prev.slice(0, 9)]); // Keep only last 10 notifications
  }, []);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    addNotification,
    removeNotification,
    clearNotifications,
  };
};

// Hook for real-time analytics with automatic milestone detection
export const useRealTimeAnalyticsWithNotifications = (options: UseRealTimeAnalyticsOptions = {}) => {
  const { addNotification } = useAnalyticsNotifications();
  const previousClickCount = useRef<number>(0);

  const handleUpdateWithNotifications = useCallback((update: RealTimeUpdate) => {
    // Handle milestone notifications
    if (update.type === 'click') {
      const currentCount = previousClickCount.current + 1;
      previousClickCount.current = currentCount;

      // Check for milestones
      const milestones = [10, 50, 100, 500, 1000, 5000, 10000];
      if (milestones.includes(currentCount)) {
        addNotification({
          type: 'milestone',
          title: 'Milestone Reached!',
          message: `Your link has reached ${currentCount.toLocaleString()} clicks!`,
          data: { clicks: currentCount, urlId: update.data.urlId }
        });
      }

      // Detect traffic spikes (simplified logic)
      // In a real implementation, you'd compare against historical averages
      if (currentCount > 0 && currentCount % 20 === 0) {
        addNotification({
          type: 'spike',
          title: 'Traffic Spike Detected',
          message: `Increased activity detected on your link`,
          data: { urlId: update.data.urlId }
        });
      }
    }

    // Call original handler if provided
    if (options.onUpdate) {
      options.onUpdate(update);
    }
  }, [addNotification, options.onUpdate]);

  return useRealTimeAnalytics({
    ...options,
    onUpdate: handleUpdateWithNotifications,
  });
};