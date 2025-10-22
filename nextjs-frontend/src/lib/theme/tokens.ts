/**
 * Design Tokens
 * 
 * Centralized design system tokens that define the visual language
 * of the application. These tokens are used by both Tailwind CSS
 * and Material-UI components.
 */

import { colors } from './colors';
import { spacing } from './spacing';
import { breakpoints } from './breakpoints';

// Animation tokens
export const animations = {
  duration: {
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
    slower: '500ms',
  },
  easing: {
    linear: 'linear',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

// Typography tokens
export const typography = {
  fontFamily: {
    sans: [
      'Inter',
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ],
    mono: [
      '"Fira Code"',
      '"JetBrains Mono"',
      'Consolas',
      '"Liberation Mono"',
      'Menlo',
      'Monaco',
      'monospace',
    ],
  },
  fontSize: {
    xs: ['0.75rem', { lineHeight: '1rem' }],
    sm: ['0.875rem', { lineHeight: '1.25rem' }],
    base: ['1rem', { lineHeight: '1.5rem' }],
    lg: ['1.125rem', { lineHeight: '1.75rem' }],
    xl: ['1.25rem', { lineHeight: '1.75rem' }],
    '2xl': ['1.5rem', { lineHeight: '2rem' }],
    '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
    '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
    '5xl': ['3rem', { lineHeight: '1' }],
    '6xl': ['3.75rem', { lineHeight: '1' }],
  },
  fontWeight: {
    thin: 100,
    extralight: 200,
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
    black: 900,
  },
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0em',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
    loose: 2,
  },
} as const;

// Shadow tokens
export const shadows = {
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  none: 'none',
} as const;

// Border radius tokens
export const borderRadius = {
  none: '0px',
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  '3xl': '24px',
  full: '9999px',
} as const;

// Z-index tokens
export const zIndex = {
  hide: -1,
  auto: 'auto',
  base: 0,
  docked: 10,
  dropdown: 1000,
  sticky: 1100,
  banner: 1200,
  overlay: 1300,
  modal: 1400,
  popover: 1500,
  skipLink: 1600,
  toast: 1700,
  tooltip: 1800,
} as const;

// Component-specific tokens
export const components = {
  button: {
    height: {
      sm: '32px',
      md: '40px',
      lg: '48px',
    },
    padding: {
      sm: '8px 12px',
      md: '10px 16px',
      lg: '12px 20px',
    },
    fontSize: {
      sm: typography.fontSize.sm[0],
      md: typography.fontSize.base[0],
      lg: typography.fontSize.lg[0],
    },
  },
  input: {
    height: {
      sm: '32px',
      md: '40px',
      lg: '48px',
    },
    padding: {
      sm: '6px 12px',
      md: '8px 16px',
      lg: '12px 16px',
    },
  },
  card: {
    padding: {
      sm: spacing[3], // 24px
      md: spacing[4], // 32px
      lg: spacing[6], // 48px
    },
    borderRadius: borderRadius.lg,
    shadow: shadows.sm,
  },
  modal: {
    borderRadius: borderRadius.xl,
    shadow: shadows.xl,
    backdrop: 'rgba(0, 0, 0, 0.5)',
  },
} as const;

// Layout tokens
export const layout = {
  container: {
    maxWidth: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    padding: {
      mobile: spacing[3], // 24px
      desktop: spacing[4], // 32px
    },
  },
  header: {
    height: '64px',
    zIndex: zIndex.sticky,
  },
  sidebar: {
    width: {
      collapsed: '64px',
      expanded: '256px',
    },
    zIndex: zIndex.docked,
  },
} as const;

// Export all tokens as a single object
export const tokens = {
  colors,
  spacing,
  breakpoints,
  animations,
  typography,
  shadows,
  borderRadius,
  zIndex,
  components,
  layout,
} as const;

// Type definitions for better TypeScript support
export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type BreakpointToken = keyof typeof breakpoints;
export type AnimationDurationToken = keyof typeof animations.duration;
export type AnimationEasingToken = keyof typeof animations.easing;
export type FontSizeToken = keyof typeof typography.fontSize;
export type FontWeightToken = keyof typeof typography.fontWeight;
export type ShadowToken = keyof typeof shadows;
export type BorderRadiusToken = keyof typeof borderRadius;
export type ZIndexToken = keyof typeof zIndex;