'use client';

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { Box, Typography } from '@mui/material';
import type { ClicksByDate } from '@/types/analytics';

interface ClickChartProps {
  data: ClicksByDate[];
  type?: 'line' | 'bar' | 'area';
  period: '24h' | '7d' | '30d' | '90d' | 'custom';
  showUniqueClicks?: boolean;
  height?: number;
  className?: string;
}

export const ClickChart: React.FC<ClickChartProps> = ({
  data,
  type = 'line',
  period,
  showUniqueClicks = true,
  height = 300,
  className,
}) => {
  const theme = useTheme();

  // Format data for the chart
  const chartData = useMemo(() => {
    return data.map(item => ({
      ...item,
      date: formatDate(item.date, period),
    }));
  }, [data, period]);

  // Format date based on period
  function formatDate(dateString: string, period: string): string {
    const date = new Date(dateString);
    
    switch (period) {
      case '24h':
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      case '7d':
        return date.toLocaleDateString('en-US', { 
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });
      case '30d':
      case '90d':
        return date.toLocaleDateString('en-US', { 
          month: 'short',
          day: 'numeric'
        });
      default:
        return date.toLocaleDateString('en-US', { 
          month: 'short',
          day: 'numeric'
        });
    }
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <Box
          sx={{
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            p: 1.5,
            boxShadow: 2,
          }}
        >
          <Typography variant="body2" fontWeight="medium" gutterBottom>
            {label}
          </Typography>
          {payload.map((entry: any, index: number) => (
            <Typography
              key={index}
              variant="body2"
              sx={{ color: entry.color }}
            >
              {entry.name}: {entry.value.toLocaleString()}
            </Typography>
          ))}
        </Box>
      );
    }
    return null;
  };

  // Chart colors
  const colors = {
    totalClicks: theme.palette.primary.main,
    uniqueClicks: theme.palette.secondary.main,
    grid: theme.palette.divider,
    text: theme.palette.text.secondary,
  };

  // Common chart props
  const commonProps = {
    data: chartData,
    margin: { top: 5, right: 30, left: 20, bottom: 5 },
  };

  const renderChart = () => {
    switch (type) {
      case 'area':
        return (
          <AreaChart {...commonProps}>
            <defs>
              <linearGradient id="totalClicksGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.totalClicks} stopOpacity={0.3} />
                <stop offset="95%" stopColor={colors.totalClicks} stopOpacity={0} />
              </linearGradient>
              {showUniqueClicks && (
                <linearGradient id="uniqueClicksGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.uniqueClicks} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.uniqueClicks} stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis 
              dataKey="date" 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="clicks"
              name="Total Clicks"
              stroke={colors.totalClicks}
              fillOpacity={1}
              fill="url(#totalClicksGradient)"
              strokeWidth={2}
            />
            {showUniqueClicks && (
              <Area
                type="monotone"
                dataKey="uniqueClicks"
                name="Unique Clicks"
                stroke={colors.uniqueClicks}
                fillOpacity={1}
                fill="url(#uniqueClicksGradient)"
                strokeWidth={2}
              />
            )}
          </AreaChart>
        );

      case 'bar':
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis 
              dataKey="date" 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar
              dataKey="clicks"
              name="Total Clicks"
              fill={colors.totalClicks}
              radius={[2, 2, 0, 0]}
            />
            {showUniqueClicks && (
              <Bar
                dataKey="uniqueClicks"
                name="Unique Clicks"
                fill={colors.uniqueClicks}
                radius={[2, 2, 0, 0]}
              />
            )}
          </BarChart>
        );

      default: // line
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
            <XAxis 
              dataKey="date" 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              stroke={colors.text}
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey="clicks"
              name="Total Clicks"
              stroke={colors.totalClicks}
              strokeWidth={3}
              dot={{ fill: colors.totalClicks, strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: colors.totalClicks, strokeWidth: 2 }}
            />
            {showUniqueClicks && (
              <Line
                type="monotone"
                dataKey="uniqueClicks"
                name="Unique Clicks"
                stroke={colors.uniqueClicks}
                strokeWidth={3}
                dot={{ fill: colors.uniqueClicks, strokeWidth: 2, r: 4 }}
                activeDot={{ r: 6, stroke: colors.uniqueClicks, strokeWidth: 2 }}
                strokeDasharray="5 5"
              />
            )}
          </LineChart>
        );
    }
  };

  if (!data || data.length === 0) {
    return (
      <Box
        className={className}
        sx={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">No data available</Typography>
      </Box>
    );
  }

  return (
    <Box className={className} sx={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </Box>
  );
};