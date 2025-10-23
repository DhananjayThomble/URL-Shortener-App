'use client';

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
  LinearProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Info,
  Visibility,
  People,
  Link as LinkIcon,
  Schedule,
  Language,
  DevicesOther,
} from '@mui/icons-material';

interface StatItem {
  label: string;
  value: string | number;
  trend?: number;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  progress?: number;
  maxValue?: number;
}

interface DashboardStatsProps {
  stats?: StatItem[];
  title?: string;
  subtitle?: string;
  showTrends?: boolean;
  compact?: boolean;
  className?: string;
}

const defaultStats: StatItem[] = [
  {
    label: 'Total URLs',
    value: 24,
    trend: 12.5,
    subtitle: 'Active links',
    icon: <LinkIcon />,
    color: 'primary',
    progress: 24,
    maxValue: 100,
  },
  {
    label: 'Total Clicks',
    value: '2.4K',
    trend: 8.2,
    subtitle: 'This month',
    icon: <Visibility />,
    color: 'success',
  },
  {
    label: 'Unique Visitors',
    value: '1.8K',
    trend: -2.1,
    subtitle: 'Last 30 days',
    icon: <People />,
    color: 'info',
  },
  {
    label: 'Avg. Session',
    value: '2m 34s',
    trend: 15.7,
    subtitle: 'Duration',
    icon: <Schedule />,
    color: 'warning',
  },
  {
    label: 'Top Country',
    value: 'United States',
    subtitle: '42% of traffic',
    icon: <Language />,
    color: 'secondary',
  },
  {
    label: 'Top Device',
    value: 'Mobile',
    subtitle: '68% of clicks',
    icon: <DevicesOther />,
    color: 'primary',
  },
];

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  stats = defaultStats,
  title = 'Overview Statistics',
  subtitle = 'Key metrics for your URLs',
  showTrends = true,
  compact = false,
  className,
}) => {
  const formatValue = (value: string | number) => {
    if (typeof value === 'number') {
      if (value >= 1000000) {
        return `${(value / 1000000).toFixed(1)}M`;
      } else if (value >= 1000) {
        return `${(value / 1000).toFixed(1)}K`;
      }
      return value.toLocaleString();
    }
    return value;
  };

  const getTrendIcon = (trend?: number) => {
    if (!trend) return null;
    return trend >= 0 ? (
      <TrendingUp sx={{ fontSize: 16, color: 'success.main' }} />
    ) : (
      <TrendingDown sx={{ fontSize: 16, color: 'error.main' }} />
    );
  };

  const getTrendColor = (trend?: number) => {
    if (!trend) return 'text.secondary';
    return trend >= 0 ? 'success.main' : 'error.main';
  };

  return (
    <Card className={className}>
      <CardContent sx={{ p: compact ? 2 : 3 }}>
        {/* Header */}
        {!compact && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" component="h3" fontWeight="bold" gutterBottom>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          </Box>
        )}

        {/* Stats Grid */}
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: compact 
            ? 'repeat(auto-fit, minmax(150px, 1fr))'
            : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: compact ? 2 : 3,
        }}>
          {stats.map((stat, index) => (
            <Box
              key={index}
              sx={{
                p: compact ? 2 : 2.5,
                borderRadius: 2,
                bgcolor: 'action.hover',
                border: 1,
                borderColor: 'divider',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  borderColor: `${stat.color || 'primary'}.main`,
                  boxShadow: 1,
                },
              }}
            >
              {/* Icon and Label */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {stat.icon && (
                    <Box sx={{ color: `${stat.color || 'primary'}.main` }}>
                      {stat.icon}
                    </Box>
                  )}
                  <Typography variant="body2" color="text.secondary" fontWeight="medium">
                    {stat.label}
                  </Typography>
                </Box>
                
                {stat.trend !== undefined && showTrends && (
                  <Tooltip title={`${stat.trend >= 0 ? '+' : ''}${stat.trend.toFixed(1)}% change`}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {getTrendIcon(stat.trend)}
                      <Typography
                        variant="caption"
                        sx={{ color: getTrendColor(stat.trend), fontWeight: 'medium' }}
                      >
                        {stat.trend >= 0 ? '+' : ''}{stat.trend.toFixed(1)}%
                      </Typography>
                    </Box>
                  </Tooltip>
                )}
              </Box>

              {/* Value */}
              <Typography
                variant={compact ? 'h6' : 'h5'}
                fontWeight="bold"
                sx={{ color: `${stat.color || 'primary'}.main`, mb: 0.5 }}
              >
                {formatValue(stat.value)}
              </Typography>

              {/* Subtitle */}
              {stat.subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {stat.subtitle}
                </Typography>
              )}

              {/* Progress Bar */}
              {stat.progress !== undefined && stat.maxValue && (
                <Box sx={{ mt: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={(stat.progress / stat.maxValue) * 100}
                    sx={{
                      height: 4,
                      borderRadius: 2,
                      bgcolor: 'action.selected',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: `${stat.color || 'primary'}.main`,
                      },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {stat.progress} / {stat.maxValue}
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
        </Box>

        {/* Additional Info */}
        {!compact && (
          <Box sx={{ mt: 3, p: 2, bgcolor: 'info.light', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Info sx={{ fontSize: 16, color: 'info.main' }} />
              <Typography variant="body2" color="info.dark">
                Statistics are updated in real-time. Trends show change from previous period.
              </Typography>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};