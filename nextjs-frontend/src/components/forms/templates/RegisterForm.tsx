'use client';

import { useState } from 'react';
import { Stack, Box, Typography, Link, Divider, Alert } from '@mui/material';
import { Google, GitHub } from '@mui/icons-material';
import { Form, FormInput, FormSubmitButton } from '../';
import { Button } from '@/components/ui';
import { AuthSchemas, type RegisterFormData } from '@/lib/validation/schemas';

export interface RegisterFormProps {
  onSubmit: (data: RegisterFormData) => Promise<void>;
  onSignIn?: () => void;
  onSocialLogin?: (provider: 'google' | 'github') => void;
  loading?: boolean;
  error?: string;
  showSocialLogin?: boolean;
  showTermsLink?: boolean;
  autoSave?: boolean;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({
  onSubmit,
  onSignIn,
  onSocialLogin,
  loading = false,
  error,
  showSocialLogin = true,
  showTermsLink = true,
  autoSave = false,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: RegisterFormData) => {
    try {
      setIsSubmitting(true);
      await onSubmit(data);
    } catch (error) {
      console.error('Registration error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 400, mx: 'auto' }}>
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Create Account
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Join SnapURL and start shortening your links
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
              Sign up with Google
            </Button>
            <Button
              variant="outlined"
              fullWidth
              icon={<GitHub />}
              onClick={() => onSocialLogin?.('github')}
              disabled={loading || isSubmitting}
            >
              Sign up with GitHub
            </Button>
          </Stack>

          <Divider sx={{ my: 3 }}>
            <Typography variant="body2" color="text.secondary">
              or
            </Typography>
          </Divider>
        </>
      )}

      {/* Registration Form */}
      <Form<RegisterFormData>
        schema={AuthSchemas.register}
        onSubmit={handleSubmit}
        loading={loading || isSubmitting}
        error={error}
        autoSave={autoSave}
        showProgress
        defaultValues={{
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
          acceptTerms: false,
        }}
      >
        <Stack spacing={3}>
          <FormInput
            name="name"
            label="Full Name"
            placeholder="Enter your full name"
            autoComplete="name"
            required
            fullWidth
          />

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
            placeholder="Create a strong password"
            autoComplete="new-password"
            showPasswordToggle
            required
            fullWidth
            helperText="Must contain at least 8 characters with uppercase, lowercase, number, and special character"
          />

          <FormInput
            name="confirmPassword"
            label="Confirm Password"
            type="password"
            placeholder="Confirm your password"
            autoComplete="new-password"
            showPasswordToggle
            required
            fullWidth
          />

          <Box>
            <FormInput
              name="acceptTerms"
              type="checkbox"
              checkboxLabel="I agree to the Terms of Service and Privacy Policy"
              required
            />
            {showTermsLink && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                By checking this box, you agree to our{' '}
                <Link href="/terms" target="_blank" rel="noopener">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link href="/privacy" target="_blank" rel="noopener">
                  Privacy Policy
                </Link>
              </Typography>
            )}
          </Box>

          <Alert severity="info" sx={{ fontSize: '0.875rem' }}>
            By creating an account, you'll be able to shorten unlimited URLs,
            track analytics, and manage your links with custom domains.
          </Alert>

          <FormSubmitButton
            loading={loading || isSubmitting}
            fullWidth
            size="large"
          >
            Create Account
          </FormSubmitButton>
        </Stack>
      </Form>

      {/* Sign In Link */}
      {onSignIn && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Already have an account?{' '}
            <Link
              component="button"
              type="button"
              onClick={onSignIn}
              sx={{ textDecoration: 'none', fontWeight: 'medium' }}
            >
              Sign in
            </Link>
          </Typography>
        </Box>
      )}
    </Box>
  );
};