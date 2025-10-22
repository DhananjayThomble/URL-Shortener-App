'use client';

import { useCallback, useState, useEffect } from 'react';
import { FieldValues, UseFormReturn, Path } from 'react-hook-form';
import { ZodSchema, ZodError } from 'zod';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  fieldErrors: Record<string, string[]>;
  hasErrors: boolean;
  errorCount: number;
}

export interface UseFormValidationProps<T extends FieldValues> {
  form: UseFormReturn<T>;
  schema?: ZodSchema<T>;
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  debounceMs?: number;
}

export function useFormValidation<T extends FieldValues>({
  form,
  schema,
  validateOnChange = true,
  validateOnBlur = true,
  debounceMs = 300,
}: UseFormValidationProps<T>) {
  const { watch, getValues, setError, clearErrors, formState } = form;
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    isValid: true,
    errors: {},
    fieldErrors: {},
    hasErrors: false,
    errorCount: 0,
  });

  // Validate form data against schema
  const validateData = useCallback(async (data: T): Promise<ValidationResult> => {
    if (!schema) {
      return {
        isValid: true,
        errors: {},
        fieldErrors: {},
        hasErrors: false,
        errorCount: 0,
      };
    }

    try {
      await schema.parseAsync(data);
      return {
        isValid: true,
        errors: {},
        fieldErrors: {},
        hasErrors: false,
        errorCount: 0,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string> = {};
        const fieldErrors: Record<string, string[]> = {};

        error.errors.forEach((err) => {
          const path = err.path.join('.');
          errors[path] = err.message;
          
          if (!fieldErrors[path]) {
            fieldErrors[path] = [];
          }
          fieldErrors[path].push(err.message);
        });

        return {
          isValid: false,
          errors,
          fieldErrors,
          hasErrors: true,
          errorCount: Object.keys(errors).length,
        };
      }

      return {
        isValid: false,
        errors: { root: 'Validation failed' },
        fieldErrors: { root: ['Validation failed'] },
        hasErrors: true,
        errorCount: 1,
      };
    }
  }, [schema]);

  // Validate specific field
  const validateField = useCallback(async (fieldName: Path<T>, value: any): Promise<boolean> => {
    if (!schema) return true;

    try {
      const currentData = getValues();
      const dataToValidate = { ...currentData, [fieldName]: value };
      await schema.parseAsync(dataToValidate);
      
      // Clear field error if validation passes
      clearErrors(fieldName);
      return true;
    } catch (error) {
      if (error instanceof ZodError) {
        const fieldError = error.errors.find(err => 
          err.path.join('.') === fieldName
        );
        
        if (fieldError) {
          setError(fieldName, { message: fieldError.message });
          return false;
        }
      }
      return false;
    }
  }, [schema, getValues, setError, clearErrors]);

  // Validate all fields
  const validateAll = useCallback(async (): Promise<ValidationResult> => {
    const data = getValues();
    const result = await validateData(data);
    setValidationResult(result);

    // Set form errors
    Object.entries(result.errors).forEach(([field, message]) => {
      setError(field as Path<T>, { message });
    });

    return result;
  }, [getValues, validateData, setError]);

  // Clear all validation errors
  const clearValidation = useCallback(() => {
    clearErrors();
    setValidationResult({
      isValid: true,
      errors: {},
      fieldErrors: {},
      hasErrors: false,
      errorCount: 0,
    });
  }, [clearErrors]);

  // Get field validation status
  const getFieldValidation = useCallback((fieldName: Path<T>) => {
    const fieldError = formState.errors[fieldName];
    const hasError = !!fieldError;
    const isValid = !hasError && formState.touchedFields[fieldName];

    return {
      hasError,
      isValid,
      error: fieldError?.message,
      touched: formState.touchedFields[fieldName],
    };
  }, [formState.errors, formState.touchedFields]);

  // Check if specific fields are valid
  const areFieldsValid = useCallback((fieldNames: Path<T>[]): boolean => {
    return fieldNames.every(fieldName => !formState.errors[fieldName]);
  }, [formState.errors]);

  // Get validation summary
  const getValidationSummary = useCallback(() => {
    const totalFields = Object.keys(getValues()).length;
    const errorFields = Object.keys(formState.errors).length;
    const validFields = totalFields - errorFields;
    const completionPercentage = totalFields > 0 ? (validFields / totalFields) * 100 : 0;

    return {
      totalFields,
      validFields,
      errorFields,
      completionPercentage,
      isComplete: errorFields === 0 && totalFields > 0,
    };
  }, [getValues, formState.errors]);

  // Watch for form changes and validate
  useEffect(() => {
    if (!validateOnChange || !schema) return;

    let timeoutId: NodeJS.Timeout;

    const subscription = watch((data) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        const result = await validateData(data as T);
        setValidationResult(result);
      }, debounceMs);
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [watch, validateData, validateOnChange, debounceMs, schema]);

  return {
    // Validation state
    validationResult,
    isValidating,
    
    // Validation methods
    validateAll,
    validateField,
    clearValidation,
    
    // Field utilities
    getFieldValidation,
    areFieldsValid,
    getValidationSummary,
    
    // Computed values
    isFormValid: validationResult.isValid && formState.isValid,
    hasValidationErrors: validationResult.hasErrors,
    validationErrorCount: validationResult.errorCount,
  };
}

export default useFormValidation;