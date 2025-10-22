'use client';

import { Box, Typography, Button, Container } from '@mui/material';
import { Home, ArrowBack } from '@mui/icons-material';
import Link from 'next/link';

export default function NotFound() {
  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          textAlign: 'center',
          gap: 3,
        }}
      >
        <Typography
          variant="h1"
          sx={{
            fontSize: '6rem',
            fontWeight: 'bold',
            background: (theme) =>
              theme.palette.mode === 'dark'
                ? 'linear-gradient(45deg, #60a5fa, #a78bfa)'
                : 'linear-gradient(45deg, #3b82f6, #8b5cf6)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          404
        </Typography>
        
        <Typography variant="h4" component="h1" gutterBottom>
          Page Not Found
        </Typography>
        
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          The page you're looking for doesn't exist or has been moved.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            component={Link}
            href="/"
            variant="contained"
            startIcon={<Home />}
          >
            Go Home
          </Button>
          <Button
            onClick={() => window.history.back()}
            variant="outlined"
            startIcon={<ArrowBack />}
          >
            Go Back
          </Button>
        </Box>
      </Box>
    </Container>
  );
}