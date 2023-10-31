import React from 'react';
import { Stack, Typography } from '@mui/material';
import FooterLink from './FooterLink';
import propTypes from 'prop-types';

const FooterLinkList = ({ content }) => {
  return (
    <Stack
      sx={{
        flexDirection: 'column',
        alignItems: { xs: 'center', md: 'flex-start' },
        px: 3,
      }}
    >
      <Typography
        variant="h6"
        sx={{
          color: 'secondary.main',
          fontSize: '1rem',
          py: { xs: 2, md: 0 },
          pb: { xs: 0, md: 2 },
        }}
      >
        {content.title}
      </Typography>
      {content.bodyText.map((item) => (
        <FooterLink key={item} bodyText={item.text} path={item.path} />
      ))}
    </Stack>
  );
};

export default FooterLinkList;

FooterLinkList.defaultProps = {
  content: {
    title: 'Features',
    bodyText: [
      {
        text: 'Link Shortening',
        path: '',
      },
      {
        text: 'Branded Links',
        path: '',
      },
      {
        text: 'Analytics',
        path: '',
      },
    ],
  },
};

FooterLinkList.propTypes = {
  content: propTypes.object,
};
