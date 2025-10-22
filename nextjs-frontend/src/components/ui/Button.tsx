'use client';

import { forwardRef } from 'react';
import { Button as MuiButton, ButtonProps as MuiButtonProps, CircularProgress } from '@mui/material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

// Extended button variants
export type ButtonVariant = 'contained' | 'outlined' | 'text' | 'ghost' | 'link';
export type ButtonSize = 'small' | 'medium' | 'large';
export type ButtonColor = 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';

export interface ButtonProps extends Omit<MuiButtonProps, 'variant' | 'size' | 'color'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  color?: ButtonColor;
  loading?: boolean;
  loadingText?: string;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'start' | 'end';
}

// Styled button with custom variants
const StyledButton = styled(MuiButton, {
  shouldForwardProp: (prop) => !['loading', 'iconPosition', 'customVariant'].includes(prop as string),
})<ButtonProps & { customVariant?: ButtonVariant }>(({ theme, customVariant, size, loading }) => ({
  // Base styles
  fontWeight: tokens.typography.fontWeight.medium,
  borderRadius: tokens.borderRadius.lg,
  textTransform: 'none',
  transition: 'all 0.2s ease-in-out',
  position: 'relative',
  
  // Size variants
  ...(size === 'small' && {
    padding: tokens.components.button.padding.sm,
    fontSize: tokens.components.button.fontSize.sm,
    minHeight: tokens.components.button.height.sm,
  }),
  ...(size === 'medium' && {
    padding: tokens.components.button.padding.md,
    fontSize: tokens.components.button.fontSize.md,
    minHeight: tokens.components.button.height.md,
  }),
  ...(size === 'large' && {
    padding: tokens.components.button.padding.lg,
    fontSize: tokens.components.button.fontSize.lg,
    minHeight: tokens.components.button.height.lg,
  }),

  // Custom variant styles
  ...(customVariant === 'ghost' && {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.palette.text.primary,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  }),
  
  ...(customVariant === 'link' && {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.palette.primary.main,
    textDecoration: 'underline',
    padding: '4px 8px',
    minHeight: 'auto',
    '&:hover': {
      backgroundColor: 'transparent',
      textDecoration: 'none',
    },
  }),

  // Loading state
  ...(loading && {
    color: 'transparent',
    pointerEvents: 'none',
  }),

  // Focus styles
  '&:focus-visible': {
    outline: `2px solid ${theme.palette.primary.main}`,
    outlineOffset: '2px',
  },

  // Disabled styles
  '&:disabled': {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
}));

// Loading overlay component
const LoadingOverlay = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  color: 'inherit',
}));

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'contained',
      size = 'medium',
      color = 'primary',
      loading = false,
      loadingText,
      icon,
      iconPosition = 'start',
      disabled,
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    
    // Map custom variants to MUI variants
    const muiVariant = (variant === 'ghost' || variant === 'link') ? 'text' : 
                       (variant === 'contained' || variant === 'outlined') ? variant : 'contained';

    return (
      <StyledButton
        ref={ref}
        variant={muiVariant}
        size={size}
        color={color}
        disabled={isDisabled}
        customVariant={variant}
        startIcon={!loading && iconPosition === 'start' ? icon : undefined}
        endIcon={!loading && iconPosition === 'end' ? icon : undefined}
        {...props}
      >
        {children}
        
        {loading && (
          <LoadingOverlay>
            <CircularProgress 
              size={size === 'small' ? 16 : size === 'large' ? 24 : 20} 
              color="inherit" 
            />
            {loadingText && <span>{loadingText}</span>}
          </LoadingOverlay>
        )}
      </StyledButton>
    );
  }
);

Button.displayName = 'Button';

export default Button;