import React, { useState } from 'react';
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
  Modal,
} from '@mui/material';
import { useFormik } from 'formik';
import { backHalfSchema } from './Schema';
import axios from 'axios';
import BackHalfForm from './BackHalfForm';

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
  const shortUrlKey = props.shortUrl.split('/').pop();
  const [copySuccess, setCopySuccess] = useState(false);
  const [modalDisplay, setModalDisplay] = useState(false);

  const formik = useFormik({
    enableReinitialize: true,
    initialValues: {
      customBackHalf: props.customBackHalf || shortUrlKey,
    },
    validationSchema: backHalfSchema,
    onSubmit: async (values, actions) => {
      const { customBackHalf: backHalf } = values;
      // console.log(values.customBackHalf)

      // call axios post request
      const ApiEndpoint = `${import.meta.env.VITE_API_ENDPOINT}/api/url/custom`;

      try {
        const response = await axios.post(
          ApiEndpoint,
          {
            backHalf: backHalf,
            shortUrl: shortUrlKey,
          },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          },
        );

        const { customBackHalf } = response.data;
        // console.log(`Short URL: ${props.shortUrl} and custom back half: ${customBackHalf}`)
        props.onFormValueChange({
          originalUrl: props.originalUrl,
          shortUrl: props.shortUrl,
          customBackHalf,
        });

        props.onSnackbarSuccess({
          children: `Back half updated to: ${customBackHalf}`,
          severity: 'success',
        });
        actions.resetForm();
      } catch (error) {
        if (error.response.status === 400) {
          const { error: errorMsg, suggestion } = error.response.data;
          console.log(error, suggestion);

          props.onSnackbarSuccess({
            children:
              errorMsg + (suggestion ? `\nSuggested link: ${suggestion}` : ''),
            severity: 'error',
          });
          return;
        }
        props.onSnackbarSuccess({
          children: 'Something went wrong. Please try again later.',
          severity: 'error',
        });
      }
      setModalDisplay(false);
    },
  });

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
        <Modal
          open={modalDisplay}
          onClose={() => setModalDisplay(false)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
          }}
        >
          <BackHalfForm formik={formik} shortUrl={props.shortUrl} />
        </Modal>
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
        <ListItem>
          <ListItemText
            primary={props.customBackHalf}
            sx={{ color: 'primary.main' }}
          />
        </ListItem>
        <ListItem sx={{ pt: 0 }}>{generateButton()}</ListItem>
        <ListItem>
          <Button
            variant="cyanBg"
            fullWidth
            onClick={() => setModalDisplay(true)}
          >
            Edit Back Half
          </Button>
        </ListItem>
        <ListItem sx={{ justifyContent: 'center' }}>
          <QRCodeSVG value={props.shortUrl} size={100} />
        </ListItem>
      </List>

      {/* desktop view */}
      <Stack sx={desktopStyle}>
        <Modal
          open={modalDisplay}
          onClose={() => setModalDisplay(false)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
          }}
        >
          <BackHalfForm formik={formik} shortUrl={props.shortUrl} />
        </Modal>
        <Typography
          variant="body2"
          component="p"
          sx={{ color: 'neutral.veryDarkViolet', fontSize: '1rem' }}
        >
          {props.originalUrl}
        </Typography>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Stack direction="column" spacing={2} sx={{ alignItems: 'center' }}>
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
            {props.customBackHalf && (
              <Typography
                variant="body2"
                component="p"
                sx={{
                  color: 'primary.main',
                  fontSize: '1rem',
                  whiteSpace: 'nowrap',
                }}
              >
                {props.customBackHalf}
              </Typography>
            )}
          </Stack>
          {generateButton()}
          <Button
            variant="cyanBg"
            fullWidth
            onClick={() => setModalDisplay(true)}
          >
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
