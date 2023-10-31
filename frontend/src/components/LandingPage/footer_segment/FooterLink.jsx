import React from 'react';
import { Button } from '@mui/material';
import propTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

const FooterLink = ({ bodyText, path }) => {
  const navigate = useNavigate();

  return (
    <Button
      sx={{
        color: 'neutral.gray',
        minWidth: 0,
        px: 0,
        '&:hover': {
          color: 'hsl(180, 66%, 49%)',
          fontWeight: 400,
          backgroundColor: 'transparent',
        },
      }}
      onClick={() => {
        navigate(path);
      }}
    >
      {bodyText}
    </Button>
  );
};

export default FooterLink;

FooterLink.defaultProps = {
  bodyText: 'FooterLink',
  path: '',
};

FooterLink.propTypes = {
  bodyText: propTypes.string,
  path: propTypes.string,
};
