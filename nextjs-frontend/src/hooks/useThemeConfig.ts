'use client';

import { useCallback, useMemo } from 'react';
import { useTheme as useMuiTheme } from '@mui/material/styles';
import { useTheme } from './useTheme';
import { tokens } from '@/lib/theme/tokens';
import { getCSSVariable, setCSSVariable } from '@/lib/theme/cssVariables';

export interface ThemeConfig {
  // Current theme state
  mode: 'light' | 'dark' | 'system';
  actualMode: 'light' | 'dark';
  
  // Theme actions
  setTheme: (mode: 'light' | 'dark' | 'system') => void;
  toggleTheme: () => void;
  
  // Material-UI theme
  muiTheme: ReturnType<typeof useMuiTheme>;
  
  // Design tokens
  tokens: typeof tokens;
  
  // CSS variable utilities
  getCSSVar: (name: string) => string;
  setCSSVar: (name: string, value: string) => void;
  
  // Theme utilities
  isDark: boolean;
  isLight: boolean;
  isSystemMode: boolean;
  
  // Responsive utilities
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

export function useThemeConfig(): ThemeConfig {
  const { mode, actualMode, setTheme, toggleTheme } = useTheme();
  const muiTheme = useMuiTheme();

  // Responsive breakpoint detection
  const { isMobile, isTablet, isDesktop } = useMemo(() => {
    if (typeof window === 'undefined') {
      return { isMobile: false, isTablet: false, isDesktop: true };
    }

    const width = window.innerWidth;
    return {
      isMobile: width < tokens.breakpoints.md,
      isTablet: width >= tokens.breakpoints.md && width < tokens.breakpoints.lg,
      isDesktop: width >= tokens.breakpoints.lg,
    };
  }, []);

  // CSS variable utilities
  const getCSSVar = useCallback((name: string) => {
    return getCSSVariable(name);
  }, []);

  const setCSSVar = useCallback((name: string, value: string) => {
    setCSSVariable(name, value);
  }, []);

  // Theme state utilities
  const isDark = actualMode === 'dark';
  const isLight = actualMode === 'light';
  const isSystemMode = mode === 'system';

  return {
    // Theme state
    mode,
    actualMode,
    
    // Theme actions
    setTheme,
    toggleTheme,
    
    // Material-UI theme
    muiTheme,
    
    // Design tokens
    tokens,
    
    // CSS variable utilities
    getCSSVar,
    setCSSVar,
    
    // Theme utilities
    isDark,
    isLight,
    isSystemMode,
    
    // Responsive utilities
    isMobile,
    isTablet,
    isDesktop,
  };
}

export default useThemeConfig;