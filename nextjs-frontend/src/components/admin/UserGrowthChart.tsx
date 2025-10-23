'use client';

import {
  Card,
  CardContent,
  Typography,
  Box,
  FormControl,
  Select,
  MenuItem,
} from '@mui/material';
import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export function UserGrowthChart() {
  const [timeRange, setTimeRange] = useState('30d');

  // Mock data - in real app, this would come from API
  const data = [
    { date: '2024-01-01', users: 120, urls: 450, clicks: 2300 },
    { date: '2024-01-02', users: 125, urls: 480, clicks: 2450 },
    { date: '2024-01-03', users: 130, urls: 520, clicks: 2600 },
    { date: '2024-01-04', users: 128, urls: 510, clicks: 2550 },
    { date: '2024-01-05', users: 135, urls: 560, clicks: 2800 },
    { date: '2024-01-06', users: 142, urls: 590, clicks: 2950 },
    { date: '2024-01-07', users: 148, urls: 620, clicks: 3100 },
    { date: '2024-01-08', users: 155, urls: 650, clicks: 3250 },
    { date: '2024-01-09', users: 160, urls: 680, clicks: 3400 },
    { date: '2024-01-10', users: 165, urls: 710, clicks: 3550 },
    { date: '2024-01-11', users: 172, urls: 740, clicks: 3700 },
    { date: '2024-01-12', users: 178, urls: 770, clicks: 3850 },
    { date: '2024-01-13', users: 185, urls: 800, clicks: 4000 },
    { date: '2024-01-14', users: 190, urls: 830, clicks: 4150 },
    { date: '2024-01-15', users: 195, urls: 860, clicks: 4300 },
  ];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatTooltipValue = (value: number, name: string) => {
    if (name === 'clicks') {
      return [value.toLocaleString(), 'Total Clicks'];
    }
    if (name === 'urls') {
      return [value.toLocaleString(), 'URLs Created'];
    }
    if (name === 'users') {
      return [value.toLocaleString(), 'New Users'];
    }
    return [value, name];
  };

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Typography variant="h6" gutterBottom>
              Growth Analytics
            </Typography>
            <Typography variant="body2" color="text.secondary">
              User registration, URL creation, and click trends
            </Typography>
          </Box>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
            >
              <MenuItem value="7d">Last 7 days</MenuItem>
              <MenuItem value="30d">Last 30 days</MenuItem>
              <MenuItem value="90d">Last 90 days</MenuItem>
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#666"
                fontSize={12}
              />
              <YAxis stroke="#666" fontSize={12} />
              <Tooltip
                formatter={formatTooltipValue}
                labelFormatter={(label) => `Date: ${formatDate(label)}`}
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="users"
                stroke="#1976d2"
                strokeWidth={2}
                dot={{ fill: '#1976d2', strokeWidth: 2, r: 4 }}
                name="New Users"
              />
              <Line
                type="monotone"
                dataKey="urls"
                stroke="#9c27b0"
                strokeWidth={2}
                dot={{ fill: '#9c27b0', strokeWidth: 2, r: 4 }}
                name="URLs Created"
              />
              <Line
                type="monotone"
                dataKey="clicks"
                stroke="#2e7d32"
                strokeWidth={2}
                dot={{ fill: '#2e7d32', strokeWidth: 2, r: 4 }}
                name="Total Clicks"
              />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  );
}