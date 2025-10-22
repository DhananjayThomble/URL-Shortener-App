import { createTheme, ThemeOptions } from '@mui/material/styles';
import { colors } from './colors';
import { typography } from './typography';
import { tokens } from './tokens';

// Base theme configuration
const baseThemeOptions: ThemeOptions = {
  typography: {
    fontFamily: typography.fontFamily.sans.join(','),
    h1: {
      fontSize: typography.typographyScale.heading.h1.fontSize,
      fontWeight: typography.typographyScale.heading.h1.fontWeight,
      lineHeight: typography.typographyScale.heading.h1.lineHeight,
      letterSpacing: typography.typographyScale.heading.h1.letterSpacing,
    },
    h2: {
      fontSize: typography.typographyScale.heading.h2.fontSize,
      fontWeight: typography.typographyScale.heading.h2.fontWeight,
      lineHeight: typography.typographyScale.heading.h2.lineHeight,
      letterSpacing: typography.typographyScale.heading.h2.letterSpacing,
    },
    h3: {
      fontSize: typography.typographyScale.heading.h3.fontSize,
      fontWeight: typography.typographyScale.heading.h3.fontWeight,
      lineHeight: typography.typographyScale.heading.h3.lineHeight,
      letterSpacing: typography.typographyScale.heading.h3.letterSpacing,
    },
    h4: {
      fontSize: typography.typographyScale.heading.h4.fontSize,
      fontWeight: typography.typographyScale.heading.h4.fontWeight,
      lineHeight: typography.typographyScale.heading.h4.lineHeight,
      letterSpacing: typography.typographyScale.heading.h4.letterSpacing,
    },
    h5: {
      fontSize: typography.typographyScale.heading.h5.fontSize,
      fontWeight: typography.typographyScale.heading.h5.fontWeight,
      lineHeight: typography.typographyScale.heading.h5.lineHeight,
      letterSpacing: typography.typographyScale.heading.h5.letterSpacing,
    },
    h6: {
      fontSize: typography.typographyScale.heading.h6.fontSize,
      fontWeight: typography.typographyScale.heading.h6.fontWeight,
      lineHeight: typography.typographyScale.heading.h6.lineHeight,
      letterSpacing: typography.typographyScale.heading.h6.letterSpacing,
    },
    body1: {
      fontSize: typography.typographyScale.body.base.fontSize,
      fontWeight: typography.typographyScale.body.base.fontWeight,
      lineHeight: typography.typographyScale.body.base.lineHeight,
      letterSpacing: typography.typographyScale.body.base.letterSpacing,
    },
    body2: {
      fontSize: typography.typographyScale.body.sm.fontSize,
      fontWeight: typography.typographyScale.body.sm.fontWeight,
      lineHeight: typography.typographyScale.body.sm.lineHeight,
      letterSpacing: typography.typographyScale.body.sm.letterSpacing,
    },
    subtitle1: {
      fontSize: typography.typographyScale.body.lg.fontSize,
      fontWeight: typography.fontWeight.medium,
      lineHeight: typography.typographyScale.body.lg.lineHeight,
    },
    subtitle2: {
      fontSize: typography.typographyScale.body.base.fontSize,
      fontWeight: typography.fontWeight.medium,
      lineHeight: typography.typographyScale.body.base.lineHeight,
    },
    caption: {
      fontSize: typography.typographyScale.label.sm.fontSize,
      fontWeight: typography.typographyScale.label.sm.fontWeight,
      lineHeight: typography.typographyScale.label.sm.lineHeight,
      letterSpacing: typography.typographyScale.label.sm.letterSpacing,
    },
    overline: {
      fontSize: typography.fontSize.xs[0],
      fontWeight: typography.fontWeight.semibold,
      lineHeight: typography.fontSize.xs[1].lineHeight,
      letterSpacing: typography.letterSpacing.widest,
      textTransform: 'uppercase',
    },
  },
  shape: {
    borderRadius: parseInt(tokens.borderRadius.lg),
  },
  spacing: 8, // Base spacing unit
  breakpoints: {
    values: {
      xs: tokens.breakpoints.xs,
      sm: tokens.breakpoints.sm,
      md: tokens.breakpoints.md,
      lg: tokens.breakpoints.lg,
      xl: tokens.breakpoints.xl,
    },
  },
  transitions: {
    duration: {
      shortest: 150,
      shorter: 200,
      short: 250,
      standard: 300,
      complex: 375,
      enteringScreen: 225,
      leavingScreen: 195,
    },
    easing: {
      easeInOut: tokens.animations.easing.easeInOut,
      easeOut: tokens.animations.easing.easeOut,
      easeIn: tokens.animations.easing.easeIn,
      sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: typography.fontWeight.medium,
          borderRadius: tokens.borderRadius.lg,
          fontSize: typography.fontSize.sm[0],
          lineHeight: typography.fontSize.sm[1].lineHeight,
          padding: '10px 16px',
          minHeight: '40px',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: tokens.shadows.md,
          },
        },
        sizeSmall: {
          padding: '6px 12px',
          fontSize: typography.fontSize.xs[0],
          minHeight: '32px',
        },
        sizeLarge: {
          padding: '12px 20px',
          fontSize: typography.fontSize.base[0],
          minHeight: '48px',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: tokens.shadows.sm,
          borderRadius: tokens.borderRadius.xl,
          border: '1px solid',
          borderColor: 'var(--border)',
          backgroundColor: 'var(--card)',
          color: 'var(--card-foreground)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: tokens.borderRadius.lg,
            fontSize: typography.fontSize.sm[0],
            '& fieldset': {
              borderColor: 'var(--border)',
            },
            '&:hover fieldset': {
              borderColor: 'var(--ring)',
            },
            '&.Mui-focused fieldset': {
              borderColor: 'var(--ring)',
              borderWidth: '2px',
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: tokens.borderRadius.md,
          fontSize: typography.fontSize.xs[0],
          fontWeight: typography.fontWeight.medium,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: tokens.borderRadius.xl,
          boxShadow: tokens.shadows.xl,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: tokens.borderRadius.lg,
          boxShadow: tokens.shadows.lg,
          border: '1px solid',
          borderColor: 'var(--border)',
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: 'var(--tooltip-bg)',
          color: 'var(--tooltip-text)',
          fontSize: typography.fontSize.xs[0],
          borderRadius: tokens.borderRadius.md,
          padding: '6px 8px',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'var(--header-bg)',
          borderBottom: '1px solid var(--header-border)',
          backdropFilter: 'blur(8px)',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
        },
      },
    },
  },
};

