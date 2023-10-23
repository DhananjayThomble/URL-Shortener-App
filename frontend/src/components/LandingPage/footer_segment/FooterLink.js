import React from "react";
import { Button } from "@mui/material";
import propTypes from "prop-types";

const FooterLink = ({ bodyText }) => {
  return (
    <Button
      sx={{
        color: "neutral.gray",
        minWidth: 0,
        px: 0,
        "&:hover": {
          color: "hsl(180, 66%, 49%)",
          fontWeight: 400,
          backgroundColor: "transparent",
        },
      }}
    >
      {bodyText}
    </Button>
  );
};

export default FooterLink;

FooterLink.defaultProps = {
  bodyText: "FooterLink",
};

FooterLink.propTypes = {
  bodyText: propTypes.string,
};