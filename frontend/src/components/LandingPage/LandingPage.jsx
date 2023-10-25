import './LandingPage.css';
import { createTheme, ThemeProvider } from '@mui/material';
import HomePage from './HomePage';
import appTheme from './appTheme';
import FooterSegment from './footer_segment/FooterSegment';
import React from 'react';

const theme = createTheme(appTheme);

function LandingPage() {
  return (
    <div>
      <ThemeProvider theme={theme}>
        <HomePage />
        <FooterSegment />
      </ThemeProvider>
    </div>
  );
}

export default LandingPage;
