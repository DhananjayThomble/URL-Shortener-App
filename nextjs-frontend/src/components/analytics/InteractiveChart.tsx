'use client';

import React, { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  TrendingUp,
  BarChart as BarChartIcon,
  ShowChart,
  Timeline,
  Fullscreen,
  ZoomIn,
  ZoomOut,
} from '@mui/icons-material';
import { ClickChart } from './ClickChart';
import type { ClicksByDate } from '@/types/analytics';

interface InteractiveChartProps {
  data: ClicksByDate[];
  title?: string;
  period: '24h' | '7d' | '30d' | '90d' | 'custom';
  onPeriodChange?: (period: string) => void;
  className?: string;
}

export const InteractiveChart: React.FC<InteractiveChartProps> = ({
  data,
  title = 'Click Analytics',
  period,
  onPeriodChange,
  className,
}) => {
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [showUniqueClicks, setShowUniqueClicks] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        totalClicks: 0,
        uniqueClicks: 0,
        averageClicks: 0,
        trend: 0,
        peakDay: null,
      };
    }

    const totalClicks = data.reduce((sum, day) => sum + day.clicks, 0);
    const uniqueClicks = data.reduce((sum, day) => sum + day.uniqueClicks, 0);
    const averageClicks = totalClicks / data.length;

    // Calculate trend (comparing first half vs second half)
    const midPoint = Math.floor(data.length / 2);
    const firstHalf = data.slice(0, midPoint);
    const secondHalf = data.slice(midPoint);
    
    const firstHalfAvg = firstHalf.reduce((sum, day) => sum + day.clicks, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, day) => sum + day.clicks, 0) / secondHalf.length;
    
    const trend = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;

    // Find peak day
    const peakDay = data.reduce((max, day) => 
      day.clicks > max.clicks ? day : max, data[0]
    );

    return {
      totalClicks,
      uniqueClicks,
      averageClicks,
      trend,
      peakDay,
    };
  }, [data]);

  const handleChartTypeChange = (
    event: React.MouseEvent<HTMLElement>,
    newType: 'line' | 'bar' | 'area' | null,
  ) => {
    if (newType !== null) {
      setChartType(newType);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev * 1.2, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev / 1.2, 0.5));
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const chartHeight = isFullscreen ? 500 : 350;

  return (
    <Card 
      className={className}
      sx={{
        ...(isFullscreen && {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1300,
          borderRadius: 0,
        }),
      }}
    >
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" component="h3" fontWeight="bold">
            {title}
          </Typography>
          
          <Stack direction="row" spacing={1} alignItems="center">
            {/* Chart Type Toggle */}
            <ToggleButtonGroup
              value={chartType}
              exclusive
              onChange={handleChartTypeChange}
              size="small"
            >
              <ToggleButton value="line" aria-label="line chart">
                <Tooltip title="Line Chart">
                  <ShowChart />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="area" aria-label="area chart">
                <Tooltip title="Area Chart">
                  <Timeline />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="bar" aria-label="bar chart">
                <Tooltip title="Bar Chart">
                  <BarChartIcon />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>

            {/* Zoom Controls */}
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Tooltip title="Zoom Out">
                <IconButton size="small" onClick={handleZoomOut} disabled={zoomLevel <= 0.5}>
                  <ZoomOut />
                </IconButton>
              </Tooltip>
              <Typography variant="caption" sx={{ mx: 1, minWidth: 30, textAlign: 'center' }}>
                {Math.round(zoomLevel * 100)}%
              </Typography>
              <Tooltip title="Zoom In">
                <IconButton size="small" onClick={handleZoomIn} disabled={zoomLevel >= 3}>
                  <ZoomIn />
                </IconButton>
              </Tooltip>
            </Box>

            {/* Fullscreen Toggle */}
            <Tooltip title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}>
              <IconButton size="small" onClick={toggleFullscreen}>
                <Fullscreen />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>

        {/* Metrics Summary */}
        <Box sx={{ 
          display: 'grid', 
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3 
        }}>
          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h6" color="primary.main" fontWeight="bold">
              {metrics.totalClicks.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Total Clicks
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h6" color="secondary.main" fontWeight="bold">
              {metrics.uniqueClicks.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Unique Clicks
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="h6" color="info.main" fontWeight="bold">
              {Math.round(metrics.averageClicks)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Avg per Day
            </Typography>
          </Box>
          
          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography 
                variant="h6" 
                color={metrics.trend >= 0 ? 'success.main' : 'error.main'}
                fontWeight="bold"
              >
                {metrics.trend >= 0 ? '+' : ''}{metrics.trend.toFixed(1)}%
              </Typography>
              <TrendingUp 
                sx={{ 
                  ml: 0.5, 
                  color: metrics.trend >= 0 ? 'success.main' : 'error.main',
                  transform: metrics.trend < 0 ? 'rotate(180deg)' : 'none'
                }} 
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              Trend
            </Typography>
          </Box>
        </Box>

        {/* Chart Controls */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Show Data</InputLabel>
            <Select
              value={showUniqueClicks ? 'both' : 'total'}
              label="Show Data"
              onChange={(e) => setShowUniqueClicks(e.target.value === 'both')}
            >
              <MenuItem value="total">Total Clicks Only</MenuItem>
              <MenuItem value="both">Total + Unique</MenuItem>
            </Select>
          </FormControl>

          {metrics.peakDay && (
            <Typography variant="caption" color="text.secondary">
              Peak: {metrics.peakDay.clicks} clicks on {new Date(metrics.peakDay.date).toLocaleDateString()}
            </Typography>
          )}
        </Box>

        {/* Chart */}
        <Box sx={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}>
          <ClickChart
            data={data}
            type={chartType}
            period={period}
            showUniqueClicks={showUniqueClicks}
            height={chartHeight}
          />
        </Box>

        {/* Chart Info */}
        {data && data.length > 0 && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Data from {new Date(data[0].date).toLocaleDateString()} to {new Date(data[data.length - 1].date).toLocaleDateString()} 
              ({data.length} data points)
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};