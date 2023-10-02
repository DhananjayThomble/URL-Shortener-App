import React from "react";
import { Container } from "react-bootstrap";

function Footer(props) {
  return (
    // footer using react-bootstrap
    <Container
      fluid
      className="text-center bg-secondary fixed-bottom
                    text-white text-uppercase p-2"
    >
      URL Shortener App by <b> Dhananjay </b>
    </Container>
  );
}

export default Footer;
