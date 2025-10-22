'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Link, Alert } from '@mui/material';
import { Lock, CheckCircle, ArrowBack } from '@mui/icons-material';
import { Form, FormInput, FormSubmitButton } from '../';
import { AuthSchemas, type ResetPasswordFormData } from '@/lib/validation/schemas';

export interface ResetPasswordFormProps {
  token: string;
  onSubmit: (data: ResetPasswordFormData) => Promise<void>;
  onBackToLogin?: () => void;
  loading?: boolean;
  error?: string;
  success?: boolean;
}

export const ResetPasswordForm: React.FC<ResetPasswordFormProps> = ({
  token,
  onSubmit,
  onBackToLogin,
  loading = false,
  error,
  success = false,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: Omit<ResetPasswordFormData, 'token'>) => {
    try {
      setIsSubmitting(true);
      await onSubmit({ ...data, token });
    } catch (error) {
      console.error('Reset password error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto', textAlign: 'center' }}>
        <Box sx={{ mb: 4 }}>
          <CheckCircle sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" component="h1" gutterBottom>
            Password Reset Successful
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            Your password has been successfully reset. You can now sign in 
            with your new password.
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
        <Lock sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
        <Typography variant="h4" component="h1" gutterBottom>
          Reset Your Password
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Enter your new password below. Make sure it's strong and secure.
        </Typography>
      </Box>

      <Form<Omit<ResetPasswordFormData, 'token'>>
        schema={AuthSchemas.resetPassword.omit({ token: true })}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
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

          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            <Typography variant="body2" gutterBottom>
              <strong>Password Requirements:</strong>
            </Typography>
            <Typography variant="caption" component="div">
              • At least 8 characters long<br />
              • Contains uppercase and lowercase letters<br />
              • Contains at least one number<br />
              • Contains at least one special character
            </Typography>
          </Alert>

          <FormSubmitButton
            loading={loading || isSubmitting}
            fullWidth
            size="large"
          >
            Reset Password
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