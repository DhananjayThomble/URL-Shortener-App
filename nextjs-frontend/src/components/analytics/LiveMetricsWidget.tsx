'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Stack,
  LinearProgress,
  Fade,
  Zoom,
} from '@mui/material';
import {
  Visibility,
  People,
  TrendingUp,
  Language,
  Refresh,
  Pause,
  PlayArrow,
  Fullscreen,
  FullscreenExit,
} from '@mui/icons-material';
import { useRealTimeAnalytics } from '@/hooks/useRealTimeAnalytics';
import { formatDistanceToNow } from 'date-fns';

interface LiveMetricsWidgetProps {
  urlId: string;
  compact?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
  className?: string;
}

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  format?: (value: number) => string;
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 1000,
  format = (v) => v.toLocaleString(),
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (displayValue !== value) {
      setIsAnimating(true);
      const startValue = displayValue;
      const difference = value - startValue;
      const startTime = Date.now();

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function (ease-out)
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentValue = Math.round(startValue + difference * easeOut);
        
        setDisplayValue(currentValue);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setIsAnimating(false);
        }
      };
      
      requestAnimationFrame(animate);
    }
  }, [value, displayValue, duration]);

  return (
    <Typography
      variant="h4"
      fontWeight="bold"
      sx={{
        transition: 'color 0.3s ease',
        color: isAnimating ? 'primary.main' : 'inherit',
      }}
    >
      {format(displayValue)}
    </Typography>
  );
};

export const LiveMetricsWidget: React.FC<LiveMetricsWidgetProps> = ({
  urlId,
  compact = false,
  autoRefresh = true,
  refreshInterval = 30000,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPaused, setIsPaused] = useState(!autoRefresh);

  const {
    data,
    metrics,
    isLoading,
    isLive,
    lastUpdate,
    refresh,
    toggleLive,
  } = useRealTimeAnalytics({
    urlId,
    enabled: !isPaused,
    pollingInterval: refreshInterval,
  });

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
    toggleLive();
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  if (!metrics) {
    return (
      <Card className={className}>
        <CardContent sx={{ textAlign: 'center', py: 4 }}>
          <LinearProgress sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary">
            Loading live metrics...
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const MetricItem = ({ 
    icon, 
    label, 
    value, 
    color = 'primary',
    animated = true 
  }: {
    icon: React.ReactNode;
    label: string;
    value: number | string;
    color?: 'primary' | 'secondary' | 'success' | 'info';
    animated?: boolean;
  }) => (
    <Box sx={{ textAlign: 'center', p: compact ? 1 : 2 }}>
      <Box sx={{ color: `${color}.main`, mb: 1 }}>
        {icon}
      </Box>
      {animated && typeof value === 'number' ? (
        <AnimatedCounter value={value} />
      ) : (
        <Typography variant={compact ? 'h6' : 'h4'} fontWeight="bold">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );

  return (
    <Card className={className}>
      <CardContent sx={{ p: compact ? 2 : 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant={compact ? 'subtitle1' : 'h6'} fontWeight="bold">
              Live Metrics
            </Typography>
            <Fade in={isLive && !isPaused}>
              <Chip
                label="LIVE"
                color="success"
                size="small"
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
            </Fade>
          </Box>

          <Stack direction="row" spacing={0.5}>
            <Tooltip title={isPaused ? 'Resume updates' : 'Pause updates'}>
              <IconButton size="small" onClick={handleTogglePause}>
                {isPaused ? <PlayArrow /> : <Pause />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Refresh now">
              <IconButton size="small" onClick={refresh} disabled={isLoading}>
                <Refresh sx={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
              </IconButton>
            </Tooltip>
            
            {!compact && (
              <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
                <IconButton size="small" onClick={handleToggleExpand}>
                  {isExpanded ? <FullscreenExit /> : <Fullscreen />}
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Box>

        {/* Loading indicator */}
        {isLoading && (
          <LinearProgress sx={{ mb: 2, height: 2 }} />
        )}

        {/* Metrics Grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: compact 
            ? 'repeat(2, 1fr)' 
            : isExpanded 
              ? 'repeat(4, 1fr)' 
              : 'repeat(2, 1fr)',
          gap: compact ? 1 : 2,
        }}>
          <Zoom in={true} style={{ transitionDelay: '100ms' }}>
            <Box>
              <MetricItem
                icon={<Visibility />}
                label="Total Clicks"
                value={metrics.totalClicks}
                color="primary"
              />
            </Box>
          </Zoom>

          <Zoom in={true} style={{ transitionDelay: '200ms' }}>
            <Box>
              <MetricItem
                icon={<People />}
                label="Unique Visitors"
                value={metrics.uniqueClicks}
                color="secondary"
              />
            </Box>
          </Zoom>

          {(!compact || isExpanded) && (
            <>
              <Zoom in={true} style={{ transitionDelay: '300ms' }}>
                <Box>
                  <MetricItem
                    icon={<TrendingUp />}
                    label="Click Rate"
                    value={`${metrics.clickRate.toFixed(1)}%`}
                    color="success"
                    animated={false}
                  />
                </Box>
              </Zoom>

              <Zoom in={true} style={{ transitionDelay: '400ms' }}>
                <Box>
                  <MetricItem
                    icon={<Language />}
                    label="Top Country"
                    value={metrics.topCountry}
                    color="info"
                    animated={false}
                  />
                </Box>
              </Zoom>
            </>
          )}
        </Box>

        {/* Last Update Info */}
        {lastUpdate && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              Last updated {formatDistanceToNow(lastUpdate, { addSuffix: true })}
            </Typography>
          </Box>
        )}

        {/* Expanded View - Recent Activity */}
        {isExpanded && metrics.recentActivity && (
          <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" gutterBottom>
              Recent Activity (Last 7 Days)
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {metrics.recentActivity.slice(-7).map((day, index) => (
                <Chip
                  key={day.date}
                  label={`${new Date(day.date).toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                  })}: ${day.clicks}`}
                  size="small"
                  variant={index === metrics.recentActivity.length - 1 ? 'filled' : 'outlined'}
                  color={day.clicks > 0 ? 'primary' : 'default'}
                />
              ))}
            </Box>
          </Box>
        )}
      </CardContent>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Card>
  );
};