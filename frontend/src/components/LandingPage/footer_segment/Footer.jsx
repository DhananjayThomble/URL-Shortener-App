// STUB: contains footer nav links
import React from 'react';
import { Avatar, Box, IconButton, Stack } from '@mui/material';
import FooterLinkList from './FooterLinkList';
import {
  FaFacebookSquare as FacebookLogo,
  FaTwitter as TwitterLogo,
  FaInstagram as InstagramLogo,
} from 'react-icons/fa';

const textLinks = [
  {
    title: 'Features',
    bodyText: ['Link Shortening', 'Branded Links', 'Analytics'],
  },
  {
    title: 'Resources',
    bodyText: ['Blog', 'Developers', 'Support'],
  },
  {
    title: 'Company',
    bodyText: ['About', 'Our Team', 'Careers', 'Contact'],
  },
];

const iconLinks = [FacebookLogo, TwitterLogo, InstagramLogo];

const containerStyles = {
  backgroundColor: 'neutral.veryDarkViolet',
  flexDirection: { xs: 'column', md: 'row' },
  justifyContent: 'space-around',
  py: 6,
  px: 5,
  textAlign: { xs: 'center', md: 'left' },
};

const textListStyles = {
  display: { md: 'flex' },
};

const iconListStyles = {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'flex-start',
  py: { xs: 3, md: '5px' },
};

const iconButtonStyles = {
  p: 0,
};

const avatarStyles = {
  backgroundColor: 'revert',
  mx: 0.8,
  transform: 'scale(1.1)',
  '&:hover': {
    fill: 'hsl(180, 66%, 49%)',
  },
};

const Footer = () => {
  return (
    <Stack sx={containerStyles}>
      <Box>
        {/* <Logo fill="white" /> */}
        <h2 style={{ color: 'white' }}>SnapURL</h2>
      </Box>

      <Box sx={textListStyles}>
        {textLinks.map((item, index) => {
          return <FooterLinkList key={index} content={item} />;
        })}
      </Box>

      <Stack sx={iconListStyles}>
        {iconLinks.map((item, index) => {
          return (
            <IconButton key={index} sx={iconButtonStyles}>
              <Avatar
                component={item}
                fill="white"
                variant="square"
                sx={avatarStyles}
              />
            </IconButton>
          );
        })}
      </Stack>
    </Stack>
  );
};

export default Footer;
