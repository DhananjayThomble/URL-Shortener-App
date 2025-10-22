'use client';

import { forwardRef } from 'react';
import {
  FormControl,
  InputLabel,
  Select as MuiSelect,
  SelectProps as MuiSelectProps,
  MenuItem,
  FormHelperText,
  Chip,
  Box,
  ListItemText,
  Checkbox,
  InputAdornment,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { ExpandMore, Check } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type SelectSize = 'small' | 'medium' | 'large';
export type SelectVariant = 'outlined' | 'filled' | 'standard';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  description?: string;
}

export interface SelectProps extends Omit<MuiSelectProps, 'size' | 'variant'> {
  size?: SelectSize;
  variant?: SelectVariant;
  options: SelectOption[];
  placeholder?: string;
  success?: boolean;
  successMessage?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  searchable?: boolean;
  clearable?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  groupBy?: (option: SelectOption) => string;
}

// Styled FormControl with custom sizing
const StyledFormControl = styled(FormControl, {
  shouldForwardProp: (prop) => !['success', 'selectSize'].includes(prop as string),
})<{ success?: boolean; selectSize?: SelectSize }>(({ theme, success, selectSize }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: tokens.borderRadius.lg,
    transition: 'all 0.2s ease-in-out',
    
    // Size variants
    ...(selectSize === 'small' && {
      minHeight: tokens.components.input.height.sm,
      '& .MuiSelect-select': {
        padding: tokens.components.input.padding.sm,
        fontSize: tokens.typography.fontSize.sm[0],
      },
    }),
    ...(selectSize === 'medium' && {
      minHeight: tokens.components.input.height.md,
      '& .MuiSelect-select': {
        padding: tokens.components.input.padding.md,
        fontSize: tokens.typography.fontSize.base[0],
      },
    }),
    ...(selectSize === 'large' && {
      minHeight: tokens.components.input.height.lg,
      '& .MuiSelect-select': {
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

  // Label styles
  '& .MuiInputLabel-root': {
    fontWeight: tokens.typography.fontWeight.medium,
    
    ...(selectSize === 'small' && {
      fontSize: tokens.typography.fontSize.sm[0],
    }),
    ...(selectSize === 'large' && {
      fontSize: tokens.typography.fontSize.lg[0],
    }),
  },
}));

// Custom dropdown icon
const DropdownIcon = styled(ExpandMore)(({ theme }) => ({
  transition: 'transform 0.2s ease-in-out',
  '.MuiSelect-open &': {
    transform: 'rotate(180deg)',
  },
}));

// Multi-select chip container
const ChipContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(0.5),
  maxWidth: '100%',
}));

export const Select = forwardRef<HTMLInputElement, SelectProps>(
  (
    {
      size = 'medium',
      variant = 'outlined',
      options = [],
      placeholder,
      success = false,
      successMessage,
      error = false,
      helperText,
      leftIcon,
      multiple = false,
      value,
      label,
      loading = false,
      emptyMessage = 'No options available',
      ...props
    },
    ref
  ) => {
    // Build start adornment
    const startAdornment = leftIcon ? (
      <InputAdornment position="start">
        {leftIcon}
      </InputAdornment>
    ) : undefined;

    // Render value for multiple select
    const renderValue = (selected: any) => {
      if (!multiple) return selected;
      
      if (!selected || selected.length === 0) {
        return <em>{placeholder || 'Select options...'}</em>;
      }

      return (
        <ChipContainer>
          {(selected as string[]).map((value) => {
            const option = options.find(opt => opt.value === value);
            return (
              <Chip
                key={value}
                label={option?.label || value}
                size="small"
                variant="outlined"
                sx={{ maxWidth: 120 }}
              />
            );
          })}
        </ChipContainer>
      );
    };

    // Combine helper text and success message
    let combinedHelperText = helperText;
    if (success && successMessage && !error) {
      combinedHelperText = successMessage;
    }

    return (
      <StyledFormControl
        fullWidth
        variant={variant}
        error={error}
        success={success}
        selectSize={size}
      >
        {label && (
          <InputLabel id={`select-label-${label}`}>
            {label}
          </InputLabel>
        )}
        
        <MuiSelect
          ref={ref}
          labelId={label ? `select-label-${label}` : undefined}
          label={label}
          multiple={multiple}
          value={value}
          displayEmpty={!!placeholder}
          renderValue={renderValue}
          IconComponent={DropdownIcon}
          startAdornment={startAdornment}
          MenuProps={{
            PaperProps: {
              sx: {
                borderRadius: tokens.borderRadius.lg,
                boxShadow: tokens.shadows.lg,
                maxHeight: 300,
                '& .MuiMenuItem-root': {
                  borderRadius: tokens.borderRadius.sm,
                  margin: '2px 8px',
                  '&:hover': {
                    backgroundColor: 'action.hover',
                  },
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': {
                      backgroundColor: 'primary.dark',
                    },
                  },
                },
              },
            },
          }}
          {...props}
        >
          {placeholder && !multiple && (
            <MenuItem value="" disabled>
              <em>{placeholder}</em>
            </MenuItem>
          )}
          
          {loading ? (
            <MenuItem disabled>
              <em>Loading...</em>
            </MenuItem>
          ) : options.length === 0 ? (
            <MenuItem disabled>
              <em>{emptyMessage}</em>
            </MenuItem>
          ) : (
            options.map((option) => (
              <MenuItem
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {multiple && (
                  <Checkbox
                    checked={Array.isArray(value) && value.includes(option.value)}
                    size="small"
                  />
                )}
                
                {option.icon && (
                  <Box component="span" sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                    {option.icon}
                  </Box>
                )}
                
                <ListItemText
                  primary={option.label}
                  secondary={option.description}
                  primaryTypographyProps={{
                    fontSize: size === 'small' ? tokens.typography.fontSize.sm[0] : 
                             size === 'large' ? tokens.typography.fontSize.lg[0] : 
                             tokens.typography.fontSize.base[0],
                  }}
                />
                
                {!multiple && Array.isArray(value) ? 
                  value.includes(option.value) && <Check fontSize="small" /> :
                  value === option.value && <Check fontSize="small" />
                }
              </MenuItem>
            ))
          )}
        </MuiSelect>
        
        {combinedHelperText && (
          <FormHelperText>
            {combinedHelperText}
          </FormHelperText>
        )}
      </StyledFormControl>
    );
  }
);

Select.displayName = 'Select';

export default Select;