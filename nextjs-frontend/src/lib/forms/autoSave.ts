import { useEffect, useCallback, useRef } from 'react';
import { FieldValues, UseFormReturn } from 'react-hook-form';

// Storage keys for auto-save
const STORAGE_PREFIX = 'form_autosave_';
const STORAGE_EXPIRY_KEY = '_expiry';

// Auto-save configuration
export interface AutoSaveConfig {
  key: string;
  delay?: number;
  enabled?: boolean;
  expiryHours?: number;
  onSave?: (data: any) => void;
  onRestore?: (data: any) => void;
}

// Storage utilities
class FormStorage {
  private static getStorageKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
  }

  private static getExpiryKey(key: string): string {
    return `${STORAGE_PREFIX}${key}${STORAGE_EXPIRY_KEY}`;
  }

  static save(key: string, data: any, expiryHours: number = 24): void {
    try {
      const storageKey = this.getStorageKey(key);
      const expiryKey = this.getExpiryKey(key);
      const expiryTime = Date.now() + (expiryHours * 60 * 60 * 1000);

      localStorage.setItem(storageKey, JSON.stringify(data));
      localStorage.setItem(expiryKey, expiryTime.toString());
    } catch (error) {
      console.warn('Failed to save form data:', error);
    }
  }

  static load(key: string): any | null {
    try {
      const storageKey = this.getStorageKey(key);
      const expiryKey = this.getExpiryKey(key);
      
      const expiryTime = localStorage.getItem(expiryKey);
      if (expiryTime && Date.now() > parseInt(expiryTime)) {
        // Data has expired, clean it up
        this.remove(key);
        return null;
      }

      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.warn('Failed to load form data:', error);
      return null;
    }
  }

  static remove(key: string): void {
    try {
      const storageKey = this.getStorageKey(key);
      const expiryKey = this.getExpiryKey(key);
      
      localStorage.removeItem(storageKey);
      localStorage.removeItem(expiryKey);
    } catch (error) {
      console.warn('Failed to remove form data:', error);
    }
  }

  static exists(key: string): boolean {
    const data = this.load(key);
    return data !== null;
  }

  static clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(STORAGE_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear form data:', error);
    }
  }
}

// Auto-save hook
export function useAutoSave<T extends FieldValues>(
  form: UseFormReturn<T>,
  config: AutoSaveConfig
) {
  const {
    watch,
    getValues,
    reset,
    formState: { isDirty, isValid },
  } = form;

  const {
    key,
    delay = 2000,
    enabled = true,
    expiryHours = 24,
    onSave,
    onRestore,
  } = config;

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');

  // Save form data
  const saveFormData = useCallback((data: T) => {
    if (!enabled || !isDirty) return;

    const dataString = JSON.stringify(data);
    if (dataString === lastSavedRef.current) return;

    FormStorage.save(key, data, expiryHours);
    lastSavedRef.current = dataString;
    onSave?.(data);
  }, [key, enabled, isDirty, expiryHours, onSave]);

  // Restore form data
  const restoreFormData = useCallback(() => {
    if (!enabled) return false;

    const savedData = FormStorage.load(key);
    if (savedData) {
      reset(savedData);
      onRestore?.(savedData);
      return true;
    }
    return false;
  }, [key, enabled, reset, onRestore]);

  // Clear saved data
  const clearSavedData = useCallback(() => {
    FormStorage.remove(key);
    lastSavedRef.current = '';
  }, [key]);

  // Check if saved data exists
  const hasSavedData = useCallback(() => {
    return FormStorage.exists(key);
  }, [key]);

  // Auto-save effect
  useEffect(() => {
    if (!enabled) return;

    const subscription = watch((data) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        saveFormData(data as T);
      }, delay);
    });

    return () => {
      subscription.unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [watch, saveFormData, delay, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    saveFormData: () => saveFormData(getValues()),
    restoreFormData,
    clearSavedData,
    hasSavedData,
    isAutoSaveEnabled: enabled,
  };
}

// Form recovery hook
export function useFormRecovery<T extends FieldValues>(
  form: UseFormReturn<T>,
  key: string
) {
  const { reset } = form;

  // Check for recoverable data on mount
  useEffect(() => {
    const savedData = FormStorage.load(key);
    if (savedData) {
      // Show recovery prompt or automatically restore
      const shouldRestore = window.confirm(
        'We found unsaved changes from a previous session. Would you like to restore them?'
      );
      
      if (shouldRestore) {
        reset(savedData);
      } else {
        FormStorage.remove(key);
      }
    }
  }, [key, reset]);

  return {
    clearRecoveryData: () => FormStorage.remove(key),
    hasRecoveryData: () => FormStorage.exists(key),
  };
}

// Form session manager
export class FormSessionManager {
  private static instance: FormSessionManager;
  private activeForms = new Set<string>();

  static getInstance(): FormSessionManager {
    if (!this.instance) {
      this.instance = new FormSessionManager();
    }
    return this.instance;
  }

  registerForm(key: string): void {
    this.activeForms.add(key);
  }

  unregisterForm(key: string): void {
    this.activeForms.delete(key);
  }

  getActiveForms(): string[] {
    return Array.from(this.activeForms);
  }

  clearAllSavedData(): void {
    FormStorage.clear();
    this.activeForms.clear();
  }

  getSavedFormsCount(): number {
    try {
      const keys = Object.keys(localStorage);
      return keys.filter(key => 
        key.startsWith(STORAGE_PREFIX) && 
        !key.includes(STORAGE_EXPIRY_KEY)
      ).length;
    } catch {
      return 0;
    }
  }

  // Handle page unload
  setupUnloadHandler(): (() => void) | void {
    if (typeof window === 'undefined') return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (this.activeForms.size > 0) {
        const message = 'You have unsaved changes. Are you sure you want to leave?';
        event.returnValue = message;
        return message;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }
}

// Export storage utilities for direct use
export { FormStorage };

// Default auto-save configurations
export const AutoSavePresets = {
  quick: { delay: 1000, expiryHours: 1 },
  normal: { delay: 2000, expiryHours: 24 },
  slow: { delay: 5000, expiryHours: 72 },
  persistent: { delay: 2000, expiryHours: 168 }, // 1 week
} as const;