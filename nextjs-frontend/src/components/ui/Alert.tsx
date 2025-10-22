'use client';

import { forwardRef, useState } from 'react';
import {
  Alert as MuiAlert,
  AlertProps as MuiAlertProps,
  AlertTitle,
  Collapse,
  IconButton,
  Box,
  LinearProgress,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import {
  Close,
  CheckCircle,
  Error,
  Warning,
  Info,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type AlertVariant = 'filled' | 'outlined' | 'standard';
export type AlertSeverity = 'success' | 'info' | 'warning' | 'error';

export interface AlertProps extends Omit<MuiAlertProps, 'variant' | 'title' | 'onToggle'> {
  variant?: AlertVariant;
  title?: React.ReactNode;
  closable?: boolean;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  loading?: boolean;
  progress?: number;
  actions?: React.ReactNode;
  onClose?: () => void;
  onToggle?: (expanded: boolean) => void;
}

// Styled Alert with enhanced variants
const StyledAlert = styled(MuiAlert, {
  shouldForwardProp: (prop) => !['loading'].includes(prop as string),
})<{ loading?: boolean }>(({ theme, severity, loading }) => ({
  borderRadius: tokens.borderRadius.lg,
  fontSize: tokens.typography.fontSize.sm[0],
  
  // Enhanced spacing
  '& .MuiAlert-message': {
    padding: '2px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  },

  // Custom icon styles
  '& .MuiAlert-icon': {
    fontSize: '1.25rem',
    marginRight: theme.spacing(1),
  },

  // Loading state
  ...(loading && {
    position: 'relative',
    overflow: 'hidden',
  }),

  // Enhanced color variants
  ...(severity === 'success' && {
    '& .MuiAlert-icon': {
      color: theme.palette.success.main,
    },
  }),
  ...(severity === 'error' && {
    '& .MuiAlert-icon': {
      color: theme.palette.error.main,
    },
  }),
  ...(severity === 'warning' && {
    '& .MuiAlert-icon': {
      color: theme.palette.warning.main,
    },
  }),
  ...(severity === 'info' && {
    '& .MuiAlert-icon': {
      color: theme.palette.info.main,
    },
  }),
}));

// Progress bar for loading alerts
const AlertProgress = styled(LinearProgress)(({ theme }) => ({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: 2,
  borderRadius: 0,
}));

// Custom icons for different severities
const getAlertIcon = (severity: AlertSeverity) => {
  switch (severity) {
    case 'success':
      return <CheckCircle />;
    case 'error':
      return <Error />;
    case 'warning':
      return <Warning />;
    case 'info':
    default:
      return <Info />;
  }
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      variant = 'standard',
      severity = 'info',
      title,
      closable = false,
      collapsible = false,
      defaultExpanded = true,
      loading = false,
      progress,
      actions,
      children,
      onClose,
      onToggle,
      ...props
    },
    ref
  ) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [visible, setVisible] = useState(true);

    // Handle close
    const handleClose = () => {
      setVisible(false);
      onClose?.();
    };

    // Handle toggle expand/collapse
    const handleToggle = () => {
      const newExpanded = !expanded;
      setExpanded(newExpanded);
      onToggle?.(newExpanded);
    };

    // Build action elements
    const actionElements = [];

    // Add custom actions
    if (actions) {
      actionElements.push(
        <Box key="custom-actions" display="flex" gap={1}>
          {actions}
        </Box>
      );
    }

    // Add collapse toggle
    if (collapsible) {
      actionElements.push(
        <IconButton
          key="toggle"
          size="small"
          onClick={handleToggle}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      );
    }

    // Add close button
    if (closable) {
      actionElements.push(
        <IconButton
          key="close"
          size="small"
          onClick={handleClose}
          aria-label="Close"
        >
          <Close />
        </IconButton>
      );
    }

    if (!visible) {
      return null;
    }

    return (
      <StyledAlert
        ref={ref}
        variant={variant}
        severity={severity}
        icon={getAlertIcon(severity)}
        loading={loading}
        action={
          actionElements.length > 0 ? (
            <Box display="flex" alignItems="center" gap={0.5}>
              {actionElements}
            </Box>
          ) : undefined
        }
        {...props}
      >
        {/* Title */}
        {title && (
          <AlertTitle sx={{ fontWeight: tokens.typography.fontWeight.semibold }}>
            {title}
          </AlertTitle>
        )}

        {/* Content */}
        {collapsible ? (
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box>{children}</Box>
          </Collapse>
        ) : (
          children
        )}

        {/* Loading progress */}
        {loading && (
          <AlertProgress
            variant={progress !== undefined ? 'determinate' : 'indeterminate'}
            value={progress}
            color={severity}
          />
        )}
      </StyledAlert>
    );
  }
);

Alert.displayName = 'Alert';

export default Alert;