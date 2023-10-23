import React from "react";
import { Box, Container } from "@mui/material";
import Hero from "./Hero";
import LinkParent from "./form/LinkParent";



const HomePage = () => {
  return (
    <Container maxWidth="xl" sx={{ pr: 0 }}>
      
      <Hero />
     
      <Box sx={{ mx: "auto", px: 6 }}>
        <LinkParent />

        </Box>
        <div style={{margin:"4rem"}}></div>
    </Container>
  );
};

export default HomePage;