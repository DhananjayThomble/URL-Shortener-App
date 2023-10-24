// STUB: create appTheme
// appTheme contains custom palette, typography, components config

const appTheme = {
  palette: {
    primary: {
      main: 'hsl(180, 66%, 49%)', // cyan
    },
    secondary: {
      main: '#fff', // white
      contrastText: 'hsl(257, 27%, 26%)', // dark violet
    },
    violetBg: {
      main: 'hsl(257, 27%, 26%)', // dark violet
      contrastText: '#fff', // white
    },
    neutral: {
      lightGray: 'hsla(0, 0%, 35%, 0.7)',
      gray: 'hsl(0, 0%, 75%)',
      grayishViolet: 'hsl(257, 7%, 63%)',
      veryDarkBlue: 'hsl(255, 11%, 22%)',
      veryDarkViolet: 'hsl(260, 8%, 14%)',
    },
  },
  typography: {
    fontFamily: "'Poppins', sans-serif",
    h1: {
      fontWeight: 800,
    },
    button: {
      fontSize: '0.9rem',
      textTransform: 'capitalize',
    },
    body1: {
      // fontSize: "1.45rem",
      fontSize: window.innerWidth <= 768 ? '1rem' : '1.45rem',
    },
  },
  components: {
    // Name of the component ⚛️
    // MuiButtonBase: {
    // 	defaultProps: {
    // 		// The props to apply
    // 		disableRipple: true, // No more ripple, on the whole application 💣!
    // 	},
    // },
    MuiButton: {
      variants: [
        {
          props: { variant: 'cyanBg' },
          style: {
            backgroundColor: 'hsl(180, 66%, 49%)',
            color: '#fff',
            '&:hover': {
              backgroundColor: 'hsla(180, 66%, 49%, 0.65)',
            },
            '&:focus': {
              backgroundColor: 'hsl(257, 27%, 26%)',
            },
          },
        },
        {
          props: { variant: 'violetText' },
          style: {
            backgroundColor: '#fff',
            color: 'hsl(257, 27%, 26%)',
          },
        },
        {
          props: { variant: 'text' },
          style: {
            color: '#fff',
            '&:hover': {
              color: 'hsl(260, 8%, 14%)',
              fontWeight: 800,
              backgroundColor: 'transparent',
            },
          },
        },
      ],
      defaultProps: {
        disableElevation: true,
        disableFocusRipple: true,
        disableRipple: true,
      },
    },
    MuiPaper: {
      styleOverrides: {
        // Name of the slot
        root: {
          // Some CSS
          backgroundImage: 'none', // remove box-shadow in dark-mode
          // backgroundColor: '#121212'
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: {
          fontSize: '0.9rem',
        },
      },
    },
  },
};

export default appTheme;
