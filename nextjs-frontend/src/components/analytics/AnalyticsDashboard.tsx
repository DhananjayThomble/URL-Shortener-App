'use client';

import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Skeleton,
  Alert,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Visibility,
  People,
  Language,
  DevicesOther,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { urlAPI } from '@/lib/api/urls';
import { ClickChart } from './ClickChart';
import { GeographicChart } from './GeographicChart';
import { DeviceChart } from './DeviceChart';
import { ReferrerChart } from './ReferrerChart';
import { MetricCard } from './MetricCard';
import { DateRangePicker } from './DateRangePicker';
import { ExportButton } from './ExportButton';
import type { AnalyticsData, AnalyticsFilters, DateRange } from '@/types/analytics';

interface AnalyticsDashboardProps {
  urlId?: string;
  dateRange?: DateRange;
  showComparison?: boolean;
  className?: string;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  urlId,
  dateRange,
  showComparison = false,
  className,
}) => {
  const [filters, setFilters] = useState<AnalyticsFilters>({
    period: dateRange ? 'custom' : '7d',
    dateRange,
  });

  // Fetch analytics data
  const {
    data: analyticsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['analytics', urlId, filters],
    queryFn: () => {
      if (!urlId) {
        throw new Error('URL ID is required for analytics');
      }
      return urlAPI.getUrlAnalytics(urlId, filters.period !== 'custom' ? filters.period : undefined);
    },
    enabled: !!urlId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Refetch every 30 seconds for real-time updates
  });

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!analyticsData) return null;

    const totalClicks = analyticsData.totalClicks;
    const uniqueClicks = analyticsData.uniqueClicks;
    const clickThroughRate = totalClicks > 0 ? (uniqueClicks / totalClicks) * 100 : 0;
    
    // Calculate trends (comparing with previous period)
    const recentClicks = analyticsData.clicksByDate.slice(-7);
    const previousClicks = analyticsData.clicksByDate.slice(-14, -7);
    
    const recentTotal = recentClicks.reduce((sum, day) => sum + day.clicks, 0);
    const previousTotal = previousClicks.reduce((sum, day) => sum + day.clicks, 0);
    
    const clicksTrend = previousTotal > 0 
      ? ((recentTotal - previousTotal) / previousTotal) * 100 
      : recentTotal > 0 ? 100 : 0;

    return {
      totalClicks,
      uniqueClicks,
      clickThroughRate,
      clicksTrend,
      topCountry: analyticsData.topCountries[0]?.country || 'N/A',
      topDevice: analyticsData.topDevices[0]?.device || 'N/A',
      topBrowser: analyticsData.topBrowsers[0]?.browser || 'N/A',
    };
  }, [analyticsData]);

  const handleFiltersChange = (newFilters: Partial<AnalyticsFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  };

  const handleDateRangeChange = (range: DateRange | null) => {
    if (range) {
      setFilters(prev => ({
        ...prev,
        period: 'custom',
        dateRange: range,
      }));
    } else {
      setFilters(prev => ({
        ...prev,
        period: '7d',
        dateRange: undefined,
      }));
    }
  };

  if (error) {
    return (
      <Alert severity="error" className={className}>
        Failed to load analytics data. Please try again.
      </Alert>
    );
  }

  return (
    <Box className={className}>
      {/* Header with filters */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5" component="h2" fontWeight="bold">
          Analytics Dashboard
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Period</InputLabel>
            <Select
              value={filters.period}
              label="Period"
              onChange={(e) => handleFiltersChange({ period: e.target.value as any })}
            >
              <MenuItem value="24h">Last 24 Hours</MenuItem>
              <MenuItem value="7d">Last 7 Days</MenuItem>
              <MenuItem value="30d">Last 30 Days</MenuItem>
              <MenuItem value="90d">Last 90 Days</MenuItem>
              <MenuItem value="custom">Custom Range</MenuItem>
            </Select>
          </FormControl>

          {filters.period === 'custom' && (
            <DateRangePicker
              value={filters.dateRange}
              onChange={handleDateRangeChange}
            />
          )}

          {analyticsData && (
            <ExportButton
              data={analyticsData}
              urlId={urlId}
              variant="outlined"
              size="small"
            />
          )}
        </Box>
      </Box>

      {/* Key Metrics Cards */}
      <Box sx={{ 
        display: 'grid', 
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
        gap: 3,
        mb: 4 
      }}>
        {isLoading ? (
          <Skeleton variant="rectangular" height={120} />
        ) : (
          <MetricCard
            title="Total Clicks"
            value={metrics?.totalClicks || 0}
            icon={<Visibility />}
            trend={metrics?.clicksTrend}
            color="primary"
          />
        )}
        
        {isLoading ? (
          <Skeleton variant="rectangular" height={120} />
        ) : (
          <MetricCard
            title="Unique Clicks"
            value={metrics?.uniqueClicks || 0}
            icon={<People />}
            color="secondary"
          />
        )}
        
        {isLoading ? (
          <Skeleton variant="rectangular" height={120} />
        ) : (
          <MetricCard
            title="Click-Through Rate"
            value={`${metrics?.clickThroughRate.toFixed(1) || 0}%`}
            icon={<TrendingUp />}
            color="success"
          />
        )}
        
        {isLoading ? (
          <Skeleton variant="rectangular" height={120} />
        ) : (
          <MetricCard
            title="Top Country"
            value={metrics?.topCountry || 'N/A'}
            icon={<Language />}
            color="info"
          />
        )}
      </Box>

      {/* Charts Section */}
      <Box sx={{ display: 'grid', gap: 3 }}>
        {/* Click Trends Chart */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          gap: 3 
        }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Click Trends Over Time
              </Typography>
              {isLoading ? (
                <Skeleton variant="rectangular" height={300} />
              ) : analyticsData ? (
                <ClickChart
                  data={analyticsData.clicksByDate}
                  type="line"
                  period={filters.period}
                />
              ) : null}
            </CardContent>
          </Card>

          {/* Top Countries */}
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Geographic Distribution
              </Typography>
              {isLoading ? (
                <Skeleton variant="rectangular" height={300} />
              ) : analyticsData ? (
                <GeographicChart data={analyticsData.topCountries} />
              ) : null}
            </CardContent>
          </Card>
        </Box>

        {/* Device and Referrer Analytics */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 3 
        }}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Device Types
              </Typography>
              {isLoading ? (
                <Skeleton variant="rectangular" height={250} />
              ) : analyticsData ? (
                <DeviceChart data={analyticsData.topDevices} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Referrers
              </Typography>
              {isLoading ? (
                <Skeleton variant="rectangular" height={250} />
              ) : analyticsData ? (
                <ReferrerChart data={analyticsData.topReferrers} />
              ) : null}
            </CardContent>
          </Card>
        </Box>

        {/* Browser Analytics */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Browser Distribution
            </Typography>
            {isLoading ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} variant="rectangular" width={100} height={32} />
                ))}
              </Box>
            ) : analyticsData ? (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {analyticsData.topBrowsers.map((browser, index) => (
                  <Chip
                    key={browser.browser}
                    label={`${browser.browser} (${browser.percentage.toFixed(1)}%)`}
                    color={index < 3 ? 'primary' : 'default'}
                    variant={index < 3 ? 'filled' : 'outlined'}
                  />
                ))}
              </Box>
            ) : null}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};