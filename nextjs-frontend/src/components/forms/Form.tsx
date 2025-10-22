'use client';

import { forwardRef, useEffect, useCallback } from 'react';
import {
  useForm,
  FormProvider,
  UseFormProps,
  UseFormReturn,
  FieldValues,
  DefaultValues,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ZodSchema } from 'zod';
import {
  Box,
  Stack,
  Alert,
  LinearProgress,
  Typography,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export interface FormProps<T extends FieldValues = FieldValues> extends Omit<UseFormProps<T>, 'resolver'> {
  schema?: ZodSchema<T>;
  onSubmit: (data: T) => void | Promise<void>;
  children: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  success?: string | null;
  autoSave?: boolean;
  autoSaveDelay?: number;
  resetOnSuccess?: boolean;
  className?: string;
  title?: string;
  subtitle?: string;
  showProgress?: boolean;
  onFormChange?: (data: T, isValid: boolean) => void;
}

// Styled form container
const FormContainer = styled('form')(({ theme }) => ({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
}));

// Form header component
const FormHeader: React.FC<{ title?: string; subtitle?: string }> = ({ title, subtitle }) => {
  if (!title && !subtitle) return null;

  return (
    <Box sx={{ mb: 2 }}>
      {title && (
        <Typography variant="h5" component="h2" gutterBottom>
          {title}
        </Typography>
      )}
      {subtitle && (
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      )}
    </Box>
  );
};

// Auto-save hook
const useAutoSave = <T extends FieldValues>(
  watch: UseFormReturn<T>['watch'],
  getValues: UseFormReturn<T>['getValues'],
  isValid: boolean,
  enabled: boolean,
  delay: number,
  onSave?: (data: T) => void
) => {
  const saveData = useCallback(
    (data: T) => {
      if (enabled && isValid && onSave) {
        onSave(data);
      }
    },
    [enabled, isValid, onSave]
  );

  useEffect(() => {
    if (!enabled) return;

    const subscription = watch((data) => {
      const timeoutId = setTimeout(() => {
        saveData(data as T);
      }, delay);

      return () => clearTimeout(timeoutId);
    });

    return () => subscription.unsubscribe();
  }, [watch, saveData, delay, enabled]);
};

function FormComponent<T extends FieldValues = FieldValues>(
  {
    schema,
    onSubmit,
    children,
    loading = false,
    error = null,
    success = null,
    autoSave = false,
    autoSaveDelay = 2000,
    resetOnSuccess = false,
    className,
    title,
    subtitle,
    showProgress = false,
    onFormChange,
    defaultValues,
    ...formProps
  }: FormProps<T>,
  ref: React.ForwardedRef<HTMLFormElement>
) {
    // Initialize form with schema resolver if provided
    const methods = useForm<T>({
      resolver: schema ? zodResolver(schema as any) : undefined,
      defaultValues,
      mode: 'onChange',
      ...formProps,
    });

    const {
      handleSubmit,
      watch,
      getValues,
      reset,
      formState: { isValid, isSubmitting, errors, isDirty },
    } = methods;

    // Auto-save functionality
    useAutoSave(
      watch,
      getValues,
      isValid,
      autoSave,
      autoSaveDelay,
      (data) => {
        // Auto-save callback - could save to localStorage or API
        console.log('Auto-saving form data:', data);
      }
    );

    // Form change callback
    useEffect(() => {
      if (onFormChange) {
        const subscription = watch((data) => {
          onFormChange(data as T, isValid);
        });
        return () => subscription.unsubscribe();
      }
    }, [watch, onFormChange, isValid]);

    // Reset form on success if enabled
    useEffect(() => {
      if (success && resetOnSuccess) {
        reset();
      }
    }, [success, resetOnSuccess, reset]);

    // Handle form submission
    const handleFormSubmit = async (data: T) => {
      try {
        await onSubmit(data);
      } catch (error) {
        console.error('Form submission error:', error);
      }
    };

    // Calculate form progress
    const getFormProgress = () => {
      if (!showProgress) return 0;
      
      const totalFields = Object.keys(getValues()).length;
      const filledFields = Object.values(getValues()).filter(
        (value) => value !== undefined && value !== null && value !== ''
      ).length;
      
      return totalFields > 0 ? (filledFields / totalFields) * 100 : 0;
    };

    const progress = getFormProgress();

    return (
      <FormProvider {...methods}>
        <FormContainer
          ref={ref}
          onSubmit={handleSubmit(handleFormSubmit)}
          className={className}
          noValidate
        >
          <FormHeader title={title} subtitle={subtitle} />

          {/* Progress indicator */}
          {showProgress && (
            <Box sx={{ mb: 2 }}>
              <Box display="flex" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Form Progress
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {Math.round(progress)}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'action.hover',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 3,
                  },
                }}
              />
            </Box>
          )}

          {/* Loading indicator */}
          {(loading || isSubmitting) && (
            <LinearProgress
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 1,
              }}
            />
          )}

          {/* Error message */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Success message */}
          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {/* Form validation errors */}
          {Object.keys(errors).length > 0 && (
            <Alert severity="error" sx={{ mb: 2 }}>
              <Typography variant="body2" gutterBottom>
                Please fix the following errors:
              </Typography>
              <Stack spacing={0.5}>
                {Object.entries(errors).map(([field, error]) => (
                  <Typography key={field} variant="caption" component="div">
                    • {String(error?.message) || `${field} is invalid`}
                  </Typography>
                ))}
              </Stack>
            </Alert>
          )}

          {/* Auto-save indicator */}
          {autoSave && isDirty && (
            <Box display="flex" alignItems="center" gap={1} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {isValid ? '✓ Changes saved automatically' : '⚠ Unsaved changes'}
              </Typography>
            </Box>
          )}

          {/* Form content */}
          <Box sx={{ position: 'relative' }}>
            {children}
          </Box>
        </FormContainer>
      </FormProvider>
    );
}

export const Form = forwardRef(FormComponent) as <T extends FieldValues = FieldValues>(
  props: FormProps<T> & { ref?: React.ForwardedRef<HTMLFormElement> }
) => ReturnType<typeof FormComponent>;

(Form as any).displayName = 'Form';

export default Form;