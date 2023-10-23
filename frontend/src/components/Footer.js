import React from "react";
import "./Footer.css";
import { Container, Typography, IconButton } from "@mui/material";
import { Facebook, Twitter, Instagram } from "@mui/icons-material";
import InsertLinkIcon from '@mui/icons-material/InsertLink';


function Footer() {

  return (
    <Container className="footer">
      <div className="mainfooter">
        <div className="left">
          <div className="Heading">
        <InsertLinkIcon className="Icon" sx={{ display: { xs: 'none', md: 'flex' }, mr: 1 }} />
          <Typography
            variant="h5"
            color="inherit"
            style={{ marginLeft: "40px", fontWeight: "bold" }}
          >
            SnapURL
          </Typography>
          </div>
          <div className="othertext">
            <span>&copy;2021</span>

            <span>Company</span>

            <span>Terms</span>

            <span>Privacy</span>
          </div>
        </div>
        <div className="right">
          <div className="Social">
            <IconButton href="#" color="inherit">
              <Facebook />
            </IconButton>
            <IconButton href="#" color="inherit">
              <Twitter />
            </IconButton>
            <IconButton href="#" color="inherit">
              <Instagram />
            </IconButton>
          </div>
          <div className="othertext">
            <span>About</span>

            <span>FQA</span>

            <span>Contact</span>

            <span>Blog</span>
          </div>
        </div>
      </div>
    </Container>
  );
}

export default Footer;