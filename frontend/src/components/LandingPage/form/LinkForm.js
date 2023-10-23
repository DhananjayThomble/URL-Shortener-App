import React from "react";
import { Form, FormikProvider, useFormik } from "formik";
import { Button, Stack, TextField } from "@mui/material";
import { LinkSchema } from "./Schema";
import mobileBackgroundShorten from "../Images/ShortenMobile.svg";
import desktopBackgroundShorten from "../Images/ShortenDesktop.svg";
import axios from "axios";
import PropTypes from "prop-types";

const LinkForm = ({ onFormValueChange, onSnackbarSuccess }) => {
  const formik = useFormik({
    initialValues: {
      link: "",
    },
    validationSchema: LinkSchema,
    onSubmit: async (values, actions) => {
      const { link } = values;

      // console.log("Original URL:", link);

      // call axios post request
      const ApiEndpoint = `${process.env.REACT_APP_API_ENDPOINT}/api/url`;

      try {
        const response = await axios.post(
          ApiEndpoint,
          {
            url: link,
          },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );

        const { shortUrl } = response.data;
        // console.log(`Short URL: ${shortUrl} and Original URL: ${link}`);
        onFormValueChange({ originalUrl: link, shortUrl });

        onSnackbarSuccess({
          children: "Your shortlink is ready",
          severity: "success",
        });
        actions.resetForm();
        // console.log("Short URL:", shortUrl);
      } catch (error) {
        // console.log(error);
        if (error.response.status === 401) {
          onSnackbarSuccess({
            children: "Please login to create a shortlink",
            severity: "error",
          });
          return;
        }
        onSnackbarSuccess({
          children: "Something went wrong. Please try again later.",
          severity: "error",
        });
      }
    },
  });

  const { errors, touched, isSubmitting, handleSubmit, getFieldProps } = formik;

  const style = {
    // border: "3px solid",
    backgroundImage: {
      xs: `url(${mobileBackgroundShorten})`,
      sm: `url(${desktopBackgroundShorten})`,
    },
    backgroundSize: {
      xs: "70% auto",
      sm: "cover",
    },
    backgroundRepeat: "no-repeat",
    backgroundPosition: {
      xs: "right top",
      sm: "bottom",
    },
    bgcolor: "violetBg.main",
    borderRadius: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    maxWidth: "100%",
    px: 6,
    py: 4,
  };

  return (
    <FormikProvider value={formik}>
      <Form autoComplete="off" noValidate onSubmit={handleSubmit}>
        <Stack sx={style}>
          <TextField
            fullWidth
            type="url"
            placeholder="Shorten a link here..."
            {...getFieldProps("link")}
            error={Boolean(touched.link && errors.link)}
            helperText={touched.link && errors.link}
            sx={{
              bgcolor: "#fff",
              borderRadius: 1,
              flexBasis: { sx: "100%", md: "60vw" },
            }}
          />

          <Button
            fullWidth
            size="large"
            type="submit"
            variant="cyanBg"
            sx={{
              mt: { xs: 2, md: 0 },
              p: 2,
              fontSize: "1.15rem",
              fontWeight: 600,
              flexBasis: { sx: "100%", md: "15vw" },
            }}
          >
            {isSubmitting ? "loading..." : "Shorten It!"}
          </Button>
        </Stack>
      </Form>
    </FormikProvider>
  );
};

export default LinkForm;

LinkForm.propTypes = {
  onFormValueChange: PropTypes.func.isRequired,
  onSnackbarSuccess: PropTypes.func.isRequired,
};