'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material';
import { lightTheme, darkTheme } from './index';
import { STORAGE_KEYS } from '@/lib/constants';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  actualMode: 'light' | 'dark';
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
}

export function ThemeProvider({ children, defaultMode = 'system' }: ThemeProviderProps) {
  const [mode, setMode] = useState<ThemeMode>(defaultMode);
  const [actualMode, setActualMode] = useState<'light' | 'dark'>('light');

  // Get system preference
  const getSystemPreference = (): 'light' | 'dark' => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  // Calculate actual mode based on current mode setting
  const calculateActualMode = (currentMode: ThemeMode): 'light' | 'dark' => {
    if (currentMode === 'system') {
      return getSystemPreference();
    }
    return currentMode;
  };

  // Initialize theme from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedMode = localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode;
    if (savedMode && ['light', 'dark', 'system'].includes(savedMode)) {
      setMode(savedMode);
    }
  }, []);

  // Update actual mode when mode changes or system preference changes
  useEffect(() => {
    const newActualMode = calculateActualMode(mode);
    setActualMode(newActualMode);

    // Update CSS custom properties for the current theme
    const root = document.documentElement;
    if (newActualMode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  }, [mode]);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (mode === 'system') {
        setActualMode(getSystemPreference());
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode]);

  const toggleTheme = () => {
    const newMode = actualMode === 'light' ? 'dark' : 'light';
    setTheme(newMode);
  };

  const setTheme = (newMode: ThemeMode) => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.theme, newMode);
    }
  };

  const theme = actualMode === 'dark' ? darkTheme : lightTheme;

  const contextValue: ThemeContextType = {
    mode,
    actualMode,
    toggleTheme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeProvider;