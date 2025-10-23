'use client';

import React, { useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  LinearProgress,
  Button,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Visibility,
  People,
  Link as LinkIcon,
  Analytics,
  Refresh,
  Add,
  QrCode,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import { MetricCard } from '@/components/analytics';
import { ClickChart } from '@/components/analytics';
import { LiveMetricsWidget } from '@/components/analytics';
import { urlAPI } from '@/lib/api';
import type { DashboardMetrics } from '@/types/analytics';

interface DashboardOverviewProps {
  onCreateUrl?: () => void;
  onViewAnalytics?: () => void;
  className?: string;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onCreateUrl,
  onViewAnalytics,
  className,
}) => {
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch dashboard metrics
  const {
    data: metrics,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dashboard-metrics', refreshKey],
    queryFn: () => urlAPI.getDashboardMetrics(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
  });

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
    refetch();
  };

  if (error) {
    return (
      <Box className={className}>
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" color="error" gutterBottom>
              Failed to load dashboard data
            </Typography>
            <Button onClick={handleRefresh} startIcon={<Refresh />}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box className={className}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            Dashboard Overview
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Monitor your URL performance and analytics
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh data">
            <IconButton onClick={handleRefresh} disabled={isLoading}>
              <Refresh />
            </IconButton>
          </Tooltip>
          
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={onCreateUrl}
          >
            Create URL
          </Button>
        </Stack>
      </Box>

      {/* Loading */}
      {isLoading && <LinearProgress sx={{ mb: 3 }} />}

      <Grid container spacing={3}>
        {/* Key Metrics */}
        <Grid item xs={12}>
          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
            gap: 3 
          }}>
            <MetricCard
              title="Total URLs"
              value={metrics?.totalUrls || 0}
              icon={<LinkIcon />}
              color="primary"
              trend={metrics?.totalUrls ? 12 : undefined}
              subtitle="Active links"
            />
            
            <MetricCard
              title="Total Clicks"
              value={metrics?.totalClicks || 0}
              icon={<Visibility />}
              color="success"
              trend={metrics?.totalClicks ? 8.5 : undefined}
              subtitle="All time"
            />
            
            <MetricCard
              title="Unique Visitors"
              value={metrics?.uniqueClicks || 0}
              icon={<People />}
              color="info"
              trend={metrics?.uniqueClicks ? -2.1 : undefined}
              subtitle="This month"
            />
            
            <MetricCard
              title="Click Rate"
              value={metrics?.totalClicks && metrics?.uniqueClicks 
                ? `${((metrics.uniqueClicks / metrics.totalClicks) * 100).toFixed(1)}%`
                : '0%'
              }
              icon={<TrendingUp />}
              color="warning"
              trend={5.2}
              subtitle="Conversion rate"
            />
          </Box>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              
              <Stack spacing={2}>
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={onCreateUrl}
                  fullWidth
                >
                  Create New URL
                </Button>
                
                <Button
                  variant="outlined"
                  startIcon={<Analytics />}
                  onClick={onViewAnalytics}
                  fullWidth
                >
                  View Analytics
                </Button>
                
                <Button
                  variant="outlined"
                  startIcon={<QrCode />}
                  fullWidth
                >
                  Generate QR Codes
                </Button>
              </Stack>

              {/* Account Usage */}
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Account Usage
                </Typography>
                
                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      URLs Created
                    </Typography>
                    <Typography variant="body2">
                      {metrics?.totalUrls || 0}/100
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(((metrics?.totalUrls || 0) / 100) * 100, 100)}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </Box>

                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Monthly Clicks
                    </Typography>
                    <Typography variant="body2">
                      {metrics?.totalClicks || 0}/10K
                    </Typography>
                  </Box>
                  <LinearProgress 
                    variant="determinate" 
                    value={Math.min(((metrics?.totalClicks || 0) / 10000) * 100, 100)}
                    sx={{ height: 6, borderRadius: 3 }}
                    color="success"
                  />
                </Box>

                <Chip 
                  label="Free Plan" 
                  size="small" 
                  color="primary" 
                  variant="outlined" 
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Click Activity Chart */}
        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Click Activity (Last 7 Days)
              </Typography>
              
              {metrics?.clicksOverTime ? (
                <ClickChart
                  data={metrics.clicksOverTime}
                  type="area"
                  period="7d"
                  height={300}
                  showUniqueClicks={true}
                />
              ) : (
                <Box sx={{ 
                  height: 300, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  bgcolor: 'action.hover',
                  borderRadius: 1
                }}>
                  <Typography variant="body2" color="text.secondary">
                    No click data available
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Top Performing URL */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top Performing URL
              </Typography>
              
              {metrics?.topUrl ? (
                <Box>
                  <Box sx={{ 
                    p: 2, 
                    bgcolor: 'action.hover', 
                    borderRadius: 1,
                    mb: 2
                  }}>
                    <Typography variant="body2" color="primary.main" fontFamily="monospace">
                      {window.location.origin}/{metrics.topUrl.shortCode}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {metrics.topUrl.originalUrl}
                    </Typography>
                  </Box>
                  
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Visibility fontSize="small" color="action" />
                      <Typography variant="body2">
                        {metrics.topUrl.clicks} clicks
                      </Typography>
                    </Box>
                    
                    <Chip 
                      label="Top Performer" 
                      size="small" 
                      color="success" 
                      icon={<TrendingUp />}
                    />
                  </Stack>
                </Box>
              ) : (
                <Box sx={{ 
                  textAlign: 'center', 
                  py: 4,
                  color: 'text.secondary'
                }}>
                  <LinkIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
                  <Typography variant="body2">
                    Create your first URL to see performance data
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Activity */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Activity
              </Typography>
              
              {metrics?.recentActivity && metrics.recentActivity.length > 0 ? (
                <Stack spacing={2}>
                  {metrics.recentActivity.slice(0, 5).map((activity, index) => (
                    <Box 
                      key={activity.id}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 2,
                        p: 1,
                        borderRadius: 1,
                        bgcolor: index === 0 ? 'action.hover' : 'transparent'
                      }}
                    >
                      <Box sx={{ 
                        width: 8, 
                        height: 8, 
                        borderRadius: '50%',
                        bgcolor: 
                          activity.type === 'url_created' ? 'success.main' :
                          activity.type === 'url_clicked' ? 'primary.main' :
                          activity.type === 'url_updated' ? 'warning.main' :
                          'error.main'
                      }} />
                      
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2">
                          {activity.description}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(activity.timestamp).toLocaleString()}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Box sx={{ 
                  textAlign: 'center', 
                  py: 4,
                  color: 'text.secondary'
                }}>
                  <Analytics sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
                  <Typography variant="body2">
                    No recent activity
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};