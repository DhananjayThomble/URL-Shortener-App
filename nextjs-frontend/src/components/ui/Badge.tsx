'use client';

import { forwardRef } from 'react';
import { Badge as MuiBadge, BadgeProps as MuiBadgeProps } from '@mui/material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export type BadgeVariant = 'standard' | 'dot' | 'outlined';
export type BadgeSize = 'small' | 'medium' | 'large';
export type BadgeColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
export type BadgePosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface BadgeProps extends Omit<MuiBadgeProps, 'variant' | 'color'> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  color?: BadgeColor;
  position?: BadgePosition;
  pulse?: boolean;
  showZero?: boolean;
  maxCount?: number;
}

// Styled Badge with custom variants
const StyledBadge = styled(MuiBadge, {
  shouldForwardProp: (prop) => !['pulse', 'badgeSize', 'customVariant', 'position'].includes(prop as string),
})<{ 
  pulse?: boolean; 
  badgeSize?: BadgeSize; 
  customVariant?: BadgeVariant;
  position?: BadgePosition;
}>(({ theme, pulse, badgeSize, customVariant, position }) => ({
  '& .MuiBadge-badge': {
    fontWeight: tokens.typography.fontWeight.medium,
    fontSize: tokens.typography.fontSize.xs[0],
    borderRadius: tokens.borderRadius.full,
    border: `2px solid ${theme.palette.background.paper}`,
    
    // Size variants
    ...(badgeSize === 'small' && {
      minWidth: 16,
      height: 16,
      fontSize: '0.625rem',
      padding: '0 4px',
    }),
    ...(badgeSize === 'medium' && {
      minWidth: 20,
      height: 20,
      fontSize: tokens.typography.fontSize.xs[0],
      padding: '0 6px',
    }),
    ...(badgeSize === 'large' && {
      minWidth: 24,
      height: 24,
      fontSize: tokens.typography.fontSize.sm[0],
      padding: '0 8px',
    }),

    // Variant styles
    ...(customVariant === 'outlined' && {
      backgroundColor: 'transparent',
      color: theme.palette.primary.main,
      border: `2px solid ${theme.palette.primary.main}`,
    }),
    
    ...(customVariant === 'dot' && {
      minWidth: badgeSize === 'small' ? 8 : badgeSize === 'large' ? 12 : 10,
      height: badgeSize === 'small' ? 8 : badgeSize === 'large' ? 12 : 10,
      borderRadius: '50%',
      padding: 0,
    }),

    // Position variants
    ...(position === 'top-left' && {
      top: '14%',
      right: 'auto',
      left: '14%',
      transform: 'scale(1) translate(-50%, -50%)',
    }),
    ...(position === 'bottom-right' && {
      top: 'auto',
      bottom: '14%',
      right: '14%',
      transform: 'scale(1) translate(50%, 50%)',
    }),
    ...(position === 'bottom-left' && {
      top: 'auto',
      bottom: '14%',
      right: 'auto',
      left: '14%',
      transform: 'scale(1) translate(-50%, 50%)',
    }),

    // Pulse animation
    ...(pulse && {
      animation: 'badge-pulse 2s infinite',
      '@keyframes badge-pulse': {
        '0%': {
          transform: 'scale(1)',
          opacity: 1,
        },
        '50%': {
          transform: 'scale(1.1)',
          opacity: 0.8,
        },
        '100%': {
          transform: 'scale(1)',
          opacity: 1,
        },
      },
    }),
  },
}));

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = 'standard',
      size = 'medium',
      color = 'primary',
      position = 'top-right',
      pulse = false,
      showZero = false,
      maxCount = 99,
      badgeContent,
      children,
      ...props
    },
    ref
  ) => {
    // Handle badge content formatting
    const formatBadgeContent = (content: any) => {
      if (typeof content === 'number') {
        if (content === 0 && !showZero) {
          return undefined;
        }
        if (content > maxCount) {
          return `${maxCount}+`;
        }
        return content;
      }
      return content;
    };

    // Map custom variant to MUI variant
    const muiVariant = variant === 'outlined' ? 'standard' : variant;

    return (
      <StyledBadge
        ref={ref}
        variant={muiVariant}
        color={color}
        badgeContent={formatBadgeContent(badgeContent)}
        pulse={pulse}
        badgeSize={size}
        customVariant={variant}
        position={position}
        {...props}
      >
        {children}
      </StyledBadge>
    );
  }
);

Badge.displayName = 'Badge';

export default Badge;