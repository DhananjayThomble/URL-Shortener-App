import { useState, useEffect } from "react";
import { useAuth } from "./useAuth";
import { analyticsService } from "@/services/analytics.service";

export interface ClickData {
  id: string;
  link_id: string;
  clicked_at: string;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referrer: string | null;
}

export interface DailyClicks {
  date: string;
  clicks: number;
}

export interface Stats {
  totalLinks: number;
  totalClicks: number;
  activeLinks: number;
  avgClicksPerLink: number;
  uniqueVisitors?: number;
  conversionRate?: number;
  activeVisitors?: number;
}

export const useAnalytics = () => {
  const [stats, setStats] = useState<Stats>({
    totalLinks: 0,
    totalClicks: 0,
    activeLinks: 0,
    avgClicksPerLink: 0,
    uniqueVisitors: 0,
    conversionRate: 0,
    activeVisitors: 0,
  });
  const [dailyClicks, setDailyClicks] = useState<DailyClicks[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchAnalytics = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Fetch analytics summary
      const summary = await analyticsService.getAnalyticsSummary();
      if (summary) {
        setStats({
          totalLinks: summary.totalLinks,
          totalClicks: summary.totalClicks,
          activeLinks: summary.activeLinks,
          avgClicksPerLink: summary.avgClicksPerLink,
          uniqueVisitors: summary.uniqueVisitors,
          conversionRate: summary.conversionRate,
          activeVisitors: 0, // Will be updated by real-time data
        });
      }

      // Fetch daily clicks data for the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const dailyClicksData = await analyticsService.getDailyClicksData({
        startDate: sevenDaysAgo.toISOString(),
        endDate: new Date().toISOString(),
        granularity: 'day'
      });

      if (dailyClicksData) {
        setDailyClicks(dailyClicksData);
      }
    } catch (error) {
      console.error("Error fetching analytics:", error);
      // Set default values on error
      setStats({
        totalLinks: 0,
        totalClicks: 0,
        activeLinks: 0,
        avgClicksPerLink: 0,
        uniqueVisitors: 0,
        conversionRate: 0,
        activeVisitors: 0,
      });
      setDailyClicks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [user]);

  return {
    stats,
    dailyClicks,
    loading,
    refetch: fetchAnalytics,
  };
};
