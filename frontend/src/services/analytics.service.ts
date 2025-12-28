/**
 * Analytics Service
 * Handles all analytics-related operations with the NestJS backend
 */

import { apiClient } from './api/client';
import { 
  AnalyticsParams,
  DashboardAnalyticsParams,
  AnalyticsData,
  DashboardAnalytics,
  RealTimeAnalytics,
  RealTimeUpdate
} from './api/dto';
import { APIResponse } from './api/types';

export class AnalyticsService {
  private readonly baseEndpoint = '/analytics';
  private wsConnections: Map<string, WebSocket> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();
  private maxReconnectAttempts = 5;
  private baseReconnectDelay = 1000; // 1 second

  /**
   * Get analytics data for a specific URL
   */
  async getURLAnalytics(urlId: string, params: AnalyticsParams = {}): Promise<AnalyticsData | null> {
    try {
      const queryParams = new URLSearchParams();
      
      if (params.startDate) queryParams.append('startDate', params.startDate);
      if (params.endDate) queryParams.append('endDate', params.endDate);
      if (params.granularity) queryParams.append('granularity', params.granularity);

      const queryString = queryParams.toString();
      const endpoint = queryString 
        ? `${this.baseEndpoint}/urls/${urlId}?${queryString}` 
        : `${this.baseEndpoint}/urls/${urlId}`;
      
      const response = await apiClient.get<AnalyticsData>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.error('Failed to fetch URL analytics:', response.error);
        return null;
      }
    } catch (error) {
      console.error('Error fetching URL analytics:', error);
      return null;
    }
  }

  /**
   * Get dashboard analytics summary
   */
  async getDashboardAnalytics(params: DashboardAnalyticsParams = {}): Promise<DashboardAnalytics | null> {
    try {
      const queryParams = new URLSearchParams();
      
      // Only add parameters that the backend expects
      if (params.startDate) queryParams.append('startDate', params.startDate);
      if (params.endDate) queryParams.append('endDate', params.endDate);

      const queryString = queryParams.toString();
      const endpoint = queryString 
        ? `${this.baseEndpoint}/summary?${queryString}` 
        : `${this.baseEndpoint}/summary`;
      
      const response = await apiClient.get<DashboardAnalytics>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.warn('Analytics service unavailable, using fallback data:', response.error);
        // Return fallback data structure
        return this.getFallbackDashboardData();
      }
    } catch (error) {
      console.warn('Analytics service error, using fallback data:', error);
      return this.getFallbackDashboardData();
    }
  }

  /**
   * Get real-time analytics for a URL
   */
  async getRealTimeAnalytics(urlId: string): Promise<RealTimeAnalytics | null> {
    try {
      const response = await apiClient.get<RealTimeAnalytics>(`${this.baseEndpoint}/real-time`);
      
      if (response.success && response.data) {
        return response.data;
      } else {
        console.warn('Real-time analytics service unavailable, using fallback data:', response.error);
        return this.getFallbackRealTimeData();
      }
    } catch (error) {
      console.warn('Real-time analytics error, using fallback data:', error);
      return this.getFallbackRealTimeData();
    }
  }

  /**
   * Provide fallback dashboard data when analytics service is unavailable
   */
  private getFallbackDashboardData(): DashboardAnalytics {
    return {
      summary: {
        totalClicks: 0,
        uniqueVisitors: 0,
        averageClicksPerDay: 0,
        conversionRate: 0
      },
      topUrls: [],
      recentClicks: []
    };
  }

  /**
   * Provide fallback real-time data when analytics service is unavailable
   */
  private getFallbackRealTimeData(): RealTimeAnalytics {
    return {
      activeVisitors: 0,
      recentClicks: [],
      liveStats: {
        clicksLastHour: 0,
        clicksLastMinute: 0,
        peakHour: '00:00'
      }
    };
  }

  /**
   * Subscribe to real-time analytics updates via WebSocket
   */
  subscribeToRealTime(urlId: string, callback: (data: RealTimeUpdate) => void): () => void {
    const wsKey = `realtime-${urlId}`;
    
    // Close existing connection if any
    this.unsubscribeFromRealTime(wsKey);

    try {
      const baseURL = apiClient.getBaseURL();
      const wsURL = baseURL.replace(/^http/, 'ws') + `/analytics/ws/${urlId}`;
      
      const ws = new WebSocket(wsURL);
      this.wsConnections.set(wsKey, ws);
      this.reconnectAttempts.set(wsKey, 0);

      ws.onopen = () => {
        console.log(`WebSocket connected for URL ${urlId}`);
        this.reconnectAttempts.set(wsKey, 0);
      };

      ws.onmessage = (event) => {
        try {
          const data: RealTimeUpdate = JSON.parse(event.data);
          callback(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log(`WebSocket closed for URL ${urlId}:`, event.code, event.reason);
        this.wsConnections.delete(wsKey);
        
        // Attempt reconnection if not manually closed
        if (event.code !== 1000) {
          this.handleReconnection(wsKey, urlId, callback);
        }
      };

      ws.onerror = (error) => {
        console.error(`WebSocket error for URL ${urlId}:`, error);
      };

      // Return unsubscribe function
      return () => this.unsubscribeFromRealTime(wsKey);
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      return () => {};
    }
  }

  /**
   * Handle WebSocket reconnection with exponential backoff
   */
  private handleReconnection(wsKey: string, urlId: string, callback: (data: RealTimeUpdate) => void): void {
    const attempts = this.reconnectAttempts.get(wsKey) || 0;
    
    if (attempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnection attempts reached for ${wsKey}`);
      return;
    }

    const delay = this.baseReconnectDelay * Math.pow(2, attempts);
    this.reconnectAttempts.set(wsKey, attempts + 1);

    console.log(`Attempting to reconnect ${wsKey} in ${delay}ms (attempt ${attempts + 1})`);
    
    setTimeout(() => {
      if (!this.wsConnections.has(wsKey)) {
        this.subscribeToRealTime(urlId, callback);
      }
    }, delay);
  }

  /**
   * Unsubscribe from real-time updates
   */
  private unsubscribeFromRealTime(wsKey: string): void {
    const ws = this.wsConnections.get(wsKey);
    if (ws) {
      ws.close(1000, 'Manual disconnect');
      this.wsConnections.delete(wsKey);
      this.reconnectAttempts.delete(wsKey);
    }
  }

  /**
   * Subscribe to dashboard real-time updates
   */
  subscribeToDashboardRealTime(callback: (data: RealTimeUpdate) => void): () => void {
    return this.subscribeToRealTime('dashboard', callback);
  }

  /**
   * Get analytics data formatted for chart components
   */
  async getFormattedChartData(urlId?: string, params: AnalyticsParams = {}): Promise<any | null> {
    try {
      const data = urlId 
        ? await this.getURLAnalytics(urlId, params)
        : await this.getDashboardAnalytics(params);

      if (!data) return null;

      // Format data for chart components
      return {
        clicksByDate: data.clicksByDate || [],
        deviceBreakdown: data.deviceBreakdown || { desktop: 0, mobile: 0, tablet: 0 },
        browserBreakdown: data.browserBreakdown || {},
        osBreakdown: data.osBreakdown || {},
        geographicData: data.geographicData || [],
        topReferrers: data.topReferrers || [],
        utmAnalytics: data.utmAnalytics || {
          source: {},
          medium: {},
          campaign: {},
          term: {},
          content: {}
        }
      };
    } catch (error) {
      console.error('Error formatting chart data:', error);
      return null;
    }
  }

  /**
   * Get analytics summary for dashboard stats cards
   */
  async getAnalyticsSummary(params: DashboardAnalyticsParams = {}): Promise<any | null> {
    try {
      const data = await this.getDashboardAnalytics(params);
      
      if (!data || !data.summary) return null;

      return {
        totalLinks: data.topUrls?.length || 0,
        totalClicks: data.summary.totalClicks,
        activeLinks: data.topUrls?.filter(url => url.clicks > 0).length || 0,
        avgClicksPerLink: data.summary.averageClicksPerDay,
        uniqueVisitors: data.summary.uniqueVisitors,
        conversionRate: data.summary.conversionRate
      };
    } catch (error) {
      console.error('Error fetching analytics summary:', error);
      return null;
    }
  }

  /**
   * Get daily clicks data for charts
   */
  async getDailyClicksData(params: AnalyticsParams = {}): Promise<any[] | null> {
    try {
      const data = await this.getDashboardAnalytics(params);
      
      if (!data || !data.recentClicks) return [];

      return data.recentClicks.map(item => ({
        date: item.date,
        clicks: item.clicks,
        uniqueVisitors: item.uniqueVisitors
      }));
    } catch (error) {
      console.error('Error fetching daily clicks data:', error);
      return null;
    }
  }

  /**
   * Get top performing URLs data for charts
   */
  async getTopURLsData(limit: number = 5): Promise<any[] | null> {
    try {
      const data = await this.getDashboardAnalytics({ limit });
      
      if (!data || !data.topUrls) return [];

      return data.topUrls.map(url => ({
        name: url.title || `snap.url/${url.shortCode}`,
        clicks: url.clicks,
        id: url.id,
        shortCode: url.shortCode
      }));
    } catch (error) {
      console.error('Error fetching top URLs data:', error);
      return null;
    }
  }

  /**
   * Clean up all WebSocket connections
   */
  cleanup(): void {
    this.wsConnections.forEach((ws, key) => {
      this.unsubscribeFromRealTime(key);
    });
    this.wsConnections.clear();
    this.reconnectAttempts.clear();
  }
}

// Create and export a singleton instance
export const analyticsService = new AnalyticsService();