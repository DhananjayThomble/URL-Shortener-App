'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material';
import { lightTheme, darkTheme } from '@/lib/theme';
import { applyThemeVariables } from '@/lib/theme/cssVariables';
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

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultMode = 'system',
}) => {
  const [mode, setMode] = useState<ThemeMode>(defaultMode);
  const [actualMode, setActualMode] = useState<'light' | 'dark'>('light');
  const [isHydrated, setIsHydrated] = useState(false);

  // Get system preference
  const getSystemPreference = (): 'light' | 'dark' => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  };

  // Calculate actual theme mode
  const calculateActualMode = (themeMode: ThemeMode): 'light' | 'dark' => {
    if (themeMode === 'system') {
      return getSystemPreference();
    }
    return themeMode;
  };

  // Load saved theme from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedMode = localStorage.getItem(STORAGE_KEYS.theme) as ThemeMode;
    if (savedMode && ['light', 'dark', 'system'].includes(savedMode)) {
      setMode(savedMode);
    }
    setIsHydrated(true);
  }, []);

  // Update actual mode when mode changes or system preference changes
  useEffect(() => {
    const newActualMode = calculateActualMode(mode);
    setActualMode(newActualMode);

    // Update CSS custom properties for Tailwind and theme variables
    if (typeof window !== 'undefined') {
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(newActualMode);
      
      // Apply CSS variables for the current theme
      applyThemeVariables(newActualMode);
      
      // Update meta theme-color for mobile browsers
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute(
          'content',
          newActualMode === 'dark' ? '#111827' : '#f9fafb'
        );
      }
    }
  }, [mode]);

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === 'undefined' || mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setActualMode(calculateActualMode('system'));
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [mode]);

  // Save theme to localStorage
  const setTheme = (newMode: ThemeMode) => {
    setMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.theme, newMode);
    }
  };

  // Toggle between light and dark (skip system)
  const toggleTheme = () => {
    const newMode = actualMode === 'light' ? 'dark' : 'light';
    setTheme(newMode);
  };

  // Don't render until hydrated to prevent SSR mismatch
  if (!isHydrated) {
    return (
      <MuiThemeProvider theme={lightTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    );
  }

  const theme = actualMode === 'dark' ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider
      value={{
        mode,
        actualMode,
        toggleTheme,
        setTheme,
      }}
    >
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

// Hook to use theme context
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Export theme context for advanced usage
export { ThemeContext };