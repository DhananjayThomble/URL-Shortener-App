/**
 * CSS Variables System
 * 
 * Generates CSS custom properties for theme tokens that can be used
 * by both Tailwind CSS and Material-UI components.
 */

import { colors } from './colors';
import { spacing } from './spacing';
import { typography } from './typography';
import { tokens } from './tokens';

// Convert color object to CSS variables
function generateColorVariables(colorObj: any, prefix = ''): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(colorObj).forEach(([key, value]) => {
    const varName = prefix ? `${prefix}-${key}` : key;
    
    if (typeof value === 'object' && value !== null) {
      Object.assign(variables, generateColorVariables(value, varName));
    } else {
      variables[`--color-${varName}`] = value as string;
    }
  });
  
  return variables;
}

// Generate spacing variables
function generateSpacingVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(spacing).forEach(([key, value]) => {
    variables[`--spacing-${key}`] = `${value}px`;
  });
  
  return variables;
}

// Generate typography variables
function generateTypographyVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  // Font families
  Object.entries(typography.fontFamily).forEach(([key, value]) => {
    variables[`--font-${key}`] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  
  // Font sizes
  Object.entries(typography.fontSize).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      const [size, config] = value;
      variables[`--text-${key}`] = size;
      
      if (typeof config === 'object' && config && 'lineHeight' in config) {
        variables[`--leading-${key}`] = config.lineHeight;
      }
    } else {
      variables[`--text-${key}`] = String(value);
    }
  });
  
  // Font weights
  Object.entries(typography.fontWeight).forEach(([key, value]) => {
    variables[`--font-weight-${key}`] = value.toString();
  });
  
  return variables;
}

// Generate shadow variables
function generateShadowVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(tokens.shadows).forEach(([key, value]) => {
    variables[`--shadow-${key}`] = value;
  });
  
  return variables;
}

// Generate border radius variables
function generateBorderRadiusVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(tokens.borderRadius).forEach(([key, value]) => {
    variables[`--radius-${key}`] = value;
  });
  
  return variables;
}

// Generate z-index variables
function generateZIndexVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(tokens.zIndex).forEach(([key, value]) => {
    variables[`--z-${key}`] = value.toString();
  });
  
  return variables;
}

// Generate animation variables
function generateAnimationVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  
  Object.entries(tokens.animations.duration).forEach(([key, value]) => {
    variables[`--duration-${key}`] = value;
  });
  
  Object.entries(tokens.animations.easing).forEach(([key, value]) => {
    variables[`--easing-${key}`] = value;
  });
  
  return variables;
}

// Light theme variables
export const lightThemeVariables: Record<string, string> = {
  // Semantic colors for light theme
  '--background': colors.gray[50],
  '--foreground': colors.gray[900],
  '--card': '#ffffff',
  '--card-foreground': colors.gray[900],
  '--popover': '#ffffff',
  '--popover-foreground': colors.gray[900],
  '--primary': colors.primary[500],
  '--primary-foreground': '#ffffff',
  '--secondary': colors.gray[100],
  '--secondary-foreground': colors.gray[900],
  '--muted': colors.gray[100],
  '--muted-foreground': colors.gray[500],
  '--accent': colors.gray[100],
  '--accent-foreground': colors.gray[900],
  '--destructive': colors.error[500],
  '--destructive-foreground': '#ffffff',
  '--border': colors.gray[200],
  '--input': colors.gray[200],
  '--ring': colors.primary[500],
  
  // Component-specific variables
  '--header-bg': 'rgba(255, 255, 255, 0.8)',
  '--header-border': colors.gray[200],
  '--sidebar-bg': '#ffffff',
  '--sidebar-border': colors.gray[200],
  '--modal-backdrop': 'rgba(0, 0, 0, 0.5)',
  '--toast-bg': '#ffffff',
  '--tooltip-bg': colors.gray[900],
  '--tooltip-text': '#ffffff',
  
  // State colors
  '--hover-bg': colors.gray[50],
  '--active-bg': colors.gray[100],
  '--focus-ring': colors.primary[500],
  '--disabled-bg': colors.gray[100],
  '--disabled-text': colors.gray[400],
  
  // Generate all token variables
  ...generateColorVariables(colors),
  ...generateSpacingVariables(),
  ...generateTypographyVariables(),
  ...generateShadowVariables(),
  ...generateBorderRadiusVariables(),
  ...generateZIndexVariables(),
  ...generateAnimationVariables(),
};

// Dark theme variables
export const darkThemeVariables: Record<string, string> = {
  // Semantic colors for dark theme
  '--background': colors.gray[900],
  '--foreground': colors.gray[100],
  '--card': colors.gray[800],
  '--card-foreground': colors.gray[100],
  '--popover': colors.gray[800],
  '--popover-foreground': colors.gray[100],
  '--primary': colors.primary[400],
  '--primary-foreground': colors.gray[900],
  '--secondary': colors.gray[800],
  '--secondary-foreground': colors.gray[100],
  '--muted': colors.gray[800],
  '--muted-foreground': colors.gray[400],
  '--accent': colors.gray[800],
  '--accent-foreground': colors.gray[100],
  '--destructive': colors.error[400],
  '--destructive-foreground': colors.gray[900],
  '--border': colors.gray[700],
  '--input': colors.gray[700],
  '--ring': colors.primary[400],
  
  // Component-specific variables
  '--header-bg': 'rgba(17, 24, 39, 0.8)',
  '--header-border': colors.gray[700],
  '--sidebar-bg': colors.gray[800],
  '--sidebar-border': colors.gray[700],
  '--modal-backdrop': 'rgba(0, 0, 0, 0.7)',
  '--toast-bg': colors.gray[800],
  '--tooltip-bg': colors.gray[700],
  '--tooltip-text': colors.gray[100],
  
  // State colors
  '--hover-bg': colors.gray[800],
  '--active-bg': colors.gray[700],
  '--focus-ring': colors.primary[400],
  '--disabled-bg': colors.gray[800],
  '--disabled-text': colors.gray[600],
  
  // Generate all token variables (same as light theme)
  ...generateColorVariables(colors),
  ...generateSpacingVariables(),
  ...generateTypographyVariables(),
  ...generateShadowVariables(),
  ...generateBorderRadiusVariables(),
  ...generateZIndexVariables(),
  ...generateAnimationVariables(),
};

// Function to apply theme variables to document
export function applyThemeVariables(theme: 'light' | 'dark') {
  if (typeof document === 'undefined') return;
  
  const variables = theme === 'dark' ? darkThemeVariables : lightThemeVariables;
  const root = document.documentElement;
  
  Object.entries(variables).forEach(([property, value]) => {
    root.style.setProperty(property, value);
  });
}

// Function to get CSS variable value
export function getCSSVariable(name: string): string {
  if (typeof document === 'undefined') return '';
  
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// Function to set CSS variable
export function setCSSVariable(name: string, value: string) {
  if (typeof document === 'undefined') return;
  
  document.documentElement.style.setProperty(name, value);
}

// Generate CSS string for injection
export function generateThemeCSS(theme: 'light' | 'dark'): string {
  const variables = theme === 'dark' ? darkThemeVariables : lightThemeVariables;
  const selector = theme === 'dark' ? '.dark' : ':root';
  
  const cssProperties = Object.entries(variables)
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
  
  return `${selector} {\n${cssProperties}\n}`;
}

// Export utility functions
export const cssVariables = {
  light: lightThemeVariables,
  dark: darkThemeVariables,
  apply: applyThemeVariables,
  get: getCSSVariable,
  set: setCSSVariable,
  generateCSS: generateThemeCSS,
};