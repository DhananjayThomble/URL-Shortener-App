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
} from './api/dto';
import { APIResponse } from './api/types';

export class AnalyticsService {
  private readonly baseEndpoint = '/analytics';
  private pollingIntervals: Map<string, number> = new Map();
  private pollingIntervalMs = 15000;

  /**
   * Get analytics data for a specific URL
   */
  async getURLAnalytics(linkId: string, params: AnalyticsParams = {}): Promise<AnalyticsData | null> {
    try {
      const queryParams = new URLSearchParams();
      
      if (params.limit) queryParams.append('limit', params.limit.toString());
      if (params.offset) queryParams.append('offset', params.offset.toString());
      queryParams.append('linkId', linkId);

      const queryString = queryParams.toString();
      const endpoint = queryString 
        ? `${this.baseEndpoint}/link/${linkId}/stats?${queryString}` 
        : `${this.baseEndpoint}/link/${linkId}/stats`;
      
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
  async getRealTimeAnalytics(linkId?: string): Promise<RealTimeAnalytics | null> {
    try {
      const queryParams = new URLSearchParams();
      if (linkId) queryParams.append('linkId', linkId);

      const queryString = queryParams.toString();
      const endpoint = queryString 
        ? `${this.baseEndpoint}/real-time?${queryString}`
        : `${this.baseEndpoint}/real-time`;

      const response = await apiClient.get<RealTimeAnalytics>(endpoint);
      
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
   * Subscribe to real-time analytics updates via polling
   */
  subscribeToRealTime(linkId: string | null, callback: (data: RealTimeAnalytics) => void): () => void {
    const pollKey = `realtime-${linkId ?? 'dashboard'}`;

    this.unsubscribeFromRealTime(pollKey);

    const poll = async () => {
      const data = await this.getRealTimeAnalytics(linkId ?? undefined);
      if (data) {
        callback(data);
      }
    };

    poll();
    const intervalId = window.setInterval(poll, this.pollingIntervalMs);
    this.pollingIntervals.set(pollKey, intervalId);

    return () => this.unsubscribeFromRealTime(pollKey);
  }

  /**
   * Unsubscribe from real-time updates
   */
  private unsubscribeFromRealTime(pollKey: string): void {
    const intervalId = this.pollingIntervals.get(pollKey);
    if (intervalId) {
      window.clearInterval(intervalId);
      this.pollingIntervals.delete(pollKey);
    }
  }

  /**
   * Subscribe to dashboard real-time updates
   */
  subscribeToDashboardRealTime(callback: (data: RealTimeAnalytics) => void): () => void {
    return this.subscribeToRealTime(null, callback);
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
   * Clean up all polling intervals
   */
  cleanup(): void {
    this.pollingIntervals.forEach((intervalId) => {
      window.clearInterval(intervalId);
    });
    this.pollingIntervals.clear();
  }
}

// Create and export a singleton instance
export const analyticsService = new AnalyticsService();
