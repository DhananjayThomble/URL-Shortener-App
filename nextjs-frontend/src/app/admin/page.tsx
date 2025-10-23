'use client';

import { useEffect, useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Alert,
  Skeleton,
} from '@mui/material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminLayout } from '@/components/layout/AdminLayout';
import {
  AdminDashboardStats,
  SystemHealthWidget,
  RecentActivityWidget,
  UserGrowthChart,
  TopCountriesWidget,
} from '@/components/admin';
import { adminAPI, type DashboardStats, type SystemHealth } from '@/lib/api/admin';

export default function AdminDashboardPage() {
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setIsLoading(true);
        const [statsResponse, healthResponse] = await Promise.all([
          adminAPI.getDashboardStats(),
          adminAPI.getSystemHealth(),
        ]);

        setDashboardStats(statsResponse.data);
        setSystemHealth(healthResponse.data);
      } catch (err: any) {
        console.error('Failed to fetch dashboard data:', err);
        setError(err.response?.data?.message || 'Failed to load dashboard data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();

    // Set up auto-refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <AuthGuard requireAuth={true} requiredRole="admin">
        <AdminLayout>
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        </AdminLayout>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard requireAuth={true} requiredRole="admin">
      <AdminLayout>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Admin Dashboard
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
            System overview and key performance indicators
          </Typography>

          <Grid container spacing={3}>
            {/* Dashboard Stats */}
            <Grid item xs={12}>
              {isLoading ? (
                <Skeleton variant="rectangular" height={200} />
              ) : (
                <AdminDashboardStats stats={dashboardStats} />
              )}
            </Grid>

            {/* System Health */}
            <Grid item xs={12} md={6}>
              {isLoading ? (
                <Skeleton variant="rectangular" height={300} />
              ) : (
                <SystemHealthWidget health={systemHealth} />
              )}
            </Grid>

            {/* Recent Activity */}
            <Grid item xs={12} md={6}>
              {isLoading ? (
                <Skeleton variant="rectangular" height={300} />
              ) : (
                <RecentActivityWidget />
              )}
            </Grid>

            {/* User Growth Chart */}
            <Grid item xs={12} lg={8}>
              {isLoading ? (
                <Skeleton variant="rectangular" height={400} />
              ) : (
                <UserGrowthChart />
              )}
            </Grid>

            {/* Top Countries */}
            <Grid item xs={12} lg={4}>
              {isLoading ? (
                <Skeleton variant="rectangular" height={400} />
              ) : (
                <TopCountriesWidget countries={dashboardStats?.analytics.topCountries || []} />
              )}
            </Grid>
          </Grid>
        </Box>
      </AdminLayout>
    </AuthGuard>
  );
}