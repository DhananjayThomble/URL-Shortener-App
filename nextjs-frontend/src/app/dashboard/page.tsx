'use client';

import { Box, Container, Typography, Card, CardContent, Stack, Chip } from '@mui/material';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export default function DashboardPage() {
  const { user, logout, getDisplayName, getUserInitials } = useAuth();

  const handleLogout = () => {
    logout('/');
  };

  return (
    <AuthGuard requireAuth={true}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Header */}
        <Box
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            py: 2,
          }}
        >
          <Container maxWidth="lg">
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="h5" component="h1">
                SnapURL Dashboard
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center">
                <ThemeToggle />
                <Button variant="outlined" onClick={handleLogout}>
                  Sign Out
                </Button>
              </Stack>
            </Stack>
          </Container>
        </Box>

        {/* Main Content */}
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Stack spacing={4}>
            {/* Welcome Section */}
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h4" component="h2">
                    Welcome back, {getDisplayName()}!
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    You're successfully signed in to your SnapURL account.
                  </Typography>
                  
                  {/* User Info */}
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Chip 
                      label={`Email: ${user?.email}`} 
                      variant="outlined" 
                      size="small" 
                    />
                    <Chip 
                      label={`Role: ${user?.role || 'User'}`} 
                      variant="outlined" 
                      size="small" 
                    />
                    {user?.isEmailVerified !== undefined && (
                      <Chip 
                        label={user.isEmailVerified ? 'Email Verified' : 'Email Not Verified'} 
                        color={user.isEmailVerified ? 'success' : 'warning'}
                        variant="outlined" 
                        size="small" 
                      />
                    )}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            {/* Quick Stats */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    URLs Created
                  </Typography>
                  <Typography variant="h3" color="primary.main">
                    0
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Start creating short URLs
                  </Typography>
                </CardContent>
              </Card>

              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Total Clicks
                  </Typography>
                  <Typography variant="h3" color="success.main">
                    0
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Track your link performance
                  </Typography>
                </CardContent>
              </Card>

              <Card sx={{ flex: 1 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Active Links
                  </Typography>
                  <Typography variant="h3" color="info.main">
                    0
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Currently active URLs
                  </Typography>
                </CardContent>
              </Card>
            </Stack>

            {/* URL Shortener */}
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  URL Shortener
                </Typography>
                <Typography variant="body1" color="text.secondary" paragraph>
                  Create short URLs for easy sharing and tracking.
                </Typography>
                <Typography variant="body2" color="warning.main">
                  URL shortening functionality is being implemented. Please check back soon!
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Container>
      </Box>
    </AuthGuard>
  );
}