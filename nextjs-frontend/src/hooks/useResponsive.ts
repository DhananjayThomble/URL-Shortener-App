'use client';

import { useState, useEffect } from 'react';
import { breakpoints, getResponsiveValue } from '@/lib/theme/breakpoints';
import type { Breakpoint } from '@/lib/theme/breakpoints';

export function useResponsive() {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>('lg');
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      setWindowSize({ width, height });

      // Determine current breakpoint
      let bp: Breakpoint = 'xs';
      if (width >= breakpoints['2xl']) bp = '2xl';
      else if (width >= breakpoints.xl) bp = 'xl';
      else if (width >= breakpoints.lg) bp = 'lg';
      else if (width >= breakpoints.md) bp = 'md';
      else if (width >= breakpoints.sm) bp = 'sm';

      setCurrentBreakpoint(bp);
    };

    // Set initial values
    handleResize();

    // Add event listener
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = currentBreakpoint === 'xs' || currentBreakpoint === 'sm';
  const isTablet = currentBreakpoint === 'md';
  const isDesktop = currentBreakpoint === 'lg' || currentBreakpoint === 'xl' || currentBreakpoint === '2xl';

  // Helper function to get responsive value
  const getResponsive = <T>(values: Partial<Record<Breakpoint, T>>): T | undefined => {
    return getResponsiveValue(values, currentBreakpoint);
  };

  // Helper function to check if current breakpoint matches
  const isBreakpoint = (bp: Breakpoint): boolean => {
    return currentBreakpoint === bp;
  };

  // Helper function to check if current breakpoint is at least the specified one
  const isBreakpointUp = (bp: Breakpoint): boolean => {
    const bpOrder: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const currentIndex = bpOrder.indexOf(currentBreakpoint);
    const targetIndex = bpOrder.indexOf(bp);
    return currentIndex >= targetIndex;
  };

  // Helper function to check if current breakpoint is at most the specified one
  const isBreakpointDown = (bp: Breakpoint): boolean => {
    const bpOrder: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];
    const currentIndex = bpOrder.indexOf(currentBreakpoint);
    const targetIndex = bpOrder.indexOf(bp);
    return currentIndex <= targetIndex;
  };

  return {
    // Current state
    currentBreakpoint,
    windowSize,
    
    // Device type helpers
    isMobile,
    isTablet,
    isDesktop,
    
    // Breakpoint helpers
    isBreakpoint,
    isBreakpointUp,
    isBreakpointDown,
    
    // Responsive value helper
    getResponsive,
    
    // Specific breakpoint checks
    isXs: isBreakpoint('xs'),
    isSm: isBreakpoint('sm'),
    isMd: isBreakpoint('md'),
    isLg: isBreakpoint('lg'),
    isXl: isBreakpoint('xl'),
    is2Xl: isBreakpoint('2xl'),
    
    // Up checks (at least this size)
    isSmUp: isBreakpointUp('sm'),
    isMdUp: isBreakpointUp('md'),
    isLgUp: isBreakpointUp('lg'),
    isXlUp: isBreakpointUp('xl'),
    is2XlUp: isBreakpointUp('2xl'),
    
    // Down checks (at most this size)
    isSmDown: isBreakpointDown('sm'),
    isMdDown: isBreakpointDown('md'),
    isLgDown: isBreakpointDown('lg'),
    isXlDown: isBreakpointDown('xl'),
    is2XlDown: isBreakpointDown('2xl'),
  };
}

export default useResponsive;