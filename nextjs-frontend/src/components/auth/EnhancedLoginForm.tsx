'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
  Chip,
  InputAdornment,
  IconButton,
  Collapse,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Security,
  Login,
  Key,
  Warning,
  AccountCircle,
} from '@mui/icons-material';
import { useAuth } from '@/hooks/useAuth';
import { useSecurity } from '@/hooks/useSecurity';
import { PasswordStrengthIndicator } from './PasswordStrengthIndicator';

interface EnhancedLoginFormProps {
  onSuccess?: () => void;
  onForgotPassword?: () => void;
  onRegister?: () => void;
  redirectTo?: string;
}

export function EnhancedLoginForm({
  onSuccess,
  onForgotPassword,
  onRegister,
  redirectTo = '/dashboard',
}: EnhancedLoginFormProps) {
  const router = useRouter();
  const { login } = useAuth();
  const { checkSuspiciousActivity, getLockoutTimeRemaining } = useSecurity();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    twoFactorCode: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [lockoutInfo, setLockoutInfo] = useState<{
    isLocked: boolean;
    timeRemaining: number;
  }>({ isLocked: false, timeRemaining: 0 });

  const handleInputChange = (field: keyof typeof formData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value,
    }));
    setError('');
  };

  const checkAccountLockout = useCallback((email: string) => {
    const suspiciousActivity = checkSuspiciousActivity(email);
    const timeRemaining = getLockoutTimeRemaining(email);
    
    setLockoutInfo({
      isLocked: suspiciousActivity.isSuspicious,
      timeRemaining,
    });

    return suspiciousActivity.isSuspicious;
  }, [checkSuspiciousActivity, getLockoutTimeRemaining]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!formData.email || !formData.password) {
      setError('Please fill in all required fields');
      return;
    }

    // Check for account lockout
    if (checkAccountLockout(formData.email)) {
      const minutes = Math.ceil(lockoutInfo.timeRemaining / 60000);
      setError(`Account temporarily locked. Try again in ${minutes} minutes.`);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await login({
        email: formData.email,
        password: formData.password,
        twoFactorCode: formData.twoFactorCode || undefined,
      }, redirectTo);

      onSuccess?.();
    } catch (err: any) {
      // Handle 2FA requirement
      if (err.message?.includes('2FA') || err.message?.includes('two-factor')) {
        setShowTwoFactor(true);
        setError('Please enter your two-factor authentication code');
        return;
      }

      // Handle other errors
      setError(err.message || 'Login failed. Please check your credentials.');
      
      // Check for lockout after failed attempt
      setTimeout(() => {
        checkAccountLockout(formData.email);
      }, 100);
    } finally {
      setIsLoading(false);
    }
  };

  const formatLockoutTime = (ms: number): string => {
    const minutes = Math.ceil(ms / 60000);
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  };

  return (
    <Card sx={{ maxWidth: 400, mx: 'auto' }}>
      <CardContent sx={{ p: 4 }}>
        <Box display="flex" alignItems="center" justifyContent="center" mb={3}>
          <AccountCircle sx={{ fontSize: 48, color: 'primary.main', mr: 1 }} />
          <Typography variant="h4" component="h1">
            Sign In
          </Typography>
        </Box>

        {/* Account Lockout Warning */}
        {lockoutInfo.isLocked && (
          <Alert severity="error" sx={{ mb: 2 }}>
            <Box display="flex" alignItems="center" gap={1}>
              <Warning />
              <Box>
                <Typography variant="body2" gutterBottom>
                  <strong>Account Temporarily Locked</strong>
                </Typography>
                <Typography variant="body2">
                  Too many failed login attempts. Try again in {formatLockoutTime(lockoutInfo.timeRemaining)}.
                </Typography>
              </Box>
            </Box>
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <Box mb={2}>
            <TextField
              label="Email Address"
              type="email"
              value={formData.email}
              onChange={handleInputChange('email')}
              disabled={isLoading || lockoutInfo.isLocked}
              required
              fullWidth
              autoComplete="email"
            />
          </Box>

          <Box mb={2}>
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleInputChange('password')}
              disabled={isLoading || lockoutInfo.isLocked}
              required
              fullWidth
              autoComplete="current-password"
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
            />
          </Box>

          {/* Two-Factor Authentication */}
          <Collapse in={showTwoFactor}>
            <Box mb={2}>
              <TextField
                label="Two-Factor Code"
                value={formData.twoFactorCode}
                onChange={handleInputChange('twoFactorCode')}
                disabled={isLoading}
                placeholder="123456"
                inputProps={{ maxLength: 6 }}
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Security />
                    </InputAdornment>
                  ),
                }}
                helperText="Enter the 6-digit code from your authenticator app"
              />
            </Box>
          </Collapse>

          {/* Error Display */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={isLoading || lockoutInfo.isLocked}
            startIcon={<Login />}
            sx={{ mb: 2 }}
          >
            {isLoading ? 'Signing In...' : 'Sign In'}
          </Button>

          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={onForgotPassword}
              disabled={isLoading}
            >
              Forgot Password?
            </Link>
            
            {showTwoFactor && (
              <Chip
                label="2FA Required"
                color="primary"
                size="small"
                icon={<Security />}
              />
            )}
          </Box>

          <Divider sx={{ my: 2 }}>
            <Typography variant="body2" color="text.secondary">
              or
            </Typography>
          </Divider>

          <Button
            variant="outlined"
            fullWidth
            onClick={onRegister}
            disabled={isLoading}
          >
            Create New Account
          </Button>
        </form>

        {/* Security Info */}
        <Box mt={3}>
          <Alert severity="info">
            <Typography variant="body2">
              <strong>Security Notice:</strong> Your account will be temporarily locked after 5 failed login attempts.
            </Typography>
          </Alert>
        </Box>
      </CardContent>
    </Card>
  );
}

export default EnhancedLoginForm;