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
  Stack,
  Chip,
  Divider,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  TrendingFlat,
  CompareArrows,
} from '@mui/icons-material';
import { ClickChart } from './ClickChart';
import type { ClicksByDate } from '@/types/analytics';

interface ChartComparisonProps {
  currentData: ClicksByDate[];
  previousData?: ClicksByDate[];
  currentLabel?: string;
  previousLabel?: string;
  period: '24h' | '7d' | '30d' | '90d' | 'custom';
  className?: string;
}

export const ChartComparison: React.FC<ChartComparisonProps> = ({
  currentData,
  previousData,
  currentLabel = 'Current Period',
  previousLabel = 'Previous Period',
  period,
  className,
}) => {
  const [chartType, setChartType] = useState<'line' | 'bar' | 'area'>('line');
  const [showComparison, setShowComparison] = useState(!!previousData);
  const [comparisonMode, setComparisonMode] = useState<'overlay' | 'side-by-side'>('overlay');

  // Calculate comparison metrics
  const comparisonMetrics = useMemo(() => {
    if (!currentData || !previousData) return null;

    const currentTotal = currentData.reduce((sum, day) => sum + day.clicks, 0);
    const previousTotal = previousData.reduce((sum, day) => sum + day.clicks, 0);
    
    const currentUnique = currentData.reduce((sum, day) => sum + day.uniqueClicks, 0);
    const previousUnique = previousData.reduce((sum, day) => sum + day.uniqueClicks, 0);

    const clicksChange = previousTotal > 0 ? ((currentTotal - previousTotal) / previousTotal) * 100 : 0;
    const uniqueChange = previousUnique > 0 ? ((currentUnique - previousUnique) / previousUnique) * 100 : 0;

    const currentAvg = currentTotal / currentData.length;
    const previousAvg = previousTotal / previousData.length;
    const avgChange = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg) * 100 : 0;

    return {
      currentTotal,
      previousTotal,
      currentUnique,
      previousUnique,
      clicksChange,
      uniqueChange,
      avgChange,
      currentAvg,
      previousAvg,
    };
  }, [currentData, previousData]);

  // Prepare combined data for overlay mode
  const combinedData = useMemo(() => {
    if (!showComparison || !previousData || comparisonMode !== 'overlay') {
      return currentData;
    }

    // Align data by index (assuming same length)
    return currentData.map((current, index) => ({
      ...current,
      previousClicks: previousData[index]?.clicks || 0,
      previousUniqueClicks: previousData[index]?.uniqueClicks || 0,
    }));
  }, [currentData, previousData, showComparison, comparisonMode]);

  const getTrendIcon = (change: number) => {
    if (change > 5) return <TrendingUp color="success" />;
    if (change < -5) return <TrendingDown color="error" />;
    return <TrendingFlat color="warning" />;
  };

  const getTrendColor = (change: number) => {
    if (change > 5) return 'success.main';
    if (change < -5) return 'error.main';
    return 'warning.main';
  };

  return (
    <Card className={className}>
      <CardContent sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6" component="h3" fontWeight="bold">
            Analytics Comparison
          </Typography>
          
          <Stack direction="row" spacing={2} alignItems="center">
            {previousData && (
              <FormControlLabel
                control={
                  <Switch
                    checked={showComparison}
                    onChange={(e) => setShowComparison(e.target.checked)}
                  />
                }
                label="Show Comparison"
              />
            )}
            
            {showComparison && previousData && (
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel>View Mode</InputLabel>
                <Select
                  value={comparisonMode}
                  label="View Mode"
                  onChange={(e) => setComparisonMode(e.target.value as any)}
                >
                  <MenuItem value="overlay">Overlay</MenuItem>
                  <MenuItem value="side-by-side">Side by Side</MenuItem>
                </Select>
              </FormControl>
            )}

            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Chart Type</InputLabel>
              <Select
                value={chartType}
                label="Chart Type"
                onChange={(e) => setChartType(e.target.value as any)}
              >
                <MenuItem value="line">Line</MenuItem>
                <MenuItem value="area">Area</MenuItem>
                <MenuItem value="bar">Bar</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </Box>

        {/* Comparison Metrics */}
        {showComparison && comparisonMetrics && (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <CompareArrows sx={{ mr: 1, color: 'text.secondary' }} />
              <Typography variant="subtitle2" color="text.secondary">
                {currentLabel} vs {previousLabel}
              </Typography>
            </Box>
            
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
              gap: 2 
            }}>
              <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                  {getTrendIcon(comparisonMetrics.clicksChange)}
                  <Typography 
                    variant="h6" 
                    color={getTrendColor(comparisonMetrics.clicksChange)}
                    fontWeight="bold"
                    sx={{ ml: 1 }}
                  >
                    {comparisonMetrics.clicksChange >= 0 ? '+' : ''}{comparisonMetrics.clicksChange.toFixed(1)}%
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Total Clicks Change
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {comparisonMetrics.currentTotal.toLocaleString()} vs {comparisonMetrics.previousTotal.toLocaleString()}
                </Typography>
              </Box>

              <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                  {getTrendIcon(comparisonMetrics.uniqueChange)}
                  <Typography 
                    variant="h6" 
                    color={getTrendColor(comparisonMetrics.uniqueChange)}
                    fontWeight="bold"
                    sx={{ ml: 1 }}
                  >
                    {comparisonMetrics.uniqueChange >= 0 ? '+' : ''}{comparisonMetrics.uniqueChange.toFixed(1)}%
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Unique Clicks Change
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {comparisonMetrics.currentUnique.toLocaleString()} vs {comparisonMetrics.previousUnique.toLocaleString()}
                </Typography>
              </Box>

              <Box sx={{ textAlign: 'center', p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1 }}>
                  {getTrendIcon(comparisonMetrics.avgChange)}
                  <Typography 
                    variant="h6" 
                    color={getTrendColor(comparisonMetrics.avgChange)}
                    fontWeight="bold"
                    sx={{ ml: 1 }}
                  >
                    {comparisonMetrics.avgChange >= 0 ? '+' : ''}{comparisonMetrics.avgChange.toFixed(1)}%
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Daily Average Change
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {Math.round(comparisonMetrics.currentAvg)} vs {Math.round(comparisonMetrics.previousAvg)}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        {/* Charts */}
        {comparisonMode === 'side-by-side' && showComparison && previousData ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 3 }}>
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <Chip label={currentLabel} color="primary" size="small" sx={{ mr: 1 }} />
              </Typography>
              <ClickChart
                data={currentData}
                type={chartType}
                period={period}
                height={300}
              />
            </Box>
            
            <Box>
              <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center' }}>
                <Chip label={previousLabel} color="secondary" size="small" sx={{ mr: 1 }} />
              </Typography>
              <ClickChart
                data={previousData}
                type={chartType}
                period={period}
                height={300}
              />
            </Box>
          </Box>
        ) : (
          <Box>
            {showComparison && previousData && (
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Chip label={currentLabel} color="primary" size="small" sx={{ mr: 1 }} />
                <Chip label={previousLabel} color="secondary" size="small" />
              </Box>
            )}
            <ClickChart
              data={combinedData}
              type={chartType}
              period={period}
              height={400}
              showUniqueClicks={true}
            />
          </Box>
        )}

        {/* Legend */}
        {showComparison && comparisonMode === 'overlay' && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary" gutterBottom display="block">
              Chart Legend:
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ width: 16, height: 3, bgcolor: 'primary.main', mr: 1 }} />
                <Typography variant="caption">{currentLabel} - Total Clicks</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ width: 16, height: 3, bgcolor: 'secondary.main', mr: 1 }} />
                <Typography variant="caption">{currentLabel} - Unique Clicks</Typography>
              </Box>
              {previousData && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 16, height: 3, bgcolor: 'primary.main', opacity: 0.5, mr: 1 }} />
                    <Typography variant="caption">{previousLabel} - Total Clicks</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ width: 16, height: 3, bgcolor: 'secondary.main', opacity: 0.5, mr: 1 }} />
                    <Typography variant="caption">{previousLabel} - Unique Clicks</Typography>
                  </Box>
                </>
              )}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};