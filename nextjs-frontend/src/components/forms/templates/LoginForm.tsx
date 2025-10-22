'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Link, Divider } from '@mui/material';
import { Google, GitHub } from '@mui/icons-material';
import { Form, FormInput, FormSubmitButton, FormResetButton } from '../';
import { Button } from '@/components/ui';
import { AuthSchemas, type LoginFormData } from '@/lib/validation/schemas';
import { useAutoSave } from '@/lib/forms/autoSave';

export interface LoginFormProps {
  onSubmit: (data: LoginFormData) => Promise<void>;
  onForgotPassword?: () => void;
  onSignUp?: () => void;
  onSocialLogin?: (provider: 'google' | 'github') => void;
  loading?: boolean;
  error?: string;
  showSocialLogin?: boolean;
  showRememberMe?: boolean;
  autoSave?: boolean;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onSubmit,
  onForgotPassword,
  onSignUp,
  onSocialLogin,
  loading = false,
  error,
  showSocialLogin = true,
  showRememberMe = true,
  autoSave = false,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: LoginFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Welcome Back
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Sign in to your SnapURL account
        </Typography>
      </Box>

      {/* Social Login */}
      {showSocialLogin && (
        <>
          <Stack spacing={2} sx={{ mb: 3 }}>
            <Button
              variant="outlined"
              fullWidth
              icon={<Google />}
              onClick={() => onSocialLogin?.('google')}
              disabled={loading || isSubmitting}
            >
              Continue with Google
            </Button>
            <Button
              variant="outlined"
              fullWidth
              icon={<GitHub />}
              onClick={() => onSocialLogin?.('github')}
              disabled={loading || isSubmitting}
            >
              Continue with GitHub
            </Button>
          </Stack>

          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              or
            </Typography>
          </Divider>
        </>
      )}

      {/* Login Form */}
      <Form<LoginFormData>
        schema={AuthSchemas.login}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
        error={error}
        autoSave={autoSave}
        defaultValues={{
          email: '',
          password: '',
          rememberMe: false,
        }}
      >
        <Stack spacing={3}>
          <FormInput
            name="email"
            label="Email Address"
            type="email"
            placeholder="Enter your email"
            autoComplete="email"
            required
            fullWidth
          />

          <FormInput
            name="password"
            label="Password"
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            showPasswordToggle
            required
            fullWidth
          />

          {showRememberMe && (
            <FormInput
              name="rememberMe"
              checkboxLabel="Remember me for 30 days"
              type="checkbox"
            />
          )}

          <Stack spacing={2}>
            <FormSubmitButton
              loading={loading || isSubmitting}
              fullWidth
              size="large"
            >
              Sign In
            </FormSubmitButton>

            {onForgotPassword && (
              <Box sx={{ textAlign: 'center' }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={onForgotPassword}
                  sx={{ textDecoration: 'none' }}
                >
                  Forgot your password?
                </Link>
              </Box>
            )}
          </Stack>
        </Stack>
      </Form>

      {/* Sign Up Link */}
      {onSignUp && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Don't have an account?{' '}
            <Link
              component="button"
              type="button"
              onClick={onSignUp}
              sx={{ textDecoration: 'none', fontWeight: 'medium' }}
            >
              Sign up
            </Link>
          </Typography>
        </Box>
      )}
    </Box>
  );
};