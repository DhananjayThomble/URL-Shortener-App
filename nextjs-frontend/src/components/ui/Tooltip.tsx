'use client';

import { forwardRef } from 'react';
import { Tooltip as MuiTooltip, TooltipProps as MuiTooltipProps, Zoom, Fade, Grow } from '@mui/material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export type TooltipVariant = 'default' | 'arrow' | 'light' | 'dark';
export type TooltipSize = 'small' | 'medium' | 'large';
export type TooltipAnimation = 'fade' | 'zoom' | 'grow';

export interface TooltipProps extends Omit<MuiTooltipProps, 'title'> {
  variant?: TooltipVariant;
  size?: TooltipSize;
  animation?: TooltipAnimation;
  title: React.ReactNode;
  maxWidth?: number;
  multiline?: boolean;
}

// Styled Tooltip with custom variants
const StyledTooltip = styled(MuiTooltip, {
  shouldForwardProp: (prop) => !['tooltipVariant', 'tooltipSize', 'maxWidth'].includes(prop as string),
})<{ 
  tooltipVariant?: TooltipVariant; 
  tooltipSize?: TooltipSize;
  maxWidth?: number;
}>(({ theme, tooltipVariant, tooltipSize, maxWidth }) => ({
  '& .MuiTooltip-tooltip': {
    borderRadius: tokens.borderRadius.md,
    fontWeight: tokens.typography.fontWeight.medium,
    maxWidth: maxWidth || 300,
    
    // Size variants
    ...(tooltipSize === 'small' && {
      fontSize: tokens.typography.fontSize.xs[0],
      padding: '4px 8px',
    }),
    ...(tooltipSize === 'medium' && {
      fontSize: tokens.typography.fontSize.sm[0],
      padding: '6px 12px',
    }),
    ...(tooltipSize === 'large' && {
      fontSize: tokens.typography.fontSize.base[0],
      padding: '8px 16px',
    }),

    // Variant styles
    ...(tooltipVariant === 'light' && {
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      border: `1px solid ${theme.palette.divider}`,
      boxShadow: tokens.shadows.md,
    }),
    
    ...(tooltipVariant === 'dark' && {
      backgroundColor: theme.palette.grey[900],
      color: theme.palette.common.white,
    }),
    
    ...(tooltipVariant === 'arrow' && {
      position: 'relative',
    }),
  },

  // Arrow styles for light variant
  ...(tooltipVariant === 'light' && {
    '& .MuiTooltip-arrow': {
      color: theme.palette.background.paper,
      '&::before': {
        border: `1px solid ${theme.palette.divider}`,
      },
    },
  }),

  // Arrow styles for dark variant
  ...(tooltipVariant === 'dark' && {
    '& .MuiTooltip-arrow': {
      color: theme.palette.grey[900],
    },
  }),
}));

export const Tooltip = forwardRef<HTMLDivElement, TooltipProps>(
  (
    {
      variant = 'default',
      size = 'medium',
      animation = 'fade',
      title,
      maxWidth,
      multiline = false,
      children,
      placement = 'top',
      ...props
    },
    ref
  ) => {
    // Select transition component based on animation
    const getTransitionComponent = () => {
      switch (animation) {
        case 'zoom':
          return Zoom;
        case 'grow':
          return Grow;
        case 'fade':
        default:
          return Fade;
      }
    };

    // Format title for multiline support
    const formatTitle = (content: React.ReactNode) => {
      if (multiline && typeof content === 'string') {
        return content.split('\n').map((line, index, array) => (
          <span key={index}>
            {line}
            {index < array.length - 1 && <br />}
          </span>
        ));
      }
      return content;
    };

    return (
      <StyledTooltip
        ref={ref}
        title={formatTitle(title)}
        placement={placement}
        arrow={variant === 'arrow'}
        TransitionComponent={getTransitionComponent()}
        tooltipVariant={variant}
        tooltipSize={size}
        maxWidth={maxWidth}
        enterDelay={500}
        leaveDelay={200}
        {...props}
      >
        <span>{children}</span>
      </StyledTooltip>
    );
  }
);

Tooltip.displayName = 'Tooltip';

export default Tooltip;