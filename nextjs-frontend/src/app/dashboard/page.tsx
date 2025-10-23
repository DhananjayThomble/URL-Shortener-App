'use client';

import { useState } from 'react';
import { Box, Container, Grid, Tabs, Tab } from '@mui/material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { AuthenticatedLayout } from '@/components/layout/AuthenticatedLayout';
import { 
  DashboardOverview, 
  RecentActivityFeed, 
  TopPerformingUrls, 
  DashboardStats,
  UrlManagementDashboard,
  QuickUrlWidget,
  DashboardShortcuts
} from '@/components/dashboard';
import { LiveMetricsWidget } from '@/components/analytics';
import { UrlShortener } from '@/components/url';

type DashboardTab = 'overview' | 'urls' | 'analytics' | 'shortcuts';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');

  const handleCreateUrl = () => {
    setActiveTab('urls');
  };

  const handleViewAnalytics = () => {
    setActiveTab('analytics');
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: DashboardTab) => {
    setActiveTab(newValue);
  };

  return (
    <AuthGuard requireAuth={true}>
      <AuthenticatedLayout>
        <Container maxWidth="xl" sx={{ py: 3 }}>
          {/* Dashboard Tabs */}
          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
            <Tabs value={activeTab} onChange={handleTabChange}>
              <Tab label="Overview" value="overview" />
              <Tab label="URL Management" value="urls" />
              <Tab label="Analytics" value="analytics" />
              <Tab label="Quick Actions" value="shortcuts" />
            </Tabs>
          </Box>

          {/* Tab Content */}
          {activeTab === 'overview' && (
            <Grid container spacing={3}>
              {/* Quick URL Widget */}
              <Grid item xs={12} md={6} lg={4}>
                <QuickUrlWidget
                  showAdvanced={true}
                  onSuccess={() => {
                    // Refresh dashboard data
                    console.log('URL created successfully');
                  }}
                />
              </Grid>

              {/* Live Metrics Widget */}
              <Grid item xs={12} md={6} lg={4}>
                <LiveMetricsWidget
                  urlId="sample-url-id" // This would be dynamic
                  compact={true}
                  autoRefresh={true}
                />
              </Grid>

              {/* Dashboard Stats */}
              <Grid item xs={12} lg={4}>
                <DashboardStats
                  title="Quick Stats"
                  subtitle="Key performance indicators"
                  compact={true}
                />
              </Grid>

              {/* Top Performing URLs */}
              <Grid item xs={12} lg={8}>
                <TopPerformingUrls
                  maxItems={5}
                  onViewAnalytics={handleViewAnalytics}
                  onViewAll={() => setActiveTab('urls')}
                />
              </Grid>

              {/* Recent Activity Feed */}
              <Grid item xs={12} lg={4}>
                <RecentActivityFeed
                  maxItems={8}
                  onRefresh={() => console.log('Refresh activity')}
                  onViewAll={() => console.log('View all activity')}
                />
              </Grid>
            </Grid>
          )}

          {activeTab === 'urls' && (
            <UrlManagementDashboard />
          )}

          {activeTab === 'analytics' && (
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <DashboardOverview
                  onCreateUrl={handleCreateUrl}
                  onViewAnalytics={handleViewAnalytics}
                />
              </Grid>
            </Grid>
          )}

          {activeTab === 'shortcuts' && (
            <DashboardShortcuts
              onCreateUrl={() => setActiveTab('urls')}
              onViewAnalytics={() => setActiveTab('analytics')}
              onGenerateQR={() => console.log('Generate QR')}
              onExportData={() => console.log('Export data')}
              onViewSettings={() => console.log('View settings')}
              onViewHelp={() => console.log('View help')}
            />
          )}
        </Container>
      </AuthenticatedLayout>
    </AuthGuard>
  );
}