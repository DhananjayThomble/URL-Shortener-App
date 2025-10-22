'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';
// We'll implement ValidationUtils inline for now
const ValidationUtils = {
  formatValidationErrors: (error: z.ZodError) => {
    const errors: Record<string, string> = {};
    error.issues.forEach((err: any) => {
      const path = err.path.join('.');
      errors[path] = err.message;
    });
    return errors;
  },
};

export interface FormField {
  value: any;
  error?: string;
  touched: boolean;
  dirty: boolean;
  validating: boolean;
}

export interface FormState {
  fields: Record<string, FormField>;
  isValid: boolean;
  isSubmitting: boolean;
  isDirty: boolean;
  submitCount: number;
  errors: Record<string, string>;
}

export interface UseAdvancedFormOptions<T = any> {
  initialValues?: Partial<T>;
  validationSchema?: z.ZodType<T>;
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  validateDebounceMs?: number;
  onSubmit?: (values: T) => Promise<void> | void;
  onValidationError?: (errors: Record<string, string>) => void;
  enableAutoSave?: boolean;
  autoSaveKey?: string;
  autoSaveDebounceMs?: number;
}

export interface FormActions<T = any> {
  setFieldValue: (field: keyof T, value: any) => void;
  setFieldError: (field: keyof T, error: string) => void;
  setFieldTouched: (field: keyof T, touched?: boolean) => void;
  setErrors: (errors: Record<string, string>) => void;
  setValues: (values: Partial<T>) => void;
  resetForm: (values?: Partial<T>) => void;
  validateField: (field: keyof T) => Promise<boolean>;
  validateForm: () => Promise<boolean>;
  submitForm: () => Promise<void>;
  clearErrors: () => void;
  markAllTouched: () => void;
}

