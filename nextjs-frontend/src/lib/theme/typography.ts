/**
 * Typography Design Tokens
 * 
 * Defines the typography system including font families, sizes, weights,
 * line heights, and letter spacing values.
 */

// Font families
export const fontFamily = {
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
  display: [
    'Inter',
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    'sans-serif',
  ],
} as const;

// Font sizes with line heights
export const fontSize = {
  xs: ['0.75rem', { lineHeight: '1rem' }],        // 12px
  sm: ['0.875rem', { lineHeight: '1.25rem' }],    // 14px
  base: ['1rem', { lineHeight: '1.5rem' }],       // 16px
  lg: ['1.125rem', { lineHeight: '1.75rem' }],    // 18px
  xl: ['1.25rem', { lineHeight: '1.75rem' }],     // 20px
  '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px
  '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px
  '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px
  '5xl': ['3rem', { lineHeight: '1' }],           // 48px
  '6xl': ['3.75rem', { lineHeight: '1' }],        // 60px
  '7xl': ['4.5rem', { lineHeight: '1' }],         // 72px
  '8xl': ['6rem', { lineHeight: '1' }],           // 96px
  '9xl': ['8rem', { lineHeight: '1' }],           // 128px
} as const;

// Font weights
export const fontWeight = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

// Letter spacing
export const letterSpacing = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0em',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
} as const;

// Line heights
export const lineHeight = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
} as const;

// Typography scale for semantic usage
export const typographyScale = {
  // Display text (large headings)
  display: {
    '2xl': {
      fontSize: fontSize['7xl'][0],
      lineHeight: fontSize['7xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
    xl: {
      fontSize: fontSize['6xl'][0],
      lineHeight: fontSize['6xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
    lg: {
      fontSize: fontSize['5xl'][0],
      lineHeight: fontSize['5xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
    md: {
      fontSize: fontSize['4xl'][0],
      lineHeight: fontSize['4xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
    sm: {
      fontSize: fontSize['3xl'][0],
      lineHeight: fontSize['3xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
  },

  // Headings
  heading: {
    h1: {
      fontSize: fontSize['3xl'][0],
      lineHeight: fontSize['3xl'][1].lineHeight,
      fontWeight: fontWeight.bold,
      letterSpacing: letterSpacing.tight,
    },
    h2: {
      fontSize: fontSize['2xl'][0],
      lineHeight: fontSize['2xl'][1].lineHeight,
      fontWeight: fontWeight.semibold,
      letterSpacing: letterSpacing.tight,
    },
    h3: {
      fontSize: fontSize.xl[0],
      lineHeight: fontSize.xl[1].lineHeight,
      fontWeight: fontWeight.semibold,
      letterSpacing: letterSpacing.normal,
    },
    h4: {
      fontSize: fontSize.lg[0],
      lineHeight: fontSize.lg[1].lineHeight,
      fontWeight: fontWeight.semibold,
      letterSpacing: letterSpacing.normal,
    },
    h5: {
      fontSize: fontSize.base[0],
      lineHeight: fontSize.base[1].lineHeight,
      fontWeight: fontWeight.semibold,
      letterSpacing: letterSpacing.normal,
    },
    h6: {
      fontSize: fontSize.sm[0],
      lineHeight: fontSize.sm[1].lineHeight,
      fontWeight: fontWeight.semibold,
      letterSpacing: letterSpacing.wide,
    },
  },

  // Body text
  body: {
    lg: {
      fontSize: fontSize.lg[0],
      lineHeight: fontSize.lg[1].lineHeight,
      fontWeight: fontWeight.normal,
      letterSpacing: letterSpacing.normal,
    },
    base: {
      fontSize: fontSize.base[0],
      lineHeight: fontSize.base[1].lineHeight,
      fontWeight: fontWeight.normal,
      letterSpacing: letterSpacing.normal,
    },
    sm: {
      fontSize: fontSize.sm[0],
      lineHeight: fontSize.sm[1].lineHeight,
      fontWeight: fontWeight.normal,
      letterSpacing: letterSpacing.normal,
    },
  },

  // Labels and captions
  label: {
    lg: {
      fontSize: fontSize.base[0],
      lineHeight: fontSize.base[1].lineHeight,
      fontWeight: fontWeight.medium,
      letterSpacing: letterSpacing.normal,
    },
    base: {
      fontSize: fontSize.sm[0],
      lineHeight: fontSize.sm[1].lineHeight,
      fontWeight: fontWeight.medium,
      letterSpacing: letterSpacing.normal,
    },
    sm: {
      fontSize: fontSize.xs[0],
      lineHeight: fontSize.xs[1].lineHeight,
      fontWeight: fontWeight.medium,
      letterSpacing: letterSpacing.wide,
    },
  },

  // Code and monospace
  code: {
    lg: {
      fontSize: fontSize.base[0],
      lineHeight: fontSize.base[1].lineHeight,
      fontWeight: fontWeight.normal,
      fontFamily: fontFamily.mono.join(', '),
    },
    base: {
      fontSize: fontSize.sm[0],
      lineHeight: fontSize.sm[1].lineHeight,
      fontWeight: fontWeight.normal,
      fontFamily: fontFamily.mono.join(', '),
    },
    sm: {
      fontSize: fontSize.xs[0],
      lineHeight: fontSize.xs[1].lineHeight,
      fontWeight: fontWeight.normal,
      fontFamily: fontFamily.mono.join(', '),
    },
  },
} as const;

// Export complete typography system
export const typography = {
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  typographyScale,
} as const;

// Type definitions
export type FontFamilyToken = keyof typeof fontFamily;
export type FontSizeToken = keyof typeof fontSize;
export type FontWeightToken = keyof typeof fontWeight;
export type LetterSpacingToken = keyof typeof letterSpacing;
export type LineHeightToken = keyof typeof lineHeight;