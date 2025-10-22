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
  Link,
} from '@mui/material';
import {
  Form,
  FormInput,
  FormSubmitButton,
  AuthSchemas,
  type ResetPasswordFormData,
} from '@/components/forms';
import { useAuth } from '@/hooks/useAuth';
import { AuthGuard } from '@/components/auth/AuthGuard';

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { resetPassword } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Get token from URL params
  useEffect(() => {
    const tokenParam = searchParams.get('token');
    if (!tokenParam) {
      setError('Invalid or missing reset token. Please request a new password reset.');
    } else {
      setToken(tokenParam);
    }
  }, [searchParams]);

  const handleSubmit = async (data: Omit<ResetPasswordFormData, 'token'>) => {
    if (!token) {
      setError('Invalid reset token. Please request a new password reset.');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      await resetPassword(token, data.password);

      setSuccess('Your password has been reset successfully! You can now sign in with your new password.');
      
      // Redirect to login after a delay
      setTimeout(() => {
        router.push('/login?message=Password%20reset%20successful.%20Please%20sign%20in%20with%20your%20new%20password.');
      }, 3000);
      
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. The reset link may have expired.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    router.push('/login');
  };

  const handleRequestNewReset = () => {
    router.push('/forgot-password');
  };

  // Show error if no token
  if (!token && error) {
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
                textAlign: 'center',
              }}
            >
              <Typography variant="h4" component="h1" gutterBottom>
                Invalid Reset Link
              </Typography>
              
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>

              <Stack spacing={2} direction="row" justifyContent="center">
                <Link
                  component="button"
                  type="button"
                  onClick={handleRequestNewReset}
                  sx={{ textDecoration: 'none', fontWeight: 'medium' }}
                >
                  Request New Reset
                </Link>
                <Link
                  component="button"
                  type="button"
                  onClick={handleBackToLogin}
                  sx={{ textDecoration: 'none' }}
                >
                  Back to Sign In
                </Link>
              </Stack>
            </Paper>
          </Container>
        </Box>
      </AuthGuard>
    );
  }

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
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Typography variant="h4" component="h1" gutterBottom>
                Reset Password
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enter your new password below
              </Typography>
            </Box>

            {success ? (
              <Stack spacing={3} alignItems="center">
                <Alert severity="success" sx={{ width: '100%' }}>
                  {success}
                </Alert>
                
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Redirecting to sign in page...
                </Typography>
              </Stack>
            ) : (
              <Form<Omit<ResetPasswordFormData, 'token'>>
                schema={AuthSchemas.resetPassword.omit({ token: true })}
                onSubmit={handleSubmit}
                loading={isLoading}
                error={error}
                defaultValues={{
                  password: '',
                  confirmPassword: '',
                }}
              >
                <Stack spacing={3}>
                  <FormInput
                    name="password"
                    label="New Password"
                    type="password"
                    placeholder="Enter your new password"
                    autoComplete="new-password"
                    showPasswordToggle
                    required
                    fullWidth
                    autoFocus
                    helperText="Must contain at least 8 characters with uppercase, lowercase, number, and special character"
                  />

                  <FormInput
                    name="confirmPassword"
                    label="Confirm New Password"
                    type="password"
                    placeholder="Confirm your new password"
                    autoComplete="new-password"
                    showPasswordToggle
                    required
                    fullWidth
                  />

                  <FormSubmitButton
                    loading={isLoading}
                    fullWidth
                    size="large"
                  >
                    Reset Password
                  </FormSubmitButton>

                  <Box sx={{ textAlign: 'center' }}>
                    <Link
                      component="button"
                      type="button"
                      variant="body2"
                      onClick={handleBackToLogin}
                      sx={{ textDecoration: 'none' }}
                    >
                      Back to Sign In
                    </Link>
                  </Box>
                </Stack>
              </Form>
            )}
          </Paper>
        </Container>
      </Box>
    </AuthGuard>
  );
}