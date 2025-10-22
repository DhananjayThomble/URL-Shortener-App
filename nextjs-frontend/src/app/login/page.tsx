'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Container, Paper, Alert } from '@mui/material';
import { LoginForm } from '@/components/forms/templates/LoginForm';
import { useAuth } from '@/hooks/useAuth';
import { AuthGuard } from '@/components/auth/AuthGuard';
import type { LoginFormData } from '@/lib/validation/schemas';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Get redirect URL from query params
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const message = searchParams.get('message');

  const handleLogin = async (data: LoginFormData) => {
    try {
      setError(null);
      await login(data, redirectTo);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials and try again.');
    }
  };

  const handleForgotPassword = () => {
    router.push('/forgot-password');
  };

  const handleSignUp = () => {
    const signupUrl = redirectTo !== '/dashboard' 
      ? `/register?redirect=${encodeURIComponent(redirectTo)}`
      : '/register';
    router.push(signupUrl);
  };

  const handleSocialLogin = async (provider: 'google' | 'github') => {
    try {
      setError(null);
      // TODO: Implement social login
      console.log(`Social login with ${provider}`);
      // For now, show a message
      setError(`${provider} login is not yet implemented. Please use email/password login.`);
    } catch (err: any) {
      setError(err.message || `${provider} login failed. Please try again.`);
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
            {/* Show message from query params (e.g., "Please log in to continue") */}
            {message && (
              <Alert severity="info" sx={{ mb: 3 }}>
                {decodeURIComponent(message)}
              </Alert>
            )}

            <LoginForm
              onSubmit={handleLogin}
              onForgotPassword={handleForgotPassword}
              onSignUp={handleSignUp}
              onSocialLogin={handleSocialLogin}
              loading={isLoading}
              error={error || undefined}
              showSocialLogin={true}
              showRememberMe={true}
              autoSave={true}
            />
          </Paper>
        </Container>
      </Box>
    </AuthGuard>
  );
}