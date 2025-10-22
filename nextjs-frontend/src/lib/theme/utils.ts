/**
 * Theme Utilities
 * 
 * Utility functions for working with the theme system,
 * including style helpers and responsive utilities.
 */

import { tokens } from './tokens';
import type { 
  ColorToken, 
  SpacingToken, 
  ShadowToken, 
  BorderRadiusToken,
  FontSizeToken,
  FontWeightToken 
} from './tokens';

/**
 * Get a color value from the design tokens
 */
export function getColor(colorPath: string): string {
  const keys = colorPath.split('.');
  let value: any = tokens.colors;
  
  for (const key of keys) {
    value = value?.[key];
  }
  
  return value || colorPath;
}

/**
 * Get a spacing value from the design tokens
 */
export function getSpacing(token: SpacingToken): number {
  return tokens.spacing[token];
}

/**
 * Get a shadow value from the design tokens
 */
export function getShadow(token: ShadowToken): string {
  return tokens.shadows[token];
}

/**
 * Get a border radius value from the design tokens
 */
export function getBorderRadius(token: BorderRadiusToken): string {
  return tokens.borderRadius[token];
}

/**
 * Create responsive styles based on breakpoints
 */
export function responsive<T>(styles: Partial<Record<keyof typeof tokens.breakpoints, T>>): Record<string, T> {
  const result: Record<string, T> = {};
  
  Object.entries(styles).forEach(([breakpoint, style]) => {
    if (breakpoint === 'xs') {
      // Base styles (no media query)
      Object.assign(result, style);
    } else {
      const breakpointValue = tokens.breakpoints[breakpoint as keyof typeof tokens.breakpoints];
      result[`@media (min-width: ${breakpointValue}px)`] = style as T;
    }
  });
  
  return result;
}

/**
 * Create a consistent component style object
 */
export function createComponentStyles(config: {
  base?: Record<string, any>;
  variants?: Record<string, Record<string, any>>;
  sizes?: Record<string, Record<string, any>>;
  states?: Record<string, Record<string, any>>;
}) {
  const { base = {}, variants = {}, sizes = {}, states = {} } = config;
  
  return {
    base,
    variants,
    sizes,
    states,
    
    // Helper to get combined styles
    getStyles: (variant?: string, size?: string, state?: string) => {
      return {
        ...base,
        ...(variant && variants[variant]),
        ...(size && sizes[size]),
        ...(state && states[state]),
      };
    },
  };
}

/**
 * Generate consistent focus styles
 */
export function focusStyles(color: string = tokens.colors.primary[500]) {
  return {
    outline: 'none',
    boxShadow: `0 0 0 2px ${color}`,
    borderColor: color,
  };
}

/**
 * Generate consistent hover styles
 */
export function hoverStyles(config: {
  scale?: number;
  opacity?: number;
  shadow?: ShadowToken;
  backgroundColor?: string;
}) {
  const { scale, opacity, shadow, backgroundColor } = config;
  
  return {
    ...(scale && { transform: `scale(${scale})` }),
    ...(opacity && { opacity }),
    ...(shadow && { boxShadow: getShadow(shadow) }),
    ...(backgroundColor && { backgroundColor }),
    transition: 'all 0.2s ease-in-out',
  };
}

/**
 * Generate consistent disabled styles
 */
export function disabledStyles() {
  return {
    opacity: 0.5,
    cursor: 'not-allowed',
    pointerEvents: 'none' as const,
  };
}

/**
 * Create a CSS-in-JS style object with theme tokens
 */
export function createStyles<T extends Record<string, any>>(stylesFn: (designTokens: typeof tokens) => T): T {
  return stylesFn(tokens);
}

/**
 * Convert pixel values to rem units
 */
export function pxToRem(px: number, baseFontSize: number = 16): string {
  return `${px / baseFontSize}rem`;
}

/**
 * Create consistent animation styles
 */
export function animationStyles(config: {
  duration?: keyof typeof tokens.animations.duration;
  easing?: keyof typeof tokens.animations.easing;
  delay?: string;
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
}) {
  const { 
    duration = 'normal', 
    easing = 'easeInOut', 
    delay = '0s', 
    fillMode = 'both' 
  } = config;
  
  return {
    animationDuration: tokens.animations.duration[duration],
    animationTimingFunction: tokens.animations.easing[easing],
    animationDelay: delay,
    animationFillMode: fillMode,
  };
}

/**
 * Create consistent loading skeleton styles
 */
export function skeletonStyles(config?: {
  baseColor?: string;
  highlightColor?: string;
  duration?: string;
}) {
  const {
    baseColor = tokens.colors.gray[200],
    highlightColor = tokens.colors.gray[100],
    duration = '1.5s',
  } = config || {};
  
  return {
    background: `linear-gradient(90deg, ${baseColor} 25%, ${highlightColor} 50%, ${baseColor} 75%)`,
    backgroundSize: '200% 100%',
    animation: `skeleton ${duration} ease-in-out infinite`,
    '@keyframes skeleton': {
      '0%': { backgroundPosition: '200% 0' },
      '100%': { backgroundPosition: '-200% 0' },
    },
  };
}

/**
 * Create consistent truncation styles
 */
export function truncateStyles(lines: number = 1) {
  if (lines === 1) {
    return {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    };
  }
  
  return {
    display: '-webkit-box',
    WebkitLineClamp: lines,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  };
}

/**
 * Create consistent glass morphism styles
 */
export function glassMorphismStyles(config?: {
  blur?: string;
  opacity?: number;
  borderOpacity?: number;
}) {
  const { blur = '10px', opacity = 0.1, borderOpacity = 0.2 } = config || {};
  
  return {
    backdropFilter: `blur(${blur})`,
    backgroundColor: `rgba(255, 255, 255, ${opacity})`,
    border: `1px solid rgba(255, 255, 255, ${borderOpacity})`,
  };
}