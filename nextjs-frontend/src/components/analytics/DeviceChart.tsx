'use client';

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { Box, Typography, LinearProgress } from '@mui/material';
import {
  PhoneAndroid,
  Computer,
  Tablet,
  Watch,
  DevicesOther,
} from '@mui/icons-material';
import type { DeviceData } from '@/types/analytics';

interface DeviceChartProps {
  data: DeviceData[];
  showChart?: boolean;
  height?: number;
  className?: string;
}

export const DeviceChart: React.FC<DeviceChartProps> = ({
  data,
  showChart = true,
  height = 250,
  className,
}) => {
  const theme = useTheme();

  // Get device icon
  const getDeviceIcon = (device: string) => {
    const deviceLower = device.toLowerCase();
    if (deviceLower.includes('mobile') || deviceLower.includes('phone')) {
      return <PhoneAndroid />;
    }
    if (deviceLower.includes('desktop') || deviceLower.includes('computer')) {
      return <Computer />;
    }
    if (deviceLower.includes('tablet')) {
      return <Tablet />;
    }
    if (deviceLower.includes('watch')) {
      return <Watch />;
    }
    return <DevicesOther />;
  };

  // Get device color
  const getDeviceColor = (device: string) => {
    const deviceLower = device.toLowerCase();
    if (deviceLower.includes('mobile') || deviceLower.includes('phone')) {
      return theme.palette.primary.main;
    }
    if (deviceLower.includes('desktop') || deviceLower.includes('computer')) {
      return theme.palette.secondary.main;
    }
    if (deviceLower.includes('tablet')) {
      return theme.palette.success.main;
    }
    if (deviceLower.includes('watch')) {
      return theme.palette.warning.main;
    }
    return theme.palette.info.main;
  };

  // Prepare data for chart
  const chartData = data.map(item => ({
    ...item,
    name: item.device,
    value: item.clicks,
    color: getDeviceColor(item.device),
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
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
          <Typography variant="body2" fontWeight="medium">
            {data.device}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Clicks: {data.clicks.toLocaleString()}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Percentage: {data.percentage.toFixed(1)}%
          </Typography>
        </Box>
      );
    }
    return null;
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
        <Typography variant="body2">No device data available</Typography>
      </Box>
    );
  }

  return (
    <Box className={className}>
      {showChart && (
        <Box sx={{ height: height * 0.6, mb: 2 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
              <XAxis 
                dataKey="name" 
                stroke={theme.palette.text.secondary}
                fontSize={12}
                tickLine={false}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                stroke={theme.palette.text.secondary}
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="value"
                fill={theme.palette.primary.main}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}

      {/* Device List */}
      <Box sx={{ maxHeight: showChart ? height * 0.4 : height, overflow: 'auto' }}>
        {data.map((device, index) => (
          <Box
            key={device.device}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              py: 1,
              px: 1,
              mb: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 1,
                  bgcolor: getDeviceColor(device.device),
                  color: 'white',
                  mr: 2,
                }}
              >
                {getDeviceIcon(device.device)}
              </Box>
              
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight="medium">
                  {device.device}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.5 }}>
                  <LinearProgress
                    variant="determinate"
                    value={device.percentage}
                    sx={{
                      flex: 1,
                      mr: 1,
                      height: 4,
                      borderRadius: 2,
                      bgcolor: 'action.selected',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getDeviceColor(device.device),
                      },
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40 }}>
                    {device.percentage.toFixed(1)}%
                  </Typography>
                </Box>
              </Box>
            </Box>

            <Typography variant="body2" fontWeight="medium" sx={{ ml: 2 }}>
              {device.clicks.toLocaleString()}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};