'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { Box, Typography, List, ListItem, ListItemText, Chip } from '@mui/material';
import type { CountryData } from '@/types/analytics';

interface GeographicChartProps {
  data: CountryData[];
  showChart?: boolean;
  maxItems?: number;
  height?: number;
  className?: string;
}

export const GeographicChart: React.FC<GeographicChartProps> = ({
  data,
  showChart = true,
  maxItems = 5,
  height = 300,
  className,
}) => {
  const theme = useTheme();

  // Prepare data for chart
  const chartData = data.slice(0, maxItems).map((item, index) => ({
    ...item,
    name: item.country,
    value: item.clicks,
    color: getColor(index),
  }));

  // Generate colors for pie chart
  function getColor(index: number): string {
    const colors = [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.info.main,
      theme.palette.error.main,
    ];
    return colors[index % colors.length];
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
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
            {data.country}
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

  // Custom label for pie chart
  const renderLabel = (entry: any) => {
    return `${entry.percentage.toFixed(1)}%`;
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
        <Typography variant="body2">No geographic data available</Typography>
      </Box>
    );
  }

  return (
    <Box className={className}>
      {showChart && chartData.length > 0 && (
        <Box sx={{ height: height * 0.6, mb: 2 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={renderLabel}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      )}

      {/* Country List */}
      <List dense sx={{ maxHeight: showChart ? height * 0.4 : height, overflow: 'auto' }}>
        {data.slice(0, maxItems).map((country, index) => (
          <ListItem
            key={country.countryCode}
            sx={{
              px: 0,
              py: 0.5,
              borderLeft: 4,
              borderColor: getColor(index),
              borderStyle: 'solid',
              mb: 0.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="medium">
                    {country.country}
                  </Typography>
                  <Chip
                    label={country.clicks.toLocaleString()}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 1 }}
                  />
                </Box>
              }
              secondary={
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {country.countryCode}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {country.percentage.toFixed(1)}%
                  </Typography>
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>

      {data.length > maxItems && (
        <Box sx={{ mt: 1, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            +{data.length - maxItems} more countries
          </Typography>
        </Box>
      )}
    </Box>
  );
};