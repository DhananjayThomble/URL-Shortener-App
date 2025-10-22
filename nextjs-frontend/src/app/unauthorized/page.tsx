'use client';

import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Paper,
  Typography,
  Stack,
} from '@mui/material';
import { Button } from '@/components/ui';
import { Lock, ArrowBack, Home } from '@mui/icons-material';

export default function UnauthorizedPage() {
  const router = useRouter();

  const handleGoBack = () => {
    router.back();
  };

  const handleGoHome = () => {
    router.push('/');
  };

  const handleLogin = () => {
    router.push('/login');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: (theme) => 
          theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
            : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        py: 4,
      }}
    >
      <Container maxWidth="sm">
        <Paper
          elevation={0}
          sx={{
            p: 4,
            borderRadius: 3,
            textAlign: 'center',
            boxShadow: (theme) =>
              theme.palette.mode === 'dark'
                ? '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
                : '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            border: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Stack spacing={3} alignItems="center">
            <Lock sx={{ fontSize: 80, color: 'error.main' }} />
            
            <Box>
              <Typography variant="h4" component="h1" gutterBottom>
                Access Denied
              </Typography>
              <Typography variant="h6" color="error.main" gutterBottom>
                403 - Unauthorized
              </Typography>
            </Box>

            <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 400 }}>
              You don't have permission to access this page. This could be because:
            </Typography>

            <Box sx={{ textAlign: 'left', maxWidth: 400 }}>
              <Typography variant="body2" color="text.secondary" component="ul" sx={{ pl: 2 }}>
                <li>You need to be logged in to access this content</li>
                <li>Your account doesn't have the required permissions</li>
                <li>This page is restricted to administrators only</li>
                <li>Your session may have expired</li>
              </Typography>
            </Box>

            <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} sx={{ width: '100%', maxWidth: 400 }}>
              <Button
                variant="outlined"
                startIcon={<ArrowBack />}
                onClick={handleGoBack}
                fullWidth
              >
                Go Back
              </Button>
              <Button
                variant="outlined"
                startIcon={<Home />}
                onClick={handleGoHome}
                fullWidth
              >
                Home
              </Button>
              <Button
                variant="contained"
                onClick={handleLogin}
                fullWidth
              >
                Sign In
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}