'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
} from '@mui/material';
import {
  Lock,
  Security,
  Smartphone,
  Computer,
  Save,
  Visibility,
  VisibilityOff,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { authAPI } from '@/lib/api/auth';
import toast from 'react-hot-toast';
import { IconButton, InputAdornment } from '@mui/material';

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordFormData = z.infer<typeof passwordSchema>;

export function SecuritySettings() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = async (data: PasswordFormData) => {
    setIsLoading(true);
    try {
      await authAPI.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      reset();
      toast.success('Password changed successfully');
    } catch (error: any) {
      console.error('Failed to change password:', error);
      toast.error(error.response?.data?.message || 'Failed to change password');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePasswordVisibility = (field: keyof typeof showPasswords) => {
    setShowPasswords(prev => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleVerifyEmail = async () => {
    try {
      await authAPI.resendEmailVerification();
      toast.success('Verification email sent');
    } catch (error) {
      console.error('Failed to send verification email:', error);
      toast.error('Failed to send verification email');
    }
  };

  // Mock data for active sessions - in real app, this would come from API
  const activeSessions = [
    {
      id: '1',
      device: 'Chrome on Windows',
      location: 'New York, US',
      lastActive: '2 minutes ago',
      current: true,
    },
    {
      id: '2',
      device: 'Safari on iPhone',
      location: 'New York, US',
      lastActive: '1 hour ago',
      current: false,
    },
  ];

  return (
    <Stack spacing={3}>
      {/* Email Verification */}
      {!user?.isEmailVerified && (
        <Alert 
          severity="warning" 
          action={
            <Button color="inherit" size="small" onClick={handleVerifyEmail}>
              Verify Now
            </Button>
          }
        >
          Your email address is not verified. Please check your inbox for a verification email.
        </Alert>
      )}

      {/* Change Password */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Change Password
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Ensure your account is using a long, random password to stay secure.
          </Typography>

          <form onSubmit={handleSubmit(onSubmit)}>
            <Stack spacing={3}>
              <TextField
                label="Current Password"
                type={showPasswords.current ? 'text' : 'password'}
                {...register('currentPassword')}
                error={!!errors.currentPassword}
                helperText={errors.currentPassword?.message}
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => togglePasswordVisibility('current')}
                        edge="end"
                      >
                        {showPasswords.current ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                label="New Password"
                type={showPasswords.new ? 'text' : 'password'}
                {...register('newPassword')}
                error={!!errors.newPassword}
                helperText={errors.newPassword?.message || 'Must be at least 8 characters'}
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => togglePasswordVisibility('new')}
                        edge="end"
                      >
                        {showPasswords.new ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <TextField
                label="Confirm New Password"
                type={showPasswords.confirm ? 'text' : 'password'}
                {...register('confirmPassword')}
                error={!!errors.confirmPassword}
                helperText={errors.confirmPassword?.message}
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => togglePasswordVisibility('confirm')}
                        edge="end"
                      >
                        {showPasswords.confirm ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Divider />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={isLoading}
                  startIcon={<Save />}
                >
                  {isLoading ? 'Updating...' : 'Update Password'}
                </Button>
              </Box>
            </Stack>
          </form>
        </CardContent>
      </Card>

      {/* Two-Factor Authentication */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Two-Factor Authentication
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add an extra layer of security to your account
              </Typography>
            </Box>
            <Chip
              label="Coming Soon"
              color="default"
              variant="outlined"
              size="small"
            />
          </Box>

          <Alert severity="info">
            Two-factor authentication will be available in a future update. This will allow you to secure your account with SMS or authenticator app codes.
          </Alert>
        </CardContent>
      </Card>

      {/* Active Sessions */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Active Sessions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            These are the devices that are currently signed in to your account.
          </Typography>

          <List>
            {activeSessions.map((session, index) => (
              <ListItem
                key={session.id}
                sx={{
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 1,
                  '&:last-child': { mb: 0 },
                }}
              >
                <ListItemIcon>
                  {session.device.includes('iPhone') ? (
                    <Smartphone color="primary" />
                  ) : (
                    <Computer color="primary" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body1">
                        {session.device}
                      </Typography>
                      {session.current && (
                        <Chip
                          label="Current"
                          color="success"
                          size="small"
                          variant="outlined"
                        />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {session.location} • Last active {session.lastActive}
                      </Typography>
                    </Box>
                  }
                />
                {!session.current && (
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    onClick={() => {
                      // TODO: Implement session revocation
                      toast('Session management coming soon!', { icon: 'ℹ️' });
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </ListItem>
            ))}
          </List>

          <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<Security />}
              onClick={() => {
                // TODO: Implement revoke all sessions
                toast('Session management coming soon!', { icon: 'ℹ️' });
              }}
            >
              Revoke All Other Sessions
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}