// Breakpoint values (in pixels)
export const breakpoints = {
  xs: 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof breakpoints;

// Media query helpers
export const mediaQueries = {
  xs: `@media (min-width: ${breakpoints.xs}px)`,
  sm: `@media (min-width: ${breakpoints.sm}px)`,
  md: `@media (min-width: ${breakpoints.md}px)`,
  lg: `@media (min-width: ${breakpoints.lg}px)`,
  xl: `@media (min-width: ${breakpoints.xl}px)`,
  '2xl': `@media (min-width: ${breakpoints['2xl']}px)`,
  
  // Max-width queries
  maxXs: `@media (max-width: ${breakpoints.sm - 1}px)`,
  maxSm: `@media (max-width: ${breakpoints.md - 1}px)`,
  maxMd: `@media (max-width: ${breakpoints.lg - 1}px)`,
  maxLg: `@media (max-width: ${breakpoints.xl - 1}px)`,
  maxXl: `@media (max-width: ${breakpoints['2xl'] - 1}px)`,
  
  // Range queries
  smToMd: `@media (min-width: ${breakpoints.sm}px) and (max-width: ${breakpoints.md - 1}px)`,
  mdToLg: `@media (min-width: ${breakpoints.md}px) and (max-width: ${breakpoints.lg - 1}px)`,
  lgToXl: `@media (min-width: ${breakpoints.lg}px) and (max-width: ${breakpoints.xl - 1}px)`,
} as const;

// Hook for responsive values
export function useBreakpoint() {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      currentBreakpoint: 'lg' as Breakpoint,
    };
  }

  const width = window.innerWidth;
  
  const isMobile = width < breakpoints.md;
  const isTablet = width >= breakpoints.md && width < breakpoints.lg;
  const isDesktop = width >= breakpoints.lg;
  
  let currentBreakpoint: Breakpoint = 'xs';
  if (width >= breakpoints['2xl']) currentBreakpoint = '2xl';
  else if (width >= breakpoints.xl) currentBreakpoint = 'xl';
  else if (width >= breakpoints.lg) currentBreakpoint = 'lg';
  else if (width >= breakpoints.md) currentBreakpoint = 'md';
  else if (width >= breakpoints.sm) currentBreakpoint = 'sm';

  return {
    isMobile,
    isTablet,
    isDesktop,
    currentBreakpoint,
  };
}

// Responsive value helper
export function getResponsiveValue<T>(
  values: Partial<Record<Breakpoint, T>>,
  currentBreakpoint: Breakpoint
): T | undefined {
  // Try to find exact match first
  if (values[currentBreakpoint] !== undefined) {
    return values[currentBreakpoint];
  }

  // Fallback to smaller breakpoints
  const breakpointOrder: Breakpoint[] = ['2xl', 'xl', 'lg', 'md', 'sm', 'xs'];
  const currentIndex = breakpointOrder.indexOf(currentBreakpoint);
  
  for (let i = currentIndex; i < breakpointOrder.length; i++) {
    const bp = breakpointOrder[i];
    if (values[bp] !== undefined) {
      return values[bp];
    }
  }

  return undefined;
}

// Container max-widths
export const containerMaxWidths = {
  xs: '100%',
  sm: `${breakpoints.sm}px`,
  md: `${breakpoints.md}px`,
  lg: `${breakpoints.lg}px`,
  xl: `${breakpoints.xl}px`,
  '2xl': `${breakpoints['2xl']}px`,
} as const;

// Grid system
export const gridColumns = 12;
export const gridGutter = {
  xs: 16,
  sm: 16,
  md: 24,
  lg: 24,
  xl: 32,
  '2xl': 32,
} as const;