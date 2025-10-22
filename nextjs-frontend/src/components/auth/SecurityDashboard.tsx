'use client';

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Divider,
  Grid,
} from '@mui/material';
import {
  Security,
  Login,
  Logout,
  Refresh,
  Warning,
  Computer,
  Smartphone,
  Tablet,
  Clear,
} from '@mui/icons-material';
import { useSecurity } from '@/hooks/useSecurity';
// Simple time formatting utility (replacing date-fns)
const formatDistanceToNow = (timestamp: number, options?: { addSuffix?: boolean }): string => {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) {
    return options?.addSuffix ? `${days} day${days > 1 ? 's' : ''} ago` : `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return options?.addSuffix ? `${hours} hour${hours > 1 ? 's' : ''} ago` : `${hours} hour${hours > 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return options?.addSuffix ? `${minutes} minute${minutes > 1 ? 's' : ''} ago` : `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    return options?.addSuffix ? 'just now' : 'now';
  }
};

export function SecurityDashboard() {
  const {
    deviceInfo,
    securityEvents,
    clearSecurityEvents,
  } = useSecurity();
  
  const [showClearDialog, setShowClearDialog] = useState(false);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'login':
        return <Login color="success" />;
      case 'logout':
        return <Logout color="action" />;
      case 'token_refresh':
        return <Refresh color="info" />;
      case 'failed_login':
        return <Warning color="error" />;
      case 'suspicious_activity':
        return <Security color="error" />;
      default:
        return <Security color="action" />;
    }
  };

  const getEventColor = (type: string): 'success' | 'error' | 'warning' | 'info' | 'default' => {
    switch (type) {
      case 'login':
        return 'success';
      case 'failed_login':
      case 'suspicious_activity':
        return 'error';
      case 'logout':
        return 'warning';
      case 'token_refresh':
        return 'info';
      default:
        return 'default';
    }
  };

  const getDeviceIcon = (type: string) => {
    switch (type) {
      case 'mobile':
        return <Smartphone />;
      case 'tablet':
        return <Tablet />;
      default:
        return <Computer />;
    }
  };

  const formatEventType = (type: string): string => {
    switch (type) {
      case 'login':
        return 'Login';
      case 'logout':
        return 'Logout';
      case 'token_refresh':
        return 'Session Refresh';
      case 'failed_login':
        return 'Failed Login';
      case 'suspicious_activity':
        return 'Suspicious Activity';
      default:
        return type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const handleClearEvents = () => {
    clearSecurityEvents();
    setShowClearDialog(false);
  };

  // Group events by date
  const eventsByDate = securityEvents.reduce((acc, event) => {
    const date = new Date(event.timestamp).toDateString();
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(event);
    return acc;
  }, {} as Record<string, typeof securityEvents>);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Security Dashboard
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3, mb: 3 }}>
        {/* Current Device Info */}
        <Box>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                {getDeviceIcon(deviceInfo.type)}
                <Typography variant="h6">Current Device</Typography>
              </Box>
              
              <Box mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Device Name
                </Typography>
                <Typography variant="body1">{deviceInfo.name}</Typography>
              </Box>

              <Box mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Browser
                </Typography>
                <Typography variant="body1">{deviceInfo.browser}</Typography>
              </Box>

              <Box mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Operating System
                </Typography>
                <Typography variant="body1">{deviceInfo.os}</Typography>
              </Box>

              <Box mb={1}>
                <Typography variant="body2" color="text.secondary">
                  Device Type
                </Typography>
                <Chip
                  label={deviceInfo.type}
                  size="small"
                  color="primary"
                  variant="outlined"
                />
              </Box>

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Last Seen
                </Typography>
                <Typography variant="body1">
                  {formatDistanceToNow(deviceInfo.lastSeen, { addSuffix: true })}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* Security Summary */}
        <Box>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Security />
                <Typography variant="h6">Security Summary</Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="body2" color="text.secondary">
                  Total Security Events
                </Typography>
                <Typography variant="h4" color="primary">
                  {securityEvents.length}
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="body2" color="text.secondary">
                  Recent Failed Logins
                </Typography>
                <Typography variant="h6" color="error.main">
                  {securityEvents.filter(e => e.type === 'failed_login').length}
                </Typography>
              </Box>

              <Box mb={2}>
                <Typography variant="body2" color="text.secondary">
                  Successful Logins
                </Typography>
                <Typography variant="h6" color="success.main">
                  {securityEvents.filter(e => e.type === 'login').length}
                </Typography>
              </Box>

              <Button
                variant="outlined"
                color="error"
                startIcon={<Clear />}
                onClick={() => setShowClearDialog(true)}
                disabled={securityEvents.length === 0}
                fullWidth
              >
                Clear Security Events
              </Button>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Security Events */}
      <Box>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Security Events
              </Typography>

              {securityEvents.length === 0 ? (
                <Alert severity="info">
                  No security events recorded yet. Events will appear here as you use the application.
                </Alert>
              ) : (
                <Box>
                  {Object.entries(eventsByDate)
                    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
                    .map(([date, events]) => (
                      <Box key={date} mb={2}>
                        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                          {date}
                        </Typography>
                        <List dense>
                          {events
                            .sort((a, b) => b.timestamp - a.timestamp)
                            .map((event, index) => (
                              <ListItem key={index} divider>
                                <ListItemIcon>
                                  {getEventIcon(event.type)}
                                </ListItemIcon>
                                <ListItemText
                                  primary={
                                    <Box display="flex" alignItems="center" gap={1}>
                                      <Typography variant="body1">
                                        {formatEventType(event.type)}
                                      </Typography>
                                      <Chip
                                        label={formatEventType(event.type)}
                                        size="small"
                                        color={getEventColor(event.type)}
                                        variant="outlined"
                                      />
                                    </Box>
                                  }
                                  secondary={
                                    <Box>
                                      <Typography variant="body2" color="text.secondary">
                                        {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                                      </Typography>
                                      {event.details && (
                                        <Typography variant="caption" color="text.secondary">
                                          {event.details.email && `Email: ${event.details.email}`}
                                          {event.details.reason && ` • Reason: ${event.details.reason}`}
                                          {event.details.deviceInfo && ` • Device: ${event.details.deviceInfo.name}`}
                                        </Typography>
                                      )}
                                    </Box>
                                  }
                                />
                              </ListItem>
                            ))}
                        </List>
                        {Object.keys(eventsByDate).indexOf(date) < Object.keys(eventsByDate).length - 1 && (
                          <Divider sx={{ my: 1 }} />
                        )}
                      </Box>
                    ))}
                </Box>
              )}
            </CardContent>
          </Card>
      </Box>

      {/* Clear Events Confirmation Dialog */}
      <Dialog
        open={showClearDialog}
        onClose={() => setShowClearDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Clear Security Events</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This action will permanently delete all security events from your local storage.
            This cannot be undone.
          </Alert>
          <Typography>
            Are you sure you want to clear all {securityEvents.length} security events?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowClearDialog(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleClearEvents}
            color="error"
            variant="contained"
          >
            Clear Events
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SecurityDashboard;