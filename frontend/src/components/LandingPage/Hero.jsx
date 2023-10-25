import React from 'react';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import HeroImage from './Images/working_img.svg';

const Hero = () => {
  return (
    <section>
      {/* mobile screen */}
      <Stack sx={{ display: { xs: 'flex', md: 'none' }, px: 2 }}>
        <Box>
          <img
            src={HeroImage}
            alt="presentation"
            style={{
              maxWidth: '100%',
              height: 'auto',
            }}
          />
        </Box>
        <Stack alignItems="center" sx={{ my: 3 }}>
          <Box sx={{ mb: 3, textAlign: 'center' }}>
            <Typography
              variant="h3"
              component="h1"
              sx={{
                color: 'neutral.veryDarkViolet',
                mb: 1.5,
                letterSpacing: -1,
                lineHeight: 1,
                fontWeight: 800,
                fontSize: '2.35rem',
              }}
            >
              Shorten, Share, Succeed
            </Typography>
            <Typography
              variant="body2"
              component="p"
              sx={{
                color: 'neutral.grayishViolet',
                lineHeight: 1.73,
                fontSize: '0.92rem',
              }}
            >
              Welcome to SnapURL <br></br> Simplify Your Links, Maximize Your
              Impact
            </Typography>
          </Box>
          <Button
            variant="cyanBg"
            sx={{
              borderRadius: 8,
              p: 1.3,
              width: '40%',
              fontSize: '1rem',
              fontWeight: 600,
            }}
          >
            Get Started
          </Button>
        </Stack>
      </Stack>

      {/* desktop screen */}
      <Grid
        container
        direction="row"
        sx={{
          display: { xs: 'none', md: 'flex' },
          px: 6,
          py: 8,
          mx: 'auto',
          overflow: 'hidden',
        }}
      >
        <Grid item md={7}>
          <Box sx={{ my: 5, maxWidth: '85%' }}>
            <Typography
              variant="h1"
              component="h1"
              sx={{
                color: 'neutral.veryDarkViolet',
                fontSize: '5rem',
                mb: 1.5,
                letterSpacing: -3,
                lineHeight: 0.9,
              }}
            >
              Shorten, Share, Succeed
            </Typography>
            <Typography
              variant="body1"
              component="p"
              sx={{
                color: 'neutral.grayishViolet',
              }}
            >
              Welcome to SnapURL <br></br> Simplify Your Links, Maximize Your
              Impact
            </Typography>
          </Box>
          <Button
            variant="cyanBg"
            sx={{
              borderRadius: 8,
              px: 1.3,
              py: 2,
              fontSize: '1.15rem',
              width: '25%',
              fontWeight: 600,
            }}
          >
            Get Started
          </Button>
        </Grid>

        <Grid item md={5}>
          <img
            src={HeroImage}
            alt="presentation"
            style={{
              maxWidth: '130%',
              height: 'auto',
            }}
          />
        </Grid>
      </Grid>
    </section>
  );
};

export default Hero;
