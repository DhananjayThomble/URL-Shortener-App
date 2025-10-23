'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Chip,
  Stack,
  IconButton,
  Tooltip,
  Badge,
  LinearProgress,
  Alert,
  Snackbar,
} from '@mui/material';
import {
  PlayArrow,
  Pause,
  Refresh,
  Notifications,
  TrendingUp,
  Visibility,
  People,
  Language,
  DevicesOther,
  AccessTime,
  Wifi,
  WifiOff,
} from '@mui/icons-material';
import { useRealTimeAnalytics, useAnalyticsNotifications } from '@/hooks/useRealTimeAnalytics';
import { ClickChart } from './ClickChart';
import { MetricCard } from './MetricCard';
import type { MilestoneEvent } from '@/hooks/useRealTimeAnalytics';

interface RealTimeDashboardProps {
  urlId: string;
  className?: string;
}

export const RealTimeDashboard: React.FC<RealTimeDashboardProps> = ({
  urlId,
  className,
}) => {
  const [showNotifications, setShowNotifications] = useState(true);
  const [currentNotification, setCurrentNotification] = useState<MilestoneEvent | null>(null);

  const { notifications, addNotification, removeNotification } = useAnalyticsNotifications();

  const {
    data,
    metrics,
    isLoading,
    error,
    isLive,
    lastUpdate,
    updateCount,
    refresh,
    toggleLive,
    getUpdateInfo,
  } = useRealTimeAnalytics({
    urlId,
    enabled: true,
    pollingInterval: 30000, // 30 seconds
    onMilestone: (milestone) => {
      if (showNotifications) {
        addNotification(milestone);
        setCurrentNotification(milestone);
      }
    },
  });

  const updateInfo = getUpdateInfo();

  // Auto-hide notification after 5 seconds
  useEffect(() => {
    if (currentNotification) {
      const timer = setTimeout(() => {
        setCurrentNotification(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [currentNotification]);

  // Format time since last update
  const getTimeSinceUpdate = () => {
    if (!lastUpdate) return 'Never';
    const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // Calculate next update countdown
  const [countdown, setCountdown] = useState<number>(0);
  useEffect(() => {
    if (!isLive || !updateInfo.nextUpdate) return;

    const interval = setInterval(() => {
      const remaining = Math.max(0, updateInfo.nextUpdate!.getTime() - Date.now());
      setCountdown(Math.ceil(remaining / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive, updateInfo.nextUpdate]);

  if (error) {
    return (
      <Alert severity="error" className={className}>
        Failed to load real-time analytics. Please try refreshing.
      </Alert>
    );
  }

  return (
    <Box className={className}>
      {/* Real-time Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {isLive ? <Wifi color="success" /> : <WifiOff color="disabled" />}
                <Typography variant="h6" sx={{ ml: 1 }}>
                  Real-time Analytics
                </Typography>
              </Box>
              
              <Chip
                label={isLive ? 'LIVE' : 'PAUSED'}
                color={isLive ? 'success' : 'default'}
                size="small"
                icon={isLive ? <PlayArrow /> : <Pause />}
              />
            </Box>

            <Stack direction="row" spacing={1} alignItems="center">
              <FormControlLabel
                control={
                  <Switch
                    checked={showNotifications}
                    onChange={(e) => setShowNotifications(e.target.checked)}
                    size="small"
                  />
                }
                label="Notifications"
              />

              <Badge badgeContent={notifications.length} color="error">
                <Tooltip title="Milestone notifications">
                  <IconButton size="small">
                    <Notifications />
                  </IconButton>
                </Tooltip>
              </Badge>

              <Tooltip title="Refresh now">
                <IconButton onClick={refresh} disabled={isLoading} size="small">
                  <Refresh />
                </IconButton>
              </Tooltip>

              <Tooltip title={isLive ? 'Pause updates' : 'Start live updates'}>
                <IconButton onClick={toggleLive} size="small">
                  {isLive ? <Pause /> : <PlayArrow />}
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>

          {/* Update Status */}
          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="caption" color="text.secondary">
              <AccessTime sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
              Last update: {getTimeSinceUpdate()}
            </Typography>
            
            <Typography variant="caption" color="text.secondary">
              Updates: {updateCount}
            </Typography>

            {isLive && countdown > 0 && (
              <Typography variant="caption" color="text.secondary">
                Next update in: {countdown}s
              </Typography>
            )}
          </Box>

          {/* Loading indicator */}
          {isLoading && (
            <LinearProgress sx={{ mt: 1, height: 2 }} />
          )}
        </CardContent>
      </Card>

      {/* Real-time Metrics */}
      {metrics && (
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3 
        }}>
          <MetricCard
            title="Total Clicks"
            value={metrics.totalClicks}
            icon={<Visibility />}
            color="primary"
            animated={isLive}
          />
          
          <MetricCard
            title="Unique Visitors"
            value={metrics.uniqueClicks}
            icon={<People />}
            color="secondary"
            animated={isLive}
          />
          
          <MetricCard
            title="Click Rate"
            value={`${metrics.clickRate.toFixed(1)}%`}
            icon={<TrendingUp />}
            color="success"
            animated={isLive}
          />
          
          <MetricCard
            title="Top Country"
            value={metrics.topCountry}
            icon={<Language />}
            color="info"
            animated={isLive}
          />
        </Box>
      )}

      {/* Real-time Chart */}
      {data && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6">
                Live Click Activity
              </Typography>
              <Chip
                label={`${data.clicksByDate.length} days`}
                size="small"
                variant="outlined"
              />
            </Box>
            
            <ClickChart
              data={data.clicksByDate}
              type="area"
              period="7d"
              height={300}
              showUniqueClicks={true}
            />
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {metrics && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Recent Activity (Last 7 Days)
            </Typography>
            
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2 
            }}>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Top Performing Days
                </Typography>
                {metrics.recentActivity
                  .sort((a, b) => b.clicks - a.clicks)
                  .slice(0, 3)
                  .map((day, index) => (
                    <Box
                      key={day.date}
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        py: 1,
                        px: 2,
                        mb: 1,
                        bgcolor: index === 0 ? 'success.light' : 'action.hover',
                        borderRadius: 1,
                      }}
                    >
                      <Typography variant="body2">
                        {new Date(day.date).toLocaleDateString()}
                      </Typography>
                      <Typography variant="body2" fontWeight="bold">
                        {day.clicks} clicks
                      </Typography>
                    </Box>
                  ))}
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Device Breakdown
                </Typography>
                {data.topDevices.slice(0, 3).map((device, index) => (
                  <Box
                    key={device.device}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      py: 1,
                      px: 2,
                      mb: 1,
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <DevicesOther sx={{ mr: 1, fontSize: 16 }} />
                      <Typography variant="body2">
                        {device.device}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="bold">
                      {device.percentage.toFixed(1)}%
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Milestone Notification */}
      <Snackbar
        open={!!currentNotification}
        autoHideDuration={5000}
        onClose={() => setCurrentNotification(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {currentNotification && (
          <Alert
            onClose={() => setCurrentNotification(null)}
            severity="success"
            variant="filled"
            sx={{ minWidth: 300 }}
          >
            {currentNotification.message}
          </Alert>
        )}
      </Snackbar>
    </Box>
  );
};