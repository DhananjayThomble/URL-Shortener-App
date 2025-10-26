'use client';

import { forwardRef, useState } from 'react';
import {
  TextField,
  TextFieldProps,
  InputAdornment,
  IconButton,
  FormHelperText,
  Box,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { Visibility, VisibilityOff, Error, CheckCircle } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type InputSize = 'small' | 'medium' | 'large';
export type InputVariant = 'outlined' | 'filled' | 'standard';

export interface InputProps extends Omit<TextFieldProps, 'size' | 'variant'> {
  size?: InputSize;
  variant?: InputVariant;
  showPasswordToggle?: boolean;
  success?: boolean;
  successMessage?: string;
  characterLimit?: number;
  showCharacterCount?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onRightIconClick?: () => void;
}

// Styled TextField with custom sizing
const StyledTextField = styled(TextField, {
  shouldForwardProp: (prop) => !['success', 'inputSize'].includes(prop as string),
})<{ success?: boolean; inputSize?: InputSize }>(({ theme, success, inputSize }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: tokens.borderRadius.lg,
    transition: 'all 0.2s ease-in-out',
    
    // Size variants
    ...(inputSize === 'small' && {
      minHeight: tokens.components.input.height.sm,
      '& .MuiOutlinedInput-input': {
        padding: tokens.components.input.padding.sm,
        fontSize: tokens.typography.fontSize.sm[0],
      },
    }),
    ...(inputSize === 'medium' && {
      minHeight: tokens.components.input.height.md,
      '& .MuiOutlinedInput-input': {
        padding: tokens.components.input.padding.md,
        fontSize: tokens.typography.fontSize.base[0],
      },
    }),
    ...(inputSize === 'large' && {
      minHeight: tokens.components.input.height.lg,
      '& .MuiOutlinedInput-input': {
        padding: tokens.components.input.padding.lg,
        fontSize: tokens.typography.fontSize.lg[0],
      },
    }),

    // Success state
    ...(success && {
      '& .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.success.main,
      },
      '&:hover .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.success.main,
      },
      '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
        borderColor: theme.palette.success.main,
        borderWidth: '2px',
      },
    }),
  },

  // Focus styles
  '& .MuiOutlinedInput-root.Mui-focused': {
    '& .MuiOutlinedInput-notchedOutline': {
      borderWidth: '2px',
    },
  },

  // Label styles
  '& .MuiInputLabel-root': {
    fontWeight: tokens.typography.fontWeight.medium,
    
    ...(inputSize === 'small' && {
      fontSize: tokens.typography.fontSize.sm[0],
    }),
    ...(inputSize === 'large' && {
      fontSize: tokens.typography.fontSize.lg[0],
    }),
  },
}));

// Character count component
const CharacterCount = styled(Typography)(({ theme }) => ({
  fontSize: tokens.typography.fontSize.xs[0],
  color: theme.palette.text.secondary,
  textAlign: 'right',
  marginTop: theme.spacing(0.5),
}));

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = 'medium',
      variant = 'outlined',
      type = 'text',
      showPasswordToggle = false,
      success = false,
      successMessage,
      error = false,
      helperText,
      characterLimit,
      showCharacterCount = false,
      leftIcon,
      rightIcon,
      onRightIconClick,
      value = '',
      onChange,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = useState(false);
    const [internalValue, setInternalValue] = useState(value);

    // Handle password visibility toggle
    const handleTogglePassword = () => {
      setShowPassword(!showPassword);
    };

    // Handle value change
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = event.target.value;
      
      // Enforce character limit
      if (characterLimit && newValue.length > characterLimit) {
        return;
      }
      
      setInternalValue(newValue);
      onChange?.(event);
    };

    // Determine input type
    const inputType = type === 'password' && showPassword ? 'text' : type;
    
    // Calculate character count
    const currentLength = String(value || internalValue).length;
    const isOverLimit = characterLimit ? currentLength > characterLimit : false;

    // Build start adornment
    const startAdornment = leftIcon ? (
      <InputAdornment position="start">
        {leftIcon}
      </InputAdornment>
    ) : undefined;

    // Build end adornment
    let endAdornment = null;
    const endElements = [];

    // Add success/error icons
    if (success && !error) {
      endElements.push(
        <CheckCircle key="success" color="success" fontSize="small" />
      );
    } else if (error) {
      endElements.push(
        <Error key="error" color="error" fontSize="small" />
      );
    }

    // Add custom right icon
    if (rightIcon) {
      endElements.push(
        <IconButton
          key="right-icon"
          onClick={onRightIconClick}
          edge="end"
          size="small"
        >
          {rightIcon}
        </IconButton>
      );
    }

    // Add password toggle
    if (showPasswordToggle && type === 'password') {
      endElements.push(
        <IconButton
          key="password-toggle"
          onClick={handleTogglePassword}
          edge="end"
          size="small"
          aria-label="toggle password visibility"
        >
          {showPassword ? <VisibilityOff /> : <Visibility />}
        </IconButton>
      );
    }

    if (endElements.length > 0) {
      endAdornment = (
        <InputAdornment position="end">
          <Box display="flex" alignItems="center" gap={0.5}>
            {endElements}
          </Box>
        </InputAdornment>
      );
    }

    // Combine helper text and success message
    let combinedHelperText = helperText;
    if (success && successMessage && !error) {
      combinedHelperText = successMessage;
    }

    return (
      <Box>
        <StyledTextField
          ref={ref}
          variant={variant}
          type={inputType}
          success={success}
          inputSize={size}
          error={error}
          helperText={combinedHelperText}
          value={value || internalValue}
          onChange={handleChange}
          InputProps={{
            startAdornment,
            endAdornment,
          }}
          {...props}
        />
        
        {(showCharacterCount || characterLimit) && (
          <CharacterCount
            color={isOverLimit ? 'error' : 'textSecondary'}
          >
            {currentLength}
            {characterLimit && ` / ${characterLimit}`}
          </CharacterCount>
        )}
      </Box>
    );
  }
);

Input.displayName = 'Input';

export default Input;