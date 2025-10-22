'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  LinearProgress,
  Alert,
  Chip,
} from '@mui/material';
import { AccessTime, Security, Refresh } from '@mui/icons-material';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/hooks/useAuth';

interface SessionWarningProps {
  autoExtend?: boolean;
  showInDialog?: boolean;
  onSessionExpired?: () => void;
}

export function SessionWarning({
  autoExtend = false,
  showInDialog = true,
  onSessionExpired,
}: SessionWarningProps) {
  const { sessionInfo, extendSession, isSessionWarning } = useSession();
  const { logout } = useAuth();
  const [isExtending, setIsExtending] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);

  // Calculate time left percentage for progress bar
  const timeLeftPercentage = sessionInfo.expiresAt
    ? Math.max(0, Math.min(100, ((sessionInfo.expiresAt - Date.now()) / sessionInfo.warningThreshold) * 100))
    : 0;

  useEffect(() => {
    if (isSessionWarning && sessionInfo.expiresAt) {
      setShowWarning(true);
      setTimeLeft(sessionInfo.expiresAt - Date.now());

      // Auto-extend if enabled
      if (autoExtend && !isExtending) {
        handleExtendSession();
      }

      // Update countdown
      const interval = setInterval(() => {
        const remaining = sessionInfo.expiresAt! - Date.now();
        setTimeLeft(remaining);

        if (remaining <= 0) {
          clearInterval(interval);
          setShowWarning(false);
          onSessionExpired?.();
        }
      }, 1000);

      return () => clearInterval(interval);
    } else {
      setShowWarning(false);
    }
  }, [isSessionWarning, sessionInfo.expiresAt, autoExtend, isExtending, onSessionExpired]);

  const handleExtendSession = async () => {
    setIsExtending(true);
    try {
      const success = await extendSession();
      if (success) {
        setShowWarning(false);
      }
    } catch (error) {
      console.error('Failed to extend session:', error);
    } finally {
      setIsExtending(false);
    }
  };

  const handleLogout = () => {
    setShowWarning(false);
    logout();
  };

  const formatTimeLeft = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (!showWarning || !sessionInfo.isActive) {
    return null;
  }

  const warningContent = (
    <Box>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <AccessTime color="warning" />
        <Typography variant="h6" color="warning.main">
          Session Expiring Soon
        </Typography>
      </Box>

      <Alert severity="warning" sx={{ mb: 2 }}>
        Your session will expire in{' '}
        <Chip
          label={formatTimeLeft(timeLeft)}
          color="warning"
          size="small"
          sx={{ mx: 0.5 }}
        />
        . You will be automatically logged out for security reasons.
      </Alert>

      <Box mb={2}>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Time remaining:
        </Typography>
        <LinearProgress
          variant="determinate"
          value={timeLeftPercentage}
          color="warning"
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <Security fontSize="small" color="action" />
        <Typography variant="body2" color="text.secondary">
          This helps protect your account from unauthorized access
        </Typography>
      </Box>
    </Box>
  );

  const actionButtons = (
    <Box display="flex" gap={1}>
      <Button
        onClick={handleLogout}
        variant="outlined"
        color="inherit"
      >
        Logout Now
      </Button>
      <Button
        onClick={handleExtendSession}
        variant="contained"
        color="primary"
        disabled={isExtending}
        startIcon={isExtending ? <Refresh className="animate-spin" /> : <Refresh />}
      >
        {isExtending ? 'Extending...' : 'Extend Session'}
      </Button>
    </Box>
  );

  if (showInDialog) {
    return (
      <Dialog
        open={showWarning}
        onClose={() => {}} // Prevent closing by clicking outside
        maxWidth="sm"
        fullWidth
        disableEscapeKeyDown
      >
        <DialogTitle>
          <Box display="flex" alignItems="center" gap={1}>
            <AccessTime color="warning" />
            Session Warning
          </Box>
        </DialogTitle>
        <DialogContent>
          {warningContent}
        </DialogContent>
        <DialogActions>
          {actionButtons}
        </DialogActions>
      </Dialog>
    );
  }

  // Inline warning (for use in headers, etc.)
  return (
    <Alert
      severity="warning"
      action={actionButtons}
      sx={{ mb: 2 }}
    >
      {warningContent}
    </Alert>
  );
}

export default SessionWarning;