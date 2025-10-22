'use client';

import { forwardRef } from 'react';
import { useController, useFormContext, FieldPath, FieldValues } from 'react-hook-form';
import {
  FormControl,
  FormLabel,
  FormHelperText,
  Box,
  Typography,
} from '@mui/material';
import { Input, Select, Button } from '@/components/ui';
import type { InputProps, SelectProps, SelectOption } from '@/components/ui';

// Base form field props
interface BaseFormFieldProps {
  name: string;
  label?: string;
  helperText?: string;
  required?: boolean;
  disabled?: boolean;
  description?: string;
}

// Input field props
export interface FormInputProps extends BaseFormFieldProps, Omit<InputProps, 'name' | 'value' | 'onChange' | 'error' | 'helperText' | 'label'> {
  checkboxLabel?: string;
}

// Select field props
export interface FormSelectProps extends BaseFormFieldProps, Omit<SelectProps, 'name' | 'value' | 'onChange' | 'error' | 'helperText' | 'label'> {
  options: SelectOption[];
}

// Checkbox field props
export interface FormCheckboxProps extends BaseFormFieldProps {
  checkboxLabel?: string;
}

// Radio group field props
export interface FormRadioGroupProps extends BaseFormFieldProps {
  options: { value: string; label: string; disabled?: boolean }[];
  direction?: 'row' | 'column';
}

// Generic form field component
export const FormField = forwardRef<HTMLDivElement, BaseFormFieldProps & { children: React.ReactNode }>(
  ({ name, label, helperText, required, disabled, description, children }, ref) => {
    const { formState: { errors } } = useFormContext();
    const error = errors[name];

    return (
      <FormControl
        ref={ref}
        fullWidth
        error={!!error}
        disabled={disabled}
        required={required}
      >
        {label && (
          <FormLabel component="legend" sx={{ mb: 1, fontWeight: 'medium' }}>
            {label}
            {required && (
              <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
                *
              </Typography>
            )}
          </FormLabel>
        )}
        
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {description}
          </Typography>
        )}

        {children}

        {(helperText || error) && (
          <FormHelperText>
            {String(error?.message) || helperText}
          </FormHelperText>
        )}
      </FormControl>
    );
  }
);

FormField.displayName = 'FormField';

// Input field component
export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  ({ name, label, helperText, required, disabled, description, checkboxLabel, type, ...inputProps }, ref) => {
    const { control } = useFormContext();
    const {
      field: { value, onChange, onBlur },
      fieldState: { error },
    } = useController({
      name,
      control,
    });

    // Handle checkbox type
    if (type === 'checkbox') {
      return (
        <FormField
          name={name}
          label={label}
          helperText={helperText}
          required={required}
          disabled={disabled}
          description={description}
        >
          <Box>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                ref={ref}
                type="checkbox"
                checked={!!value}
                onChange={(e) => onChange(e.target.checked)}
                disabled={disabled}
                style={{ marginRight: 8 }}
              />
              {checkboxLabel || 'Check this box'}
            </label>
          </Box>
        </FormField>
      );
    }

    return (
      <FormField
        name={name}
        label={label}
        helperText={helperText}
        required={required}
        disabled={disabled}
        description={description}
      >
        <Input
          ref={ref}
          value={value || ''}
          onChange={onChange}
          onBlur={onBlur}
          error={!!error}
          disabled={disabled}
          type={type}
          {...inputProps}
        />
      </FormField>
    );
  }
);

FormInput.displayName = 'FormInput';

// Select field component
export const FormSelect = forwardRef<HTMLInputElement, FormSelectProps>(
  ({ name, label, helperText, required, disabled, description, options, ...selectProps }, ref) => {
    const { control } = useFormContext();
    const {
      field: { value, onChange, onBlur },
      fieldState: { error },
    } = useController({
      name,
      control,
    });

    return (
      <FormField
        name={name}
        label={label}
        helperText={helperText}
        required={required}
        disabled={disabled}
        description={description}
      >
        <Select
          ref={ref}
          value={value || (selectProps.multiple ? [] : '')}
          onChange={onChange}
          onBlur={onBlur}
          error={!!error}
          disabled={disabled}
          options={options}
          {...selectProps}
        />
      </FormField>
    );
  }
);

FormSelect.displayName = 'FormSelect';

// Checkbox field component
export const FormCheckbox = forwardRef<HTMLInputElement, FormCheckboxProps>(
  ({ name, label, helperText, required, disabled, description, checkboxLabel }, ref) => {
    const { control } = useFormContext();
    const {
      field: { value, onChange },
      fieldState: { error },
    } = useController({
      name,
      control,
    });

    return (
      <FormField
        name={name}
        label={label}
        helperText={helperText}
        required={required}
        disabled={disabled}
        description={description}
      >
        <Box>
          <label>
            <input
              ref={ref}
              type="checkbox"
              checked={!!value}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
              style={{ marginRight: 8 }}
            />
            {checkboxLabel || 'Check this box'}
          </label>
        </Box>
      </FormField>
    );
  }
);

FormCheckbox.displayName = 'FormCheckbox';

// Radio group field component
export const FormRadioGroup = forwardRef<HTMLInputElement, FormRadioGroupProps>(
  ({ name, label, helperText, required, disabled, description, options, direction = 'column' }, ref) => {
    const { control } = useFormContext();
    const {
      field: { value, onChange },
      fieldState: { error },
    } = useController({
      name,
      control,
    });

    return (
      <FormField
        name={name}
        label={label}
        helperText={helperText}
        required={required}
        disabled={disabled}
        description={description}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: direction,
            gap: 1,
          }}
        >
          {options.map((option) => (
            <label key={option.value} style={{ display: 'flex', alignItems: 'center' }}>
              <input
                ref={ref}
                type="radio"
                value={option.value}
                checked={value === option.value}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled || option.disabled}
                style={{ marginRight: 8 }}
              />
              {option.label}
            </label>
          ))}
        </Box>
      </FormField>
    );
  }
);

FormRadioGroup.displayName = 'FormRadioGroup';

// Form submit button component
export interface FormSubmitButtonProps {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
}

export const FormSubmitButton: React.FC<FormSubmitButtonProps> = ({
  children,
  loading,
  disabled,
  ...buttonProps
}) => {
  const { formState: { isSubmitting, isValid } } = useFormContext();

  return (
    <Button
      type="submit"
      loading={loading || isSubmitting}
      disabled={disabled || isSubmitting || !isValid}
      {...buttonProps}
    >
      {children}
    </Button>
  );
};

// Form reset button component
export interface FormResetButtonProps {
  children: React.ReactNode;
  onReset?: () => void;
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info';
  size?: 'small' | 'medium' | 'large';
}

export const FormResetButton: React.FC<FormResetButtonProps> = ({
  children,
  onReset,
  ...buttonProps
}) => {
  const { reset, formState: { isDirty } } = useFormContext();

  const handleReset = () => {
    reset();
    onReset?.();
  };

  return (
    <Button
      type="button"
      onClick={handleReset}
      disabled={!isDirty}
      variant="outlined"
      {...buttonProps}
    >
      {children}
    </Button>
  );
};