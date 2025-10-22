'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Link, Alert } from '@mui/material';
import { Email, ArrowBack } from '@mui/icons-material';
import { Form, FormInput, FormSubmitButton } from '../';
import { AuthSchemas, type ForgotPasswordFormData } from '@/lib/validation/schemas';

export interface ForgotPasswordFormProps {
  onSubmit: (data: ForgotPasswordFormData) => Promise<void>;
  onBackToLogin?: () => void;
  loading?: boolean;
  error?: string;
  success?: boolean;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onSubmit,
  onBackToLogin,
  loading = false,
  error,
  success = false,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: ForgotPasswordFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('Forgot password error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto', textAlign: 'center' }}>
        <Box sx={{ mb: 4 }}>
          <Email sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            Check Your Email
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            We've sent a password reset link to your email address. 
            Please check your inbox and follow the instructions to reset your password.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Didn't receive the email? Check your spam folder or try again.
          </Typography>
        </Box>

        {onBackToLogin && (
          <Link
            component="button"
            type="button"
            onClick={onBackToLogin}
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              textDecoration: 'none',
              mx: 'auto',
              width: 'fit-content'
            }}
          >
            <ArrowBack fontSize="small" />
            Back to Sign In
          </Link>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Forgot Password?
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Enter your email address and we'll send you a link to reset your password.
        </Typography>
      </Box>

      <Form<ForgotPasswordFormData>
        schema={AuthSchemas.forgotPassword}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
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
            leftIcon={<Email />}
            required
            fullWidth
          />

          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            We'll send you an email with instructions to reset your password. 
            The link will expire in 1 hour for security reasons.
          </Alert>

          <FormSubmitButton
            loading={loading || isSubmitting}
            fullWidth
            size="large"
          >
            Send Reset Link
          </FormSubmitButton>
        </Stack>
      </Form>

      {onBackToLogin && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Link
            component="button"
            type="button"
            onClick={onBackToLogin}
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              textDecoration: 'none',
              mx: 'auto',
              width: 'fit-content'
            }}
          >
            <ArrowBack fontSize="small" />
            Back to Sign In
          </Link>
        </Box>
      )}
    </Box>
  );
};