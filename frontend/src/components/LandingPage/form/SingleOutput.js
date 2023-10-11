import React, { useState } from "react";
import {
  Button,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

const mobileStyle = {
  width: "100%",
  display: { xs: "block", sm: "none" },
};
const desktopStyle = {
  display: { xs: "none", sm: "flex" },
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  p: 2,
  width: "100%",
};

const SingleOutput = (props) => {
  const [copySuccess, setCopySuccess] = useState(false);

  const handleClick = () => {
    navigator.clipboard.writeText(props.full_short_link);
    setCopySuccess(true);

    setTimeout(() => {
      setCopySuccess(false);
    }, 5000);
  };

  const generateButton = () => {
    return (
      <Button variant="cyanBg" fullWidth onClick={handleClick}>
        {copySuccess ? "copied!" : "copy"}
      </Button>
    );
  };

  return (
    <Paper sx={{ mt: 2 }}>
      {/* mobile view */}
      <List sx={mobileStyle}>
        <ListItem divider>
          <ListItemText
            primary={props.original_link}
            sx={{ color: "neutral.veryDarkViolet" }}
          />
        </ListItem>
        <ListItem>
          <ListItemText
            primary={props.full_short_link}
            sx={{ color: "primary.main" }}
          />
        </ListItem>
        <ListItem sx={{ pt: 0 }}>{generateButton()}</ListItem>
      </List>

      {/* Desktop view */}
      <Stack sx={desktopStyle}>
        <Typography
          variant="body2"
          component="p"
          sx={{ color: "neutral.veryDarkViolet", fontSize: "1rem" }}
        >
          {props.original_link}
        </Typography>

        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography
            variant="body2"
            component="p"
            sx={{
              color: "primary.main",
              fontSize: "1rem",
              whiteSpace: "nowrap",
            }}
          >
            {props.full_short_link}
          </Typography>
          {generateButton()}
        </Stack>
      </Stack>
    </Paper>
  );
};

export default SingleOutput;

SingleOutput.defaultProps = {
  original_link: "http://www.frontendmentor.io",
  full_short_link: "https://rel.link/k4lKyk",
};
