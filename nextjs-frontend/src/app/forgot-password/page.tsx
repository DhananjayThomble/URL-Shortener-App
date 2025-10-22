'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  type ForgotPasswordFormData,
} from '@/components/forms';
import { useAuth } from '@/hooks/useAuth';
import { AuthGuard } from '@/components/auth/AuthGuard';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (data: ForgotPasswordFormData) => {
    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);

      await requestPasswordReset(data.email);

      setSuccess(
        'If an account with that email exists, we\'ve sent you a password reset link. Please check your email and follow the instructions.'
      );
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToLogin = () => {
    router.push('/login');
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
            <Box sx={{ textAlign: 'center', mb: 4 }}>
              <Typography variant="h4" component="h1" gutterBottom>
                Forgot Password
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enter your email address and we'll send you a link to reset your password
              </Typography>
            </Box>

            {success ? (
              <Stack spacing={3} alignItems="center">
                <Alert severity="success" sx={{ width: '100%' }}>
                  {success}
                </Alert>
                
                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Didn't receive the email? Check your spam folder or try again in a few minutes.
                </Typography>

                <Link
                  component="button"
                  type="button"
                  onClick={handleBackToLogin}
                  sx={{ textDecoration: 'none', fontWeight: 'medium' }}
                >
                  Back to Sign In
                </Link>
              </Stack>
            ) : (
              <Form<ForgotPasswordFormData>
                schema={AuthSchemas.forgotPassword}
                onSubmit={handleSubmit}
                loading={isLoading}
                error={error}
                defaultValues={{
                  email: '',
                }}
              >
                <Stack spacing={3}>
                  <FormInput
                    name="email"
                    label="Email Address"
                    type="email"
                    placeholder="Enter your email address"
                    autoComplete="email"
                    required
                    fullWidth
                    autoFocus
                  />

                  <FormSubmitButton
                    loading={isLoading}
                    fullWidth
                    size="large"
                  >
                    Send Reset Link
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