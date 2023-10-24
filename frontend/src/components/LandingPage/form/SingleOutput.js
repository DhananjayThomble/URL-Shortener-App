import React, { useState } from 'react';
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';

import { QRCodeSVG } from 'qrcode.react';

const mobileStyle = {
  width: '100%',
  display: { xs: 'block', sm: 'none' },
};
const desktopStyle = {
  display: { xs: 'none', sm: 'flex' },
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  p: 2,
  width: '100%',
};

const SingleOutput = (props) => {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleEditBackHalf = () => {
    const currentBackHalf = window.prompt(
      `Edit the last part of your shortened link: ${props.shortUrl}`,
      props.shortUrl.split('/').pop(),
    );

    if (currentBackHalf !== null) {
      // Handle the updated back half, e.g., make an API call to update the link
      alert(`Back Half updated to: ${currentBackHalf}`);
    }
  };

  const handleClick = () => {
    navigator.clipboard.writeText(props.shortUrl);
    setCopySuccess(true);

    setTimeout(() => {
      setCopySuccess(false);
    }, 5000);
  };

  const generateButton = () => {
    return (
      <Button variant="cyanBg" fullWidth onClick={handleClick}>
        {copySuccess ? 'copied!' : 'copy'}
      </Button>
    );
  };

  return (
    <Paper sx={{ mt: 2 }}>
      {/* mobile view */}

      <List sx={mobileStyle}>
        <ListItem divider>
          <ListItemText
            primary={props.originalUrl}
            sx={{ color: 'neutral.veryDarkViolet' }}
          />
        </ListItem>
        <ListItem>
          <ListItemText
            primary={props.shortUrl}
            sx={{ color: 'primary.main' }}
          />
        </ListItem>
        <ListItem sx={{ pt: 0 }}>{generateButton()}</ListItem>
        <ListItem>
          <Button variant="cyanBg" fullWidth onClick={handleEditBackHalf}>
            Edit Back Half
          </Button>
        </ListItem>
        <ListItem sx={{ justifyContent: 'center' }}>
          <QRCodeSVG value={props.shortUrl} size={100} />
        </ListItem>
      </List>

      <Stack sx={desktopStyle}>
        <Typography
          variant="body2"
          component="p"
          sx={{ color: 'neutral.veryDarkViolet', fontSize: '1rem' }}
        >
          {props.originalUrl}
        </Typography>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Typography
            variant="body2"
            component="p"
            sx={{
              color: 'primary.main',
              fontSize: '1rem',
              whiteSpace: 'nowrap',
            }}
          >
            {props.shortUrl}
          </Typography>
          {generateButton()}
          <Button variant="cyanBg" fullWidth onClick={handleEditBackHalf}>
            Edit
          </Button>
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <QRCodeSVG value={props.shortUrl} size={100} />
        </Stack>
      </Stack>
    </Paper>
  );
};

export default SingleOutput;
