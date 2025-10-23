'use client';

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Skeleton,
} from '@mui/material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { AdminDashboardStats } from '@/components/admin/AdminDashboardStats';
import { UserGrowthChart } from '@/components/admin/UserGrowthChart';
import { TopCountriesWidget } from '@/components/admin/TopCountriesWidget';
import { adminAPI, type DashboardStats } from '@/lib/api/admin';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

export default function SystemAnalyticsPage() {
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('30d');
  const [error, setError] = useState<string | null>(null);

  const fetchAnalyticsData = async () => {
    try {
      setLoading(true);
      const [analyticsResponse, statsResponse] = await Promise.all([
        adminAPI.getAnalyticsOverview(),
        adminAPI.getDashboardStats(),
      ]);

      setAnalyticsData(analyticsResponse.data);
      setDashboardStats(statsResponse.data);
    } catch (err: any) {
      console.error('Failed to fetch analytics data:', err);
      setError(err.response?.data?.message || 'Failed to load analytics data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
  }, [timeRange]);

  // Mock data for additional charts
  const urlCreationData = [
    { month: 'Jan', urls: 120, clicks: 2400 },
    { month: 'Feb', urls: 190, clicks: 3200 },
    { month: 'Mar', urls: 300, clicks: 4800 },
    { month: 'Apr', urls: 280, clicks: 4200 },
    { month: 'May', urls: 350, clicks: 5600 },
    { month: 'Jun', urls: 420, clicks: 6800 },
  ];

  const deviceData = [
    { name: 'Desktop', value: 45, color: '#1976d2' },
    { name: 'Mobile', value: 35, color: '#9c27b0' },
    { name: 'Tablet', value: 20, color: '#2e7d32' },
  ];

  const browserData = [
    { name: 'Chrome', value: 60, color: '#4285f4' },
    { name: 'Firefox', value: 20, color: '#ff9500' },
    { name: 'Safari', value: 15, color: '#007aff' },
    { name: 'Edge', value: 5, color: '#0078d4' },
  ];

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                System Analytics
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Comprehensive analytics and performance metrics
              </Typography>
            </Box>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Time Range</InputLabel>
              <Select
                value={timeRange}
                label="Time Range"
                onChange={(e) => setTimeRange(e.target.value)}
              >
                <MenuItem value="7d">Last 7 days</MenuItem>
                <MenuItem value="30d">Last 30 days</MenuItem>
                <MenuItem value="90d">Last 90 days</MenuItem>
                <MenuItem value="1y">Last year</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Grid container spacing={3}>
            {/* Overview Stats */}
            <Grid item xs={12}>
              {loading ? (
                <Skeleton variant="rectangular" height={200} />
              ) : (
                <AdminDashboardStats stats={dashboardStats} />
              )}
            </Grid>

            {/* User Growth Chart */}
            <Grid item xs={12} lg={8}>
              {loading ? (
                <Skeleton variant="rectangular" height={400} />
              ) : (
                <UserGrowthChart />
              )}
            </Grid>

            {/* Top Countries */}
            <Grid item xs={12} lg={4}>
              {loading ? (
                <Skeleton variant="rectangular" height={400} />
              ) : (
                <TopCountriesWidget countries={dashboardStats?.analytics.topCountries || []} />
              )}
            </Grid>

            {/* URL Creation vs Clicks */}
            <Grid item xs={12} lg={8}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    URL Creation vs Click Performance
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Monthly comparison of URL creation and total clicks
                  </Typography>
                  <Box sx={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart data={urlCreationData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="urls" fill="#1976d2" name="URLs Created" />
                        <Bar dataKey="clicks" fill="#9c27b0" name="Total Clicks" />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Device Distribution */}
            <Grid item xs={12} lg={4}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Device Distribution
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Click distribution by device type
                  </Typography>
                  <Box sx={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={deviceData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {deviceData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Browser Distribution */}
            <Grid item xs={12} lg={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Browser Distribution
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Click distribution by browser type
                  </Typography>
                  <Box sx={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={browserData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {browserData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Performance Metrics */}
            <Grid item xs={12} lg={6}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Performance Metrics
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    System performance indicators
                  </Typography>
                  
                  {loading ? (
                    <Skeleton variant="rectangular" height={200} />
                  ) : analyticsData ? (
                    <Box>
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          Cache Hit Rate
                        </Typography>
                        <Typography variant="h4" color="success.main">
                          {analyticsData.overview.cacheHitRate.toFixed(1)}%
                        </Typography>
                      </Box>
                      
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          Total Users
                        </Typography>
                        <Typography variant="h4" color="primary.main">
                          {analyticsData.overview.totalUsers.toLocaleString()}
                        </Typography>
                      </Box>
                      
                      <Box sx={{ mb: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          Total URLs
                        </Typography>
                        <Typography variant="h4" color="secondary.main">
                          {analyticsData.overview.totalUrls.toLocaleString()}
                        </Typography>
                      </Box>
                      
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          Total Clicks
                        </Typography>
                        <Typography variant="h4" color="info.main">
                          {analyticsData.overview.totalClicks.toLocaleString()}
                        </Typography>
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No performance data available
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>
      </AdminLayout>
    </AuthGuard>
  );
}