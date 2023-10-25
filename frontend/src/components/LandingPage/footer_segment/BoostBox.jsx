import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import mobileBackgroundBoost from '../Images/ShortenMobile.svg';
import desktopBackgroundBoost from '../Images/desktop.svg';

const boxStyle = {
  backgroundImage: {
    xs: `url(${mobileBackgroundBoost})`,
    sm: `url(${desktopBackgroundBoost})`,
  },
  backgroundSize: 'cover',
  backgroundRepeat: 'no-repeat',
  backgroundPosition: {
    xs: 'center ',
    sm: 'bottom',
  },
  bgcolor: 'violetBg.main',
  borderRadius: 0,
  maxWidth: '100%',
  px: 6,
  py: {
    xs: 6,
    md: 8,
  },
  textAlign: 'center',
};

const textStyle = {
  color: 'secondary.main',
  fontWeight: 900,
};

const buttonStyle = {
  borderRadius: 8,
  px: 1.3,
  py: { xs: 1, md: 2 },
  fontSize: '1.15rem',
  fontWeight: 600,
  mt: { xs: 1.5, md: 2 },
  width: 'clamp(10em, 20%, 11em )',
};

const BoostBox = () => {
  return (
    <Box sx={boxStyle}>
      <Typography variant="h5" component="h3" sx={textStyle}>
        Boost your links today
      </Typography>
      <Button variant="cyanBg" sx={buttonStyle}>
        Get Started
      </Button>
    </Box>
  );
};

export default BoostBox;
