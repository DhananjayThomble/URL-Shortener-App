'use client';

import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Link,
  Alert,
  Divider,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  IconButton,
  Stepper,
  Step,
  StepLabel,
  Collapse,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  PersonAdd,
  Email,
  Lock,
  Check,
  AccountCircle,
} from '@mui/icons-material';
import { useAuth } from '@/hooks/useAuth';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

interface EnhancedRegisterFormProps {
  onSuccess?: () => void;
  onLogin?: () => void;
  redirectTo?: string;
}

export function EnhancedRegisterForm({
  onSuccess,
  onLogin,
  redirectTo = '/dashboard',
}: EnhancedRegisterFormProps) {
  const { register } = useAuth();

  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    agreeToTerms: false,
    subscribeNewsletter: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const steps = ['Account Details', 'Password Setup', 'Terms & Preferences'];

  const handleInputChange = (field: keyof typeof formData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    
    // Clear field error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: '',
      }));
    }
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    switch (step) {
      case 0: // Account Details
        if (!formData.name.trim()) {
          newErrors.name = 'Name is required';
        } else if (formData.name.trim().length < 2) {
          newErrors.name = 'Name must be at least 2 characters';
        }

        if (!formData.email.trim()) {
          newErrors.email = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          newErrors.email = 'Please enter a valid email address';
        }
        break;

      case 1: // Password Setup
        if (!formData.password) {
          newErrors.password = 'Password is required';
        } else if (formData.password.length < 8) {
          newErrors.password = 'Password must be at least 8 characters';
        }

        if (!formData.confirmPassword) {
          newErrors.confirmPassword = 'Please confirm your password';
        } else if (formData.password !== formData.confirmPassword) {
          newErrors.confirmPassword = 'Passwords do not match';
        }
        break;

      case 2: // Terms & Preferences
        if (!formData.agreeToTerms) {
          newErrors.agreeToTerms = 'You must agree to the terms and conditions';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setActiveStep(prev => prev - 1);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!validateStep(2)) {
      return;
    }

    setIsLoading(true);

    try {
      await register({
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
      }, redirectTo);

      onSuccess?.();
    } catch (err: any) {
      setErrors({
        submit: err.message || 'Registration failed. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Create Your Account
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Let's start with your basic information
            </Typography>

            <Box mt={3}>
              <TextField
                label="Full Name"
                value={formData.name}
                onChange={handleInputChange('name')}
                error={!!errors.name}
                helperText={errors.name}
                disabled={isLoading}
                required
                fullWidth
                autoComplete="name"
                sx={{ mb: 2 }}
              />

              <TextField
                label="Email Address"
                type="email"
                value={formData.email}
                onChange={handleInputChange('email')}
                error={!!errors.email}
                helperText={errors.email}
                disabled={isLoading}
                required
                fullWidth
                autoComplete="email"
              />
            </Box>
          </Box>
        );

      case 1:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Secure Your Account
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Choose a strong password to protect your account
            </Typography>

            <Box mt={3}>
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={handleInputChange('password')}
                error={!!errors.password}
                helperText={errors.password}
                disabled={isLoading}
                required
                fullWidth
                autoComplete="new-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{ mb: 2 }}
              />

              {formData.password && (
                <Box mb={2}>
                  <PasswordStrengthIndicator
                    password={formData.password}
                    compact
                  />
                </Box>
              )}

              <TextField
                label="Confirm Password"
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                onChange={handleInputChange('confirmPassword')}
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword}
                disabled={isLoading}
                required
                fullWidth
                autoComplete="new-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        edge="end"
                      >
                        {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
          </Box>
        );

      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Terms & Preferences
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Review and accept our terms to complete registration
            </Typography>

            <Box mt={3}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.agreeToTerms}
                    onChange={handleInputChange('agreeToTerms')}
                    disabled={isLoading}
                  />
                }
                label={
                  <Typography variant="body2">
                    I agree to the{' '}
                    <Link href="/terms" target="_blank">
                      Terms of Service
                    </Link>{' '}
                    and{' '}
                    <Link href="/privacy" target="_blank">
                      Privacy Policy
                    </Link>
                  </Typography>
                }
              />
              {errors.agreeToTerms && (
                <Typography variant="caption" color="error" display="block">
                  {errors.agreeToTerms}
                </Typography>
              )}

              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.subscribeNewsletter}
                    onChange={handleInputChange('subscribeNewsletter')}
                    disabled={isLoading}
                  />
                }
                label={
                  <Typography variant="body2">
                    Subscribe to our newsletter for updates and tips
                  </Typography>
                }
                sx={{ mt: 1 }}
              />

              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  <strong>What happens next?</strong>
                </Typography>
                <Typography variant="body2">
                  We'll send a verification email to confirm your account. You can start using SnapURL immediately!
                </Typography>
              </Alert>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Card sx={{ maxWidth: 500, mx: 'auto' }}>
      <CardContent sx={{ p: 4 }}>
        <Box display="flex" alignItems="center" justifyContent="center" mb={3}>
          <PersonAdd sx={{ fontSize: 48, color: 'primary.main', mr: 1 }} />
          <Typography variant="h4" component="h1">
            Sign Up
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        <form onSubmit={handleSubmit}>
          {renderStepContent(activeStep)}

          {/* Submit Error */}
          {errors.submit && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errors.submit}
            </Alert>
          )}

          {/* Navigation Buttons */}
          <Box display="flex" justifyContent="space-between" mt={4}>
            <Button
              onClick={handleBack}
              disabled={activeStep === 0 || isLoading}
            >
              Back
            </Button>

            {activeStep === steps.length - 1 ? (
              <Button
                type="submit"
                variant="contained"
                disabled={isLoading}
                startIcon={<Check />}
              >
                {isLoading ? 'Creating Account...' : 'Create Account'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                disabled={isLoading}
              >
                Next
              </Button>
            )}
          </Box>
        </form>

        <Divider sx={{ my: 3 }}>
          <Typography variant="body2" color="text.secondary">
            or
          </Typography>
        </Divider>

        <Button
          variant="outlined"
          fullWidth
          onClick={onLogin}
          disabled={isLoading}
        >
          Already have an account? Sign In
        </Button>

        {/* Security Notice */}
        <Box mt={3}>
          <Alert severity="info">
            <Typography variant="body2">
              <strong>Your Privacy Matters:</strong> We use industry-standard encryption to protect your data and never share your information with third parties.
            </Typography>
          </Alert>
        </Box>
      </CardContent>
    </Card>
  );
}

export default EnhancedRegisterForm;