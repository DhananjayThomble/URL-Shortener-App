'use client';

import React, { useState, useMemo } from 'react';
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Typography,
  Paper,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ShowChart,
  BarChart as BarChartIcon,
  AreaChart as AreaChartIcon,
  Fullscreen,
  ZoomIn,
  ZoomOut,
} from '@mui/icons-material';
import { ClickChart } from './ClickChart';
import type { ClicksByDate } from '@/types/analytics';

interface InteractiveChartProps {
  data: ClicksByDate[];
  period: '24h' | '7d' | '30d' | '90d' | 'custom';
  title?: string;
  showControls?: boolean;
  allowFullscreen?: boolean;
  className?: string;
}

export const InteractiveChart: React.FC<InteractiveChartProps> = ({
  data,
  period,
  title = 'Click Analytics',
  showControls = true,
  allowFullscreen = true,
  className,
}) => {
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [showUniqueClicks, setShowUniqueClicks] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;

    const totalClicks = data.reduce((sum, item) => sum + item.clicks, 0);
    const totalUniqueClicks = data.reduce((sum, item) => sum + item.uniqueClicks, 0);
    const avgClicks = totalClicks / data.length;
    const avgUniqueClicks = totalUniqueClicks / data.length;
    
    const maxClicks = Math.max(...data.map(item => item.clicks));
    const minClicks = Math.min(...data.map(item => item.clicks));
    
    const peakDay = data.find(item => item.clicks === maxClicks);
    const lowDay = data.find(item => item.clicks === minClicks);

    return {
      totalClicks,
      totalUniqueClicks,
      avgClicks,
      avgUniqueClicks,
      maxClicks,
      minClicks,
      peakDay,
      lowDay,
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

  const handleFullscreenToggle = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.2, 2));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.2, 0.5));
  };

  const chartHeight = isFullscreen ? 600 : 350;

  return (
    <Paper 
      className={className}
      sx={{
        p: 3,
        ...(isFullscreen && {
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1300,
          borderRadius: 0,
          overflow: 'auto',
        }),
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" component="h3">
          {title}
        </Typography>
        
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {allowFullscreen && (
            <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
              <IconButton onClick={handleFullscreenToggle} size="small">
                <Fullscreen />
              </IconButton>
            </Tooltip>
          )}
          
          <Tooltip title="Zoom in">
            <IconButton onClick={handleZoomIn} size="small" disabled={zoomLevel >= 2}>
              <ZoomIn />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Zoom out">
            <IconButton onClick={handleZoomOut} size="small" disabled={zoomLevel <= 0.5}>
              <ZoomOut />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Controls */}
      {showControls && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          <ToggleButtonGroup
            value={chartType}
            exclusive
            onChange={handleChartTypeChange}
            size="small"
            aria-label="chart type"
          >
            <ToggleButton value="line" aria-label="line chart">
              <ShowChart />
            </ToggleButton>
            <ToggleButton value="bar" aria-label="bar chart">
              <BarChartIcon />
            </ToggleButton>
            <ToggleButton value="area" aria-label="area chart">
              <AreaChartIcon />
            </ToggleButton>
          </ToggleButtonGroup>

          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Data Series</InputLabel>
            <Select
              value={showUniqueClicks ? 'both' : 'total'}
              label="Data Series"
              onChange={(e) => setShowUniqueClicks(e.target.value === 'both')}
            >
              <MenuItem value="total">Total Clicks Only</MenuItem>
              <MenuItem value="both">Total + Unique Clicks</MenuItem>
            </Select>
          </FormControl>

          {zoomLevel !== 1 && (
            <Chip
              label={`Zoom: ${Math.round(zoomLevel * 100)}%`}
              size="small"
              onDelete={() => setZoomLevel(1)}
              color="primary"
              variant="outlined"
            />
          )}
        </Box>
      )}

      {/* Statistics */}
      {stats && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <Chip
            label={`Total: ${stats.totalClicks.toLocaleString()}`}
            color="primary"
            variant="outlined"
          />
          <Chip
            label={`Unique: ${stats.totalUniqueClicks.toLocaleString()}`}
            color="secondary"
            variant="outlined"
          />
          <Chip
            label={`Avg: ${Math.round(stats.avgClicks)}/day`}
            color="info"
            variant="outlined"
          />
          {stats.peakDay && (
            <Chip
              label={`Peak: ${stats.maxClicks} on ${new Date(stats.peakDay.date).toLocaleDateString()}`}
              color="success"
              variant="outlined"
            />
          )}
        </Box>
      )}

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

      {/* Footer info for fullscreen */}
      {isFullscreen && (
        <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Press ESC or click the fullscreen button to exit fullscreen mode
          </Typography>
        </Box>
      )}
    </Paper>
  );
};