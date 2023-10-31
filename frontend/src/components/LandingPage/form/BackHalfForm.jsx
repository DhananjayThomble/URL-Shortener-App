import React from 'react';
import { Form, FormikProvider } from 'formik';
import { Button, TextField, Typography } from '@mui/material';

const BackHalfForm = (props) => {
  const { errors, touched, isSubmitting, handleSubmit, getFieldProps } = props.formik;

  return (
    <FormikProvider value={props.formik}>
      <Form
        onSubmit={handleSubmit}
        noValidate
        autoComplete="off"
        style={{
          display: 'grid',
          backgroundColor: '#fff',
          padding: '1.5rem',
          margin: '0.5rem',
          borderRadius: '1rem',
          gap: '1rem',
          '& > :not(style)': { m: 1 },
        }}
      >
        <Typography
          variant="body2"
          component="p"
          sx={{ color: 'neutral.veryDarkViolet', fontSize: { xs: '0.75rem', sm: '1rem' } }}
        >
          Edit the last part of your shortened link: {props.shortUrl}
        </Typography>
        <TextField
          type="text"
          variant="standard"
          label="Custom back half"
          color="violetBg"
          {...getFieldProps('customBackHalf')}
          error={Boolean(touched.customBackHalf && errors.customBackHalf)}
          helperText={touched.customBackHalf && errors.customBackHalf}
          inputProps={{
            style: { fontSize: { xs: '0.75rem', sm: '1rem'}, padding: '1rem 0.5rem', backgroundColor: 'transparent' }
          }}
          InputLabelProps={{
            style: { paddingLeft: '0.5rem' }
          }}
        />
        <Button
          size="small"
          type="submit"
          variant="cyanBg"
          sx={{
            mt: { xs: 2, md: 0 },
            p: 2,
            fontSize: { xs: '1rem', sm: '1.15rem'},
            fontWeight: 600,
            maxWidth: 'fit-content',
            maxHeight: '3rem'
          }}
        >
          {isSubmitting ? 'loading...' : 'Create custom back half!'}
        </Button>
      </Form>
    </FormikProvider>
  );
};

export default BackHalfForm;