// Create Material-UI light theme
export const lightTheme = createTheme({
  ...baseThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: colors.primary[500],
      light: colors.primary[300],
      dark: colors.primary[700],
      contrastText: '#ffffff',
    },
    secondary: {
      main: colors.secondary[500],
      light: colors.secondary[300],
      dark: colors.secondary[700],
      contrastText: '#ffffff',
    },
    error: {
      main: colors.error[500],
      light: colors.error[300],
      dark: colors.error[700],
      contrastText: '#ffffff',
    },
    warning: {
      main: colors.warning[500],
      light: colors.warning[300],
      dark: colors.warning[700],
      contrastText: colors.gray[900],
    },
    info: {
      main: colors.primary[500],
      light: colors.primary[300],
      dark: colors.primary[700],
      contrastText: '#ffffff',
    },
    success: {
      main: colors.success[500],
      light: colors.success[300],
      dark: colors.success[700],
      contrastText: '#ffffff',
    },
    grey: colors.gray,
    background: {
      default: colors.gray[50],
      paper: '#ffffff',
    },
    text: {
      primary: colors.gray[900],
      secondary: colors.gray[600],
      disabled: colors.gray[400],
    },
    divider: colors.gray[200],
    action: {
      active: colors.gray[600],
      hover: colors.gray[50],
      selected: colors.gray[100],
      disabled: colors.gray[300],
      disabledBackground: colors.gray[100],
    },
  },
});

// Create Material-UI dark theme
export const darkTheme = createTheme({
  ...baseThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: colors.primary[400],
      light: colors.primary[300],
      dark: colors.primary[600],
      contrastText: colors.gray[900],
    },
    secondary: {
      main: colors.secondary[400],
      light: colors.secondary[300],
      dark: colors.secondary[600],
      contrastText: colors.gray[900],
    },
    error: {
      main: colors.error[400],
      light: colors.error[300],
      dark: colors.error[600],
      contrastText: colors.gray[900],
    },
    warning: {
      main: colors.warning[400],
      light: colors.warning[300],
      dark: colors.warning[600],
      contrastText: colors.gray[900],
    },
    info: {
      main: colors.primary[400],
      light: colors.primary[300],
      dark: colors.primary[600],
      contrastText: colors.gray[900],
    },
    success: {
      main: colors.success[400],
      light: colors.success[300],
      dark: colors.success[600],
      contrastText: colors.gray[900],
    },
    grey: colors.gray,
    background: {
      default: colors.gray[900],
      paper: colors.gray[800],
    },
    text: {
      primary: colors.gray[100],
      secondary: colors.gray[400],
      disabled: colors.gray[600],
    },
    divider: colors.gray[700],
    action: {
      active: colors.gray[400],
      hover: colors.gray[800],
      selected: colors.gray[700],
      disabled: colors.gray[600],
      disabledBackground: colors.gray[800],
    },
  },
});

// Core theme exports
export { colors } from './colors';
export { typography } from './typography';
export { 
  spacing, 
  componentSpacing, 
  borderRadius as spacingBorderRadius,
  shadows as spacingShadows,
  zIndex as spacingZIndex 
} from './spacing';
export { breakpoints } from './breakpoints';
export { tokens } from './tokens';
export { 
  lightThemeVariables,
  darkThemeVariables,
  applyThemeVariables,
  getCSSVariable,
  setCSSVariable,
  generateThemeCSS,
  cssVariables
} from './cssVariables';
export { 
  getColor,
  getSpacing as getSpacingToken,
  getShadow,
  getBorderRadius as getBorderRadiusToken,
  responsive,
  createComponentStyles,
  focusStyles,
  hoverStyles,
  disabledStyles,
  createStyles,
  animationStyles,
  skeletonStyles,
  truncateStyles,
  glassMorphismStyles
} from './utils';

// Theme provider components
export { ThemeProvider } from '../../components/layout/ThemeProvider';
export { useTheme } from '../../hooks/useTheme';
