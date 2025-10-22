// Base spacing unit (in pixels)
export const baseSpacing = 8;

// Spacing scale (multipliers of base unit)
export const spacing = {
  0: 0,
  0.5: baseSpacing * 0.5,  // 4px
  1: baseSpacing * 1,      // 8px
  1.5: baseSpacing * 1.5,  // 12px
  2: baseSpacing * 2,      // 16px
  2.5: baseSpacing * 2.5,  // 20px
  3: baseSpacing * 3,      // 24px
  3.5: baseSpacing * 3.5,  // 28px
  4: baseSpacing * 4,      // 32px
  5: baseSpacing * 5,      // 40px
  6: baseSpacing * 6,      // 48px
  7: baseSpacing * 7,      // 56px
  8: baseSpacing * 8,      // 64px
  9: baseSpacing * 9,      // 72px
  10: baseSpacing * 10,    // 80px
  11: baseSpacing * 11,    // 88px
  12: baseSpacing * 12,    // 96px
  14: baseSpacing * 14,    // 112px
  16: baseSpacing * 16,    // 128px
  20: baseSpacing * 20,    // 160px
  24: baseSpacing * 24,    // 192px
  28: baseSpacing * 28,    // 224px
  32: baseSpacing * 32,    // 256px
  36: baseSpacing * 36,    // 288px
  40: baseSpacing * 40,    // 320px
  44: baseSpacing * 44,    // 352px
  48: baseSpacing * 48,    // 384px
  52: baseSpacing * 52,    // 416px
  56: baseSpacing * 56,    // 448px
  60: baseSpacing * 60,    // 480px
  64: baseSpacing * 64,    // 512px
  72: baseSpacing * 72,    // 576px
  80: baseSpacing * 80,    // 640px
  96: baseSpacing * 96,    // 768px
} as const;

export type SpacingKey = keyof typeof spacing;

// Helper function to get spacing value
export function getSpacing(key: SpacingKey): number {
  return spacing[key];
}

// Helper function to get spacing in pixels
export function getSpacingPx(key: SpacingKey): string {
  return `${spacing[key]}px`;
}

// Helper function to get spacing in rem
export function getSpacingRem(key: SpacingKey): string {
  return `${spacing[key] / 16}rem`;
}

// Component spacing presets
export const componentSpacing = {
  // Padding presets
  padding: {
    xs: getSpacing(1),    // 8px
    sm: getSpacing(2),    // 16px
    md: getSpacing(3),    // 24px
    lg: getSpacing(4),    // 32px
    xl: getSpacing(6),    // 48px
  },
  
  // Margin presets
  margin: {
    xs: getSpacing(1),    // 8px
    sm: getSpacing(2),    // 16px
    md: getSpacing(3),    // 24px
    lg: getSpacing(4),    // 32px
    xl: getSpacing(6),    // 48px
  },
  
  // Gap presets for flexbox/grid
  gap: {
    xs: getSpacing(1),    // 8px
    sm: getSpacing(2),    // 16px
    md: getSpacing(3),    // 24px
    lg: getSpacing(4),    // 32px
    xl: getSpacing(6),    // 48px
  },
} as const;

// Border radius scale
export const borderRadius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  '3xl': 24,
  full: 9999,
} as const;

export type BorderRadiusKey = keyof typeof borderRadius;

// Helper function to get border radius value
export function getBorderRadius(key: BorderRadiusKey): number {
  return borderRadius[key];
}

// Helper function to get border radius in pixels
export function getBorderRadiusPx(key: BorderRadiusKey): string {
  return key === 'full' ? '50%' : `${borderRadius[key]}px`;
}

// Shadow scale
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  base: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
} as const;

export type ShadowKey = keyof typeof shadows;

// Z-index scale
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

export type ZIndexKey = keyof typeof zIndex;

// Animation durations
export const duration = {
  75: '75ms',
  100: '100ms',
  150: '150ms',
  200: '200ms',
  300: '300ms',
  500: '500ms',
  700: '700ms',
  1000: '1000ms',
} as const;

// Animation easing functions
export const easing = {
  linear: 'linear',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;