'use client';

import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Avatar,
  Stack,
} from '@mui/material';
import {
  People,
  Link as LinkIcon,
  Analytics,
  TrendingUp,
  Speed,
  Storage,
} from '@mui/icons-material';
import type { DashboardStats } from '@/lib/api/admin';

interface AdminDashboardStatsProps {
  stats: DashboardStats | null;
}

export function AdminDashboardStats({ stats }: AdminDashboardStatsProps) {
  if (!stats) {
    return null;
  }

  const statCards = [
    {
      title: 'Total Users',
      value: stats.users.total.toLocaleString(),
      change: `+${stats.users.newThisMonth} this month`,
      icon: <People />,
      color: 'primary.main',
      bgColor: 'primary.light',
    },
    {
      title: 'Total URLs',
      value: stats.urls.total.toLocaleString(),
      change: `+${stats.urls.createdThisMonth} this month`,
      icon: <LinkIcon />,
      color: 'secondary.main',
      bgColor: 'secondary.light',
    },
    {
      title: 'Total Clicks',
      value: stats.urls.totalClicks.toLocaleString(),
      change: `${stats.analytics.clicksToday} today`,
      icon: <Analytics />,
      color: 'success.main',
      bgColor: 'success.light',
    },
    {
      title: 'Cache Hit Rate',
      value: `${stats.system.cacheHitRate.toFixed(1)}%`,
      change: `${stats.system.avgResponseTime}ms avg response`,
      icon: <Speed />,
      color: 'info.main',
      bgColor: 'info.light',
    },
  ];

  return (
    <Grid container spacing={3}>
      {statCards.map((stat, index) => (
        <Grid item xs={12} sm={6} md={3} key={index}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Avatar
                  sx={{
                    bgcolor: stat.bgColor,
                    color: stat.color,
                    width: 56,
                    height: 56,
                  }}
                >
                  {stat.icon}
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>
                  <Typography variant="h4" component="div" fontWeight="bold">
                    {stat.value}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {stat.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {stat.change}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}