export function useAdvancedForm<T extends Record<string, any> = any>(
  options: UseAdvancedFormOptions<T> = {}
): [FormState, FormActions<T>] {
  const {
    initialValues = {} as Partial<T>,
    validationSchema,
    validateOnChange = true,
    validateOnBlur = true,
    validateDebounceMs = 300,
    onSubmit,
    onValidationError,
    enableAutoSave = false,
    autoSaveKey,
    autoSaveDebounceMs = 1000,
  } = options;

  // Initialize form state
  const [formState, setFormState] = useState<FormState>(() => {
    const fields: Record<string, FormField> = {};
    
    // Load from localStorage if autoSave is enabled
    let savedValues = initialValues;
    if (enableAutoSave && autoSaveKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`form_${autoSaveKey}`);
        if (saved) {
          savedValues = { ...initialValues, ...JSON.parse(saved) };
        }
      } catch (error) {
        console.warn('Failed to load saved form data:', error);
      }
    }

    // Initialize fields
    Object.keys(savedValues || {}).forEach(key => {
      fields[key] = {
        value: savedValues[key as keyof typeof savedValues],
        touched: false,
        dirty: false,
        validating: false,
      };
    });

    return {
      fields,
      isValid: true,
      isSubmitting: false,
      isDirty: false,
      submitCount: 0,
      errors: {},
    };
  });

  // Refs for debouncing
  const validationTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autoSaveTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Get current values
  const getCurrentValues = useCallback((): T => {
    const values: any = {};
    Object.keys(formState.fields).forEach(key => {
      values[key] = formState.fields[key].value;
    });
    return values;
  }, [formState.fields]);

  // Auto-save functionality
  const autoSave = useCallback(() => {
    if (!enableAutoSave || !autoSaveKey || typeof window === 'undefined') return;

    if (autoSaveTimeout.current) {
      clearTimeout(autoSaveTimeout.current);
    }

    autoSaveTimeout.current = setTimeout(() => {
      try {
        const values = getCurrentValues();
        localStorage.setItem(`form_${autoSaveKey}`, JSON.stringify(values));
      } catch (error) {
        console.warn('Failed to auto-save form data:', error);
      }
    }, autoSaveDebounceMs);
  }, [enableAutoSave, autoSaveKey, autoSaveDebounceMs, getCurrentValues]);

  // Validate single field
  const validateField = useCallback(async (fieldName: keyof T): Promise<boolean> => {
    if (!validationSchema) return true;

    const values = getCurrentValues();
    
    try {
      // Try to validate the entire form and check for this field's errors
      await validationSchema.parseAsync(values);
      
      // Clear field error if validation passes
      setFormState(prev => {
        const newErrors = { ...prev.errors };
        delete newErrors[fieldName as string];
        
        return {
          ...prev,
          fields: {
            ...prev.fields,
            [fieldName]: {
              ...prev.fields[fieldName as string],
              validating: false,
              error: undefined,
            },
          },
          errors: newErrors,
        };
      });
      
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldError = error.issues.find((err: any) => 
          err.path.includes(fieldName as string)
        );
        
        if (fieldError) {
          setFormState(prev => ({
            ...prev,
            fields: {
              ...prev.fields,
              [fieldName]: {
                ...prev.fields[fieldName as string],
                validating: false,
                error: fieldError.message,
              },
            },
            errors: {
              ...prev.errors,
              [fieldName as string]: fieldError.message,
            },
          }));
        }
      }
      return false;
    }
  }, [validationSchema, getCurrentValues]);

  // Debounced field validation
  const debouncedValidateField = useCallback((fieldName: keyof T) => {
    if (validationTimeouts.current[fieldName as string]) {
      clearTimeout(validationTimeouts.current[fieldName as string]);
    }

    setFormState(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [fieldName]: {
          ...prev.fields[fieldName as string],
          validating: true,
        },
      },
    }));

    validationTimeouts.current[fieldName as string] = setTimeout(() => {
      validateField(fieldName);
    }, validateDebounceMs);
  }, [validateField, validateDebounceMs]);

  // Validate entire form
  const validateForm = useCallback(async (): Promise<boolean> => {
    if (!validationSchema) return true;

    const values = getCurrentValues();
    
    try {
      await validationSchema.parseAsync(values);
      
      // Clear all errors
      setFormState(prev => ({
        ...prev,
        isValid: true,
        errors: {},
        fields: Object.keys(prev.fields).reduce((acc, key) => ({
          ...acc,
          [key]: {
            ...prev.fields[key],
            error: undefined,
          },
        }), {} as Record<string, FormField>),
      }));
      
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = ValidationUtils.formatValidationErrors(error);
        
        setFormState(prev => ({
          ...prev,
          isValid: false,
          errors,
          fields: Object.keys(prev.fields).reduce((acc, key) => ({
            ...acc,
            [key]: {
              ...prev.fields[key],
              error: errors[key],
            },
          }), {} as Record<string, FormField>),
        }));
        
        onValidationError?.(errors);
      }
      return false;
    }
  }, [validationSchema, getCurrentValues, onValidationError]);

  // Form actions
  const setFieldValue = useCallback((field: keyof T, value: any) => {
    setFormState(prev => {
      const newFields = {
        ...prev.fields,
        [field]: {
          ...prev.fields[field as string],
          value,
          dirty: true,
        },
      };

      const isDirty = Object.values(newFields).some(f => f.dirty);

      return {
        ...prev,
        fields: newFields,
        isDirty,
      };
    });

    // Trigger validation if enabled
    if (validateOnChange) {
      debouncedValidateField(field);
    }

    // Trigger auto-save
    autoSave();
  }, [validateOnChange, debouncedValidateField, autoSave]);

  const setFieldError = useCallback((field: keyof T, error: string) => {
    setFormState(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: {
          ...prev.fields[field as string],
          error,
        },
      },
      errors: {
        ...prev.errors,
        [field as string]: error,
      },
    }));
  }, []);

  const setFieldTouched = useCallback((field: keyof T, touched = true) => {
    setFormState(prev => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: {
          ...prev.fields[field as string],
          touched,
        },
      },
    }));

    // Trigger validation on blur if enabled
    if (touched && validateOnBlur) {
      validateField(field);
    }
  }, [validateOnBlur, validateField]);

  const setErrors = useCallback((errors: Record<string, string>) => {
    setFormState(prev => ({
      ...prev,
      errors,
      fields: Object.keys(prev.fields).reduce((acc, key) => ({
        ...acc,
        [key]: {
          ...prev.fields[key],
          error: errors[key],
        },
      }), {}),
    }));
  }, []);

  const setValues = useCallback((values: Partial<T>) => {
    setFormState(prev => {
      const newFields = { ...prev.fields };
      
      Object.keys(values).forEach(key => {
        if (newFields[key]) {
          newFields[key] = {
            ...newFields[key],
            value: values[key as keyof T],
            dirty: true,
          };
        } else {
          newFields[key] = {
            value: values[key as keyof T],
            touched: false,
            dirty: true,
            validating: false,
          };
        }
      });

      const isDirty = Object.values(newFields).some(f => f.dirty);

      return {
        ...prev,
        fields: newFields,
        isDirty,
      };
    });

    autoSave();
  }, [autoSave]);

  const resetForm = useCallback((values?: Partial<T>) => {
    const resetValues = values || initialValues;
    const fields: Record<string, FormField> = {};
    
    Object.keys(resetValues).forEach(key => {
      fields[key] = {
        value: resetValues[key as keyof typeof resetValues],
        touched: false,
        dirty: false,
        validating: false,
      };
    });

    setFormState({
      fields,
      isValid: true,
      isSubmitting: false,
      isDirty: false,
      submitCount: 0,
      errors: {},
    });

    // Clear auto-saved data
    if (enableAutoSave && autoSaveKey) {
      try {
        localStorage.removeItem(`form_${autoSaveKey}`);
      } catch (error) {
        console.warn('Failed to clear auto-saved form data:', error);
      }
    }
  }, [initialValues, enableAutoSave, autoSaveKey]);

  const clearErrors = useCallback(() => {
    setFormState(prev => ({
      ...prev,
      errors: {},
      fields: Object.keys(prev.fields).reduce((acc, key) => ({
        ...acc,
        [key]: {
          ...prev.fields[key],
          error: undefined,
        },
      }), {} as Record<string, FormField>),
    }));
  }, []);

  const markAllTouched = useCallback(() => {
    setFormState(prev => ({
      ...prev,
      fields: Object.keys(prev.fields).reduce((acc, key) => ({
        ...acc,
        [key]: {
          ...prev.fields[key],
          touched: true,
        },
      }), {}),
    }));
  }, []);

  const submitForm = useCallback(async () => {
    setFormState(prev => ({
      ...prev,
      isSubmitting: true,
      submitCount: prev.submitCount + 1,
    }));

    // Mark all fields as touched
    markAllTouched();

    // Validate form
    const isValid = await validateForm();
    
    if (isValid && onSubmit) {
      try {
        const values = getCurrentValues();
        await onSubmit(values);
        
        // Clear auto-saved data on successful submit
        if (enableAutoSave && autoSaveKey) {
          try {
            localStorage.removeItem(`form_${autoSaveKey}`);
          } catch (error) {
            console.warn('Failed to clear auto-saved form data:', error);
          }
        }
      } catch (error) {
        console.error('Form submission error:', error);
        throw error;
      }
    }

    setFormState(prev => ({
      ...prev,
      isSubmitting: false,
    }));
  }, [markAllTouched, validateForm, onSubmit, getCurrentValues, enableAutoSave, autoSaveKey]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(validationTimeouts.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout);
      });
      if (autoSaveTimeout.current) {
        clearTimeout(autoSaveTimeout.current);
      }
    };
  }, []);

  const actions: FormActions<T> = {
    setFieldValue,
    setFieldError,
    setFieldTouched,
    setErrors,
    setValues,
    resetForm,
    validateField,
    validateForm,
    submitForm,
    clearErrors,
    markAllTouched,
  };

  return [formState, actions];
}

export default useAdvancedForm;