'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { urlAPI } from '@/lib/api';
import type { AnalyticsData } from '@/types/analytics';

interface UseRealTimeAnalyticsOptions {
  urlId?: string;
  enabled?: boolean;
  pollingInterval?: number;
  onUpdate?: (data: AnalyticsData) => void;
  onMilestone?: (milestone: MilestoneEvent) => void;
}

interface MilestoneEvent {
  type: 'clicks' | 'unique_visitors' | 'countries' | 'devices';
  milestone: number;
  current: number;
  message: string;
}

interface RealTimeUpdate {
  timestamp: string;
  urlId: string;
  newClicks: number;
  totalClicks: number;
  uniqueClicks: number;
  recentCountries: string[];
  recentDevices: string[];
}

export function useRealTimeAnalytics({
  urlId,
  enabled = true,
  pollingInterval = 30000, // 30 seconds
  onUpdate,
  onMilestone,
}: UseRealTimeAnalyticsOptions = {}) {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(enabled);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const previousDataRef = useRef<AnalyticsData | null>(null);
  const milestoneCheckRef = useRef<Set<string>>(new Set());

  // Fetch analytics data with polling
  const {
    data: analyticsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['analytics', urlId, 'realtime'],
    queryFn: () => {
      if (!urlId) throw new Error('URL ID is required');
      return urlAPI.getUrlAnalytics(urlId);
    },
    enabled: enabled && !!urlId && isLive,
    refetchInterval: isLive ? pollingInterval : false,
    refetchIntervalInBackground: true,
    staleTime: 0, // Always consider data stale for real-time updates
  });

  // Check for milestones
  const checkMilestones = useCallback((current: AnalyticsData, previous: AnalyticsData | null) => {
    if (!previous || !onMilestone) return;

    const milestones = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    
    // Check click milestones
    milestones.forEach(milestone => {
      const milestoneKey = `clicks-${milestone}`;
      if (
        current.totalClicks >= milestone &&
        previous.totalClicks < milestone &&
        !milestoneCheckRef.current.has(milestoneKey)
      ) {
        milestoneCheckRef.current.add(milestoneKey);
        onMilestone({
          type: 'clicks',
          milestone,
          current: current.totalClicks,
          message: `🎉 Congratulations! Your link has reached ${milestone.toLocaleString()} clicks!`,
        });
      }
    });

    // Check unique visitor milestones
    milestones.forEach(milestone => {
      const milestoneKey = `unique-${milestone}`;
      if (
        current.uniqueClicks >= milestone &&
        previous.uniqueClicks < milestone &&
        !milestoneCheckRef.current.has(milestoneKey)
      ) {
        milestoneCheckRef.current.add(milestoneKey);
        onMilestone({
          type: 'unique_visitors',
          milestone,
          current: current.uniqueClicks,
          message: `🌟 Amazing! You've reached ${milestone.toLocaleString()} unique visitors!`,
        });
      }
    });

    // Check country milestones
    const countryMilestones = [5, 10, 25, 50, 100];
    countryMilestones.forEach(milestone => {
      const milestoneKey = `countries-${milestone}`;
      if (
        current.topCountries.length >= milestone &&
        previous.topCountries.length < milestone &&
        !milestoneCheckRef.current.has(milestoneKey)
      ) {
        milestoneCheckRef.current.add(milestoneKey);
        onMilestone({
          type: 'countries',
          milestone,
          current: current.topCountries.length,
          message: `🌍 Your link is now popular in ${milestone} countries!`,
        });
      }
    });
  }, [onMilestone]);

  // Handle data updates
  useEffect(() => {
    if (analyticsData) {
      const now = new Date();
      setLastUpdate(now);
      setUpdateCount(prev => prev + 1);

      // Check for milestones
      checkMilestones(analyticsData, previousDataRef.current);

      // Call update callback
      if (onUpdate) {
        onUpdate(analyticsData);
      }

      // Update previous data reference
      previousDataRef.current = analyticsData;
    }
  }, [analyticsData, onUpdate, checkMilestones]);

  // Manual refresh
  const refresh = useCallback(async () => {
    try {
      await refetch();
    } catch (error) {
      console.error('Failed to refresh analytics:', error);
    }
  }, [refetch]);

  // Toggle live updates
  const toggleLive = useCallback(() => {
    setIsLive(prev => !prev);
  }, []);

  // Start live updates
  const startLive = useCallback(() => {
    setIsLive(true);
  }, []);

  // Stop live updates
  const stopLive = useCallback(() => {
    setIsLive(false);
  }, []);

  // Get update frequency info
  const getUpdateInfo = useCallback(() => {
    return {
      isLive,
      lastUpdate,
      updateCount,
      pollingInterval,
      nextUpdate: isLive && lastUpdate 
        ? new Date(lastUpdate.getTime() + pollingInterval)
        : null,
    };
  }, [isLive, lastUpdate, updateCount, pollingInterval]);

  // Calculate real-time metrics
  const realtimeMetrics = analyticsData ? {
    totalClicks: analyticsData.totalClicks,
    uniqueClicks: analyticsData.uniqueClicks,
    clickRate: analyticsData.totalClicks > 0 
      ? (analyticsData.uniqueClicks / analyticsData.totalClicks) * 100 
      : 0,
    topCountry: analyticsData.topCountries[0]?.country || 'N/A',
    topDevice: analyticsData.topDevices[0]?.device || 'N/A',
    recentActivity: analyticsData.clicksByDate.slice(-7), // Last 7 days
  } : null;

  return {
    // Data
    data: analyticsData,
    metrics: realtimeMetrics,
    
    // State
    isLoading,
    error,
    isLive,
    lastUpdate,
    updateCount,
    
    // Actions
    refresh,
    toggleLive,
    startLive,
    stopLive,
    
    // Utils
    getUpdateInfo,
  };
}

// Hook for WebSocket-based real-time updates (future enhancement)
export function useWebSocketAnalytics(urlId?: string) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [updates, setUpdates] = useState<RealTimeUpdate[]>([]);

  useEffect(() => {
    if (!urlId) return;

    // This would connect to a WebSocket endpoint for real-time updates
    // For now, this is a placeholder for future implementation
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL}/analytics/${urlId}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        setIsConnected(true);
        console.log('WebSocket connected for analytics');
      };
      
      ws.onmessage = (event) => {
        try {
          const update: RealTimeUpdate = JSON.parse(event.data);
          setUpdates(prev => [...prev.slice(-99), update]); // Keep last 100 updates
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        console.log('WebSocket disconnected');
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
      
      setSocket(ws);
      
      return () => {
        ws.close();
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }, [urlId]);

  const sendMessage = useCallback((message: any) => {
    if (socket && isConnected) {
      socket.send(JSON.stringify(message));
    }
  }, [socket, isConnected]);

  return {
    isConnected,
    updates,
    sendMessage,
  };
}

// Hook for analytics notifications
export function useAnalyticsNotifications() {
  const [notifications, setNotifications] = useState<MilestoneEvent[]>([]);

  const addNotification = useCallback((notification: MilestoneEvent) => {
    setNotifications(prev => [...prev, notification]);
    
    // Auto-remove notification after 10 seconds
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n !== notification));
    }, 10000);
  }, []);

  const removeNotification = useCallback((notification: MilestoneEvent) => {
    setNotifications(prev => prev.filter(n => n !== notification));
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
}