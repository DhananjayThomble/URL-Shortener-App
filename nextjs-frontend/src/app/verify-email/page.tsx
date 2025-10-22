'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Container,
  Paper,
  Typography,
  Alert,
  Stack,
  CircularProgress,
} from '@mui/material';
import { Button } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { CheckCircle, Error, Email } from '@mui/icons-material';

type VerificationStatus = 'verifying' | 'success' | 'error' | 'expired';

export default function VerifyEmailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyEmail, resendEmailVerification } = useAuth();
  const [status, setStatus] = useState<VerificationStatus>('verifying');
  const [error, setError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  // Get token from URL params
  const token = searchParams.get('token');

  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setStatus('error');
        setError('Invalid or missing verification token.');
        return;
      }

      try {
        await verifyEmail(token);
        setStatus('success');
      } catch (err: any) {
        setStatus('error');
        if (err.message?.includes('expired')) {
          setStatus('expired');
          setError('This verification link has expired. Please request a new one.');
        } else {
          setError(err.message || 'Email verification failed. Please try again.');
        }
      }
    };

    verifyToken();
  }, [token, verifyEmail]);

  const handleResendVerification = async () => {
    try {
      setIsResending(true);
      setError(null);
      await resendEmailVerification();
      setError(null);
      // Show success message
      alert('Verification email sent! Please check your inbox.');
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification email.');
    } finally {
      setIsResending(false);
    }
  };

  const handleContinue = () => {
    router.push('/login?message=Email%20verified%20successfully.%20Please%20sign%20in.');
  };

  const handleBackToLogin = () => {
    router.push('/login');
  };

  const renderContent = () => {
    switch (status) {
      case 'verifying':
        return (
          <Stack spacing={3} alignItems="center">
            <CircularProgress size={60} />
            <Typography variant="h5" textAlign="center">
              Verifying your email...
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Please wait while we verify your email address.
            </Typography>
          </Stack>
        );

      case 'success':
        return (
          <Stack spacing={3} alignItems="center">
            <CheckCircle sx={{ fontSize: 80, color: 'success.main' }} />
            <Typography variant="h5" textAlign="center">
              Email Verified Successfully!
            </Typography>
            <Typography variant="body1" color="text.secondary" textAlign="center">
              Your email address has been verified. You can now sign in to your account.
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handleContinue}
              fullWidth
            >
              Continue to Sign In
            </Button>
          </Stack>
        );

      case 'expired':
        return (
          <Stack spacing={3} alignItems="center">
            <Email sx={{ fontSize: 80, color: 'warning.main' }} />
            <Typography variant="h5" textAlign="center">
              Verification Link Expired
            </Typography>
            <Alert severity="warning" sx={{ width: '100%' }}>
              {error}
            </Alert>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Don't worry! You can request a new verification email.
            </Typography>
            <Stack spacing={2} direction="row" sx={{ width: '100%' }}>
              <Button
                variant="contained"
                onClick={handleResendVerification}
                loading={isResending}
                fullWidth
              >
                Resend Verification Email
              </Button>
              <Button
                variant="outlined"
                onClick={handleBackToLogin}
                fullWidth
              >
                Back to Sign In
              </Button>
            </Stack>
          </Stack>
        );

      case 'error':
      default:
        return (
          <Stack spacing={3} alignItems="center">
            <Error sx={{ fontSize: 80, color: 'error.main' }} />
            <Typography variant="h5" textAlign="center">
              Verification Failed
            </Typography>
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              The verification link may be invalid or expired.
            </Typography>
            <Stack spacing={2} direction="row" sx={{ width: '100%' }}>
              <Button
                variant="contained"
                onClick={handleResendVerification}
                loading={isResending}
                fullWidth
              >
                Resend Verification Email
              </Button>
              <Button
                variant="outlined"
                onClick={handleBackToLogin}
                fullWidth
              >
                Back to Sign In
              </Button>
            </Stack>
          </Stack>
        );
    }
  };

  return (
    <AuthGuard requireAuth={false}>
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
              boxShadow: (theme) =>
                theme.palette.mode === 'dark'
                  ? '0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)'
                  : '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: (theme) => `1px solid ${theme.palette.divider}`,
            }}
          >
            {renderContent()}
          </Paper>
        </Container>
      </Box>
    </AuthGuard>
  );
}