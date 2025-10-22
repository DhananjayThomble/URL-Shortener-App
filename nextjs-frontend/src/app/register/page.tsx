'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Container, Paper, Alert } from '@mui/material';
import { RegisterForm } from '@/components/forms/templates/RegisterForm';
import { useAuth } from '@/hooks/useAuth';
import { AuthGuard } from '@/components/auth/AuthGuard';
import type { RegisterFormData } from '@/lib/validation/schemas';

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Get redirect URL from query params
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const message = searchParams.get('message');

  const handleRegister = async (data: RegisterFormData) => {
    try {
      setError(null);
      setSuccess(null);
      
      await register(data, redirectTo);
      
      // Show success message
      setSuccess(
        'Account created successfully! Please check your email to verify your account before signing in.'
      );
      
      // Redirect to login after a delay
      setTimeout(() => {
        const loginUrl = redirectTo !== '/dashboard' 
          ? `/login?redirect=${encodeURIComponent(redirectTo)}&message=${encodeURIComponent('Please sign in with your new account')}`
          : '/login?message=Please%20sign%20in%20with%20your%20new%20account';
        router.push(loginUrl);
      }, 3000);
      
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    }
  };

  const handleSignIn = () => {
    const loginUrl = redirectTo !== '/dashboard' 
      ? `/login?redirect=${encodeURIComponent(redirectTo)}`
      : '/login';
    router.push(loginUrl);
  };

  const handleSocialLogin = async (provider: 'google' | 'github') => {
    try {
      setError(null);
      // TODO: Implement social login
      console.log(`Social signup with ${provider}`);
      // For now, show a message
      setError(`${provider} signup is not yet implemented. Please use email/password registration.`);
    } catch (err: any) {
      setError(err.message || `${provider} signup failed. Please try again.`);
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
            {/* Show message from query params */}
            {message && (
              <Alert severity="info" sx={{ mb: 3 }}>
                {decodeURIComponent(message)}
              </Alert>
            )}

            {/* Show success message */}
            {success && (
              <Alert severity="success" sx={{ mb: 3 }}>
                {success}
              </Alert>
            )}

            <RegisterForm
              onSubmit={handleRegister}
              onSignIn={handleSignIn}
              onSocialLogin={handleSocialLogin}
              loading={isLoading}
              error={error || undefined}
              showSocialLogin={true}
              showTermsLink={true}
              autoSave={true}
            />
          </Paper>
        </Container>
      </Box>
    </AuthGuard>
  );
}