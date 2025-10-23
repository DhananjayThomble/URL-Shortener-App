'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Stack,
  Divider,
  Button,
  Alert,
} from '@mui/material';
import {
  Email,
  Notifications,
  Analytics,
  Security,
  Save,
} from '@mui/icons-material';
import toast from 'react-hot-toast';

interface NotificationPreferences {
  emailNotifications: {
    urlAnalytics: boolean;
    securityAlerts: boolean;
    productUpdates: boolean;
    marketingEmails: boolean;
  };
  pushNotifications: {
    urlClicks: boolean;
    securityAlerts: boolean;
    systemUpdates: boolean;
  };
}

export function NotificationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    emailNotifications: {
      urlAnalytics: true,
      securityAlerts: true,
      productUpdates: false,
      marketingEmails: false,
    },
    pushNotifications: {
      urlClicks: false,
      securityAlerts: true,
      systemUpdates: true,
    },
  });

  const [isLoading, setIsLoading] = useState(false);

  const handleEmailNotificationChange = (key: keyof NotificationPreferences['emailNotifications']) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setPreferences(prev => ({
      ...prev,
      emailNotifications: {
        ...prev.emailNotifications,
        [key]: event.target.checked,
      },
    }));
  };

  const handlePushNotificationChange = (key: keyof NotificationPreferences['pushNotifications']) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setPreferences(prev => ({
      ...prev,
      pushNotifications: {
        ...prev.pushNotifications,
        [key]: event.target.checked,
      },
    }));
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      // TODO: Implement API call to save notification preferences
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
      toast.success('Notification preferences saved');
    } catch (error) {
      console.error('Failed to save notification preferences:', error);
      toast.error('Failed to save preferences');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Alert severity="info">
        Notification preferences are saved automatically. You can change these settings at any time.
      </Alert>

      {/* Email Notifications */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <Email color="primary" />
            <Typography variant="h6">
              Email Notifications
            </Typography>
          </Box>

          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.emailNotifications.urlAnalytics}
                  onChange={handleEmailNotificationChange('urlAnalytics')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    URL Analytics Reports
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Weekly summary of your URL performance and click statistics
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.emailNotifications.securityAlerts}
                  onChange={handleEmailNotificationChange('securityAlerts')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    Security Alerts
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Important security notifications about your account
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.emailNotifications.productUpdates}
                  onChange={handleEmailNotificationChange('productUpdates')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    Product Updates
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    New features, improvements, and platform updates
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.emailNotifications.marketingEmails}
                  onChange={handleEmailNotificationChange('marketingEmails')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    Marketing Emails
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Tips, best practices, and promotional content
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </CardContent>
      </Card>

      {/* Push Notifications */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <Notifications color="primary" />
            <Typography variant="h6">
              Push Notifications
            </Typography>
          </Box>

          <Alert severity="info" sx={{ mb: 3 }}>
            Push notifications require browser permission. Enable them in your browser settings for the best experience.
          </Alert>

          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Switch
                  checked={preferences.pushNotifications.urlClicks}
                  onChange={handlePushNotificationChange('urlClicks')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    URL Click Notifications
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Real-time notifications when someone clicks your URLs
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.pushNotifications.securityAlerts}
                  onChange={handlePushNotificationChange('securityAlerts')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    Security Alerts
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Immediate alerts for suspicious account activity
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={preferences.pushNotifications.systemUpdates}
                  onChange={handlePushNotificationChange('systemUpdates')}
                />
              }
              label={
                <Box>
                  <Typography variant="body1">
                    System Updates
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Maintenance notifications and system status updates
                  </Typography>
                </Box>
              }
            />
          </Stack>
        </CardContent>
      </Card>

      {/* Notification Frequency */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Notification Frequency
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Control how often you receive certain types of notifications
          </Typography>

          <Stack spacing={2}>
            <Box>
              <Typography variant="body1" gutterBottom>
                Analytics Reports
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Currently set to: Weekly on Mondays
              </Typography>
            </Box>

            <Box>
              <Typography variant="body1" gutterBottom>
                Click Notifications
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Currently set to: Real-time (when enabled)
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : 'Save Preferences'}
        </Button>
      </Box>
    </Stack>
  );
}