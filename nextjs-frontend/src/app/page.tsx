'use client';

import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Typography,
  Stack,
  Card,
  CardContent,
  Chip,
} from '@mui/material';
import { Button } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import {
  Link as LinkIcon,
  Analytics,
  QrCode,
  Security,
  Speed,
  Devices,
} from '@mui/icons-material';

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuth();

  const handleGetStarted = () => {
    if (isAuthenticated) {
      router.push('/dashboard');
    } else {
      router.push('/register');
    }
  };

  const handleSignIn = () => {
    router.push('/login');
  };

  const features = [
    {
      icon: <LinkIcon sx={{ fontSize: 40 }} />,
      title: 'URL Shortening',
      description: 'Create short, memorable links from long URLs instantly',
    },
    {
      icon: <Analytics sx={{ fontSize: 40 }} />,
      title: 'Analytics',
      description: 'Track clicks, geographic data, and referrer information',
    },
    {
      icon: <QrCode sx={{ fontSize: 40 }} />,
      title: 'QR Codes',
      description: 'Generate QR codes for your shortened URLs automatically',
    },
    {
      icon: <Security sx={{ fontSize: 40 }} />,
      title: 'Secure',
      description: 'Password protection and expiration dates for your links',
    },
    {
      icon: <Speed sx={{ fontSize: 40 }} />,
      title: 'Fast',
      description: 'Lightning-fast redirects with global CDN distribution',
    },
    {
      icon: <Devices sx={{ fontSize: 40 }} />,
      title: 'Responsive',
      description: 'Works perfectly on desktop, tablet, and mobile devices',
    },
  ];

  return (
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
            <Typography variant="h5" component="h1" fontWeight="bold">
              SnapURL
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <ThemeToggle />
              {isAuthenticated ? (
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography variant="body2">
                    Welcome, {user?.name || user?.email}
                  </Typography>
                  <Button variant="contained" onClick={() => router.push('/dashboard')}>
                    Dashboard
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={2}>
                  <Button variant="outlined" onClick={handleSignIn}>
                    Sign In
                  </Button>
                  <Button variant="contained" onClick={handleGetStarted}>
                    Get Started
                  </Button>
                </Stack>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Hero Section */}
      <Box
        sx={{
          background: (theme) =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
              : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
          py: 8,
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={4} alignItems="center" textAlign="center">
            <Typography
              variant="h2"
              component="h1"
              fontWeight="bold"
              sx={{
                background: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(45deg, #60a5fa, #a78bfa)'
                    : 'linear-gradient(45deg, #3b82f6, #8b5cf6)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              }}
            >
              Shorten URLs with Style
            </Typography>

            <Typography
              variant="h5"
              color="text.secondary"
              sx={{ maxWidth: 600 }}
            >
              Create short, memorable links and track their performance with our
              powerful URL shortening service.
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center">
              <Chip label="Free Forever" color="success" />
              <Chip label="No Registration Required" color="info" />
              <Chip label="Analytics Included" color="primary" />
            </Stack>

            <Stack direction="row" spacing={3} sx={{ mt: 4 }}>
              <Button
                variant="contained"
                size="large"
                onClick={handleGetStarted}
              >
                {isAuthenticated ? 'Go to Dashboard' : 'Start Shortening'}
              </Button>
              {!isAuthenticated && (
                <Button
                  variant="outlined"
                  size="large"
                  onClick={handleSignIn}
                >
                  Sign In
                </Button>
              )}
            </Stack>
          </Stack>
        </Container>
      </Box>

      {/* Features Section */}
      <Container maxWidth="lg" sx={{ py: 8 }}>
        <Stack spacing={6}>
          <Box textAlign="center">
            <Typography variant="h3" component="h2" gutterBottom>
              Why Choose SnapURL?
            </Typography>
            <Typography variant="h6" color="text.secondary">
              Everything you need to manage your links effectively
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                md: 'repeat(2, 1fr)',
                lg: 'repeat(3, 1fr)',
              },
              gap: 4,
            }}
          >
            {features.map((feature, index) => (
              <Box key={index}>
                <Card
                  sx={{
                    height: '100%',
                    transition: 'transform 0.2s ease-in-out',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                    },
                  }}
                >
                  <CardContent sx={{ textAlign: 'center', p: 3 }}>
                    <Box sx={{ color: 'primary.main', mb: 2 }}>
                      {feature.icon}
                    </Box>
                    <Typography variant="h6" gutterBottom>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {feature.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Box>
            ))}
          </Box>
        </Stack>
      </Container>

      {/* CTA Section */}
      <Box
        sx={{
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          py: 6,
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={3} alignItems="center" textAlign="center">
            <Typography variant="h4" component="h2">
              Ready to Get Started?
            </Typography>
            <Typography variant="h6" sx={{ opacity: 0.9 }}>
              Join thousands of users who trust SnapURL for their link management needs.
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handleGetStarted}
              sx={{
                bgcolor: 'background.paper',
                color: 'text.primary',
                '&:hover': {
                  bgcolor: 'grey.100',
                },
              }}
            >
              {isAuthenticated ? 'Go to Dashboard' : 'Create Your Account'}
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          py: 4,
        }}
      >
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems="center"
            spacing={2}
          >
            <Typography variant="body2" color="text.secondary">
              © 2024 SnapURL. Built with Next.js and Material-UI.
            </Typography>
            <Stack direction="row" spacing={3}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
              >
                Privacy Policy
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
              >
                Terms of Service
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
              >
                Contact
              </Typography>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}