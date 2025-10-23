'use client';

import React from 'react';
import { Box, Typography, Paper, Divider } from '@mui/material';
import {
  AnalyticsDashboard,
  ClickChart,
  GeographicChart,
  DeviceChart,
  ReferrerChart,
  MetricCard,
  ExportButton,
} from '@/components/analytics';
import { Visibility, People, TrendingUp, Language } from '@mui/icons-material';
import type { AnalyticsData, ClicksByDate, CountryData, DeviceData, ReferrerData } from '@/types/analytics';

// Mock data for demonstration
const mockClicksByDate: ClicksByDate[] = [
  { date: '2024-10-15', clicks: 45, uniqueClicks: 38 },
  { date: '2024-10-16', clicks: 52, uniqueClicks: 44 },
  { date: '2024-10-17', clicks: 38, uniqueClicks: 32 },
  { date: '2024-10-18', clicks: 67, uniqueClicks: 55 },
  { date: '2024-10-19', clicks: 73, uniqueClicks: 61 },
  { date: '2024-10-20', clicks: 89, uniqueClicks: 74 },
  { date: '2024-10-21', clicks: 95, uniqueClicks: 78 },
];

const mockCountryData: CountryData[] = [
  { country: 'United States', countryCode: 'US', clicks: 245, percentage: 42.5 },
  { country: 'United Kingdom', countryCode: 'GB', clicks: 123, percentage: 21.3 },
  { country: 'Canada', countryCode: 'CA', clicks: 89, percentage: 15.4 },
  { country: 'Germany', countryCode: 'DE', clicks: 67, percentage: 11.6 },
  { country: 'France', countryCode: 'FR', clicks: 53, percentage: 9.2 },
];

const mockDeviceData: DeviceData[] = [
  { device: 'Mobile', clicks: 312, percentage: 54.2 },
  { device: 'Desktop', clicks: 189, percentage: 32.8 },
  { device: 'Tablet', clicks: 75, percentage: 13.0 },
];

const mockReferrerData: ReferrerData[] = [
  { referrer: 'Direct', domain: 'Direct', clicks: 234, percentage: 40.6 },
  { referrer: 'Google Search', domain: 'google.com', clicks: 156, percentage: 27.1 },
  { referrer: 'Facebook', domain: 'facebook.com', clicks: 89, percentage: 15.5 },
  { referrer: 'Twitter', domain: 'twitter.com', clicks: 45, percentage: 7.8 },
  { referrer: 'LinkedIn', domain: 'linkedin.com', clicks: 32, percentage: 5.6 },
  { referrer: 'Reddit', domain: 'reddit.com', clicks: 20, percentage: 3.4 },
];

const mockAnalyticsData: AnalyticsData = {
  urlId: 'example-url-id',
  totalClicks: 576,
  uniqueClicks: 482,
  clicksByDate: mockClicksByDate,
  topCountries: mockCountryData,
  topDevices: mockDeviceData,
  topBrowsers: [
    { browser: 'Chrome', clicks: 289, percentage: 50.2 },
    { browser: 'Safari', clicks: 145, percentage: 25.2 },
    { browser: 'Firefox', clicks: 78, percentage: 13.5 },
    { browser: 'Edge', clicks: 64, percentage: 11.1 },
  ],
  topReferrers: mockReferrerData,
  topOperatingSystems: [
    { os: 'Windows', clicks: 234, percentage: 40.6 },
    { os: 'iOS', clicks: 167, percentage: 29.0 },
    { os: 'Android', clicks: 123, percentage: 21.4 },
    { os: 'macOS', clicks: 52, percentage: 9.0 },
  ],
};

export const AnalyticsExample: React.FC = () => {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Analytics Components Example
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        This page demonstrates the analytics components with mock data.
      </Typography>

      <Divider sx={{ my: 3 }} />

      {/* Metric Cards */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Metric Cards
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 2, mb: 4 }}>
        <MetricCard
          title="Total Clicks"
          value={576}
          icon={<Visibility />}
          trend={12.5}
          color="primary"
        />
        <MetricCard
          title="Unique Clicks"
          value={482}
          icon={<People />}
          trend={-3.2}
          color="secondary"
        />
        <MetricCard
          title="Click-Through Rate"
          value="83.7%"
          icon={<TrendingUp />}
          color="success"
        />
        <MetricCard
          title="Top Country"
          value="United States"
          icon={<Language />}
          color="info"
        />
      </Box>

      {/* Enhanced Chart Features */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Enhanced Chart Features
      </Typography>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Advanced Click Chart with Controls
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          The InteractiveChart component provides advanced controls for chart type switching, zoom, and fullscreen mode.
        </Typography>
        <ClickChart data={mockClicksByDate} type="line" period="7d" />
      </Paper>

      {/* Export Functionality */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Export Functionality
      </Typography>
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Export Analytics Data
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Export your analytics data in various formats for further analysis or reporting.
        </Typography>
        <ExportButton
          data={mockAnalyticsData}
          urlId="example-url"
          variant="contained"
          size="large"
        />
      </Paper>

      {/* Click Chart */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Basic Charts
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 3, mb: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Line Chart
          </Typography>
          <ClickChart data={mockClicksByDate} type="line" period="7d" />
        </Paper>
        
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Area Chart
          </Typography>
          <ClickChart data={mockClicksByDate} type="area" period="7d" />
        </Paper>
        
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Bar Chart
          </Typography>
          <ClickChart data={mockClicksByDate} type="bar" period="7d" />
        </Paper>
      </Box>

      {/* Other Charts */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Analytics Charts
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 3, mb: 4 }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Geographic Distribution
          </Typography>
          <GeographicChart data={mockCountryData} />
        </Paper>
        
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Device Types
          </Typography>
          <DeviceChart data={mockDeviceData} />
        </Paper>
        
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Top Referrers
          </Typography>
          <ReferrerChart data={mockReferrerData} />
        </Paper>
      </Box>

      {/* Full Analytics Dashboard */}
      <Typography variant="h5" gutterBottom sx={{ mt: 4 }}>
        Complete Analytics Dashboard
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Note: This would normally require a URL ID and fetch real data from the API.
        </Typography>
        {/* We can't use the full dashboard here without mocking the API call */}
        <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Full Analytics Dashboard would be rendered here with real API data
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};