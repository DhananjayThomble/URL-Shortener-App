'use client';

import { useEffect } from 'react';
import { Box, Typography, Button, Container, Alert } from '@mui/material';
import { Refresh, Home } from '@mui/icons-material';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('Application error:', error);
  }, [error]);

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
        <Typography variant="h4" component="h1" gutterBottom>
          Something went wrong!
        </Typography>
        
        <Alert severity="error" sx={{ width: '100%' }}>
          <Typography variant="body2">
            {error.message || 'An unexpected error occurred. Please try again.'}
          </Typography>
          {error.digest && (
            <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
              Error ID: {error.digest}
            </Typography>
          )}
        </Alert>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button
            variant="contained"
            onClick={reset}
            startIcon={<Refresh />}
          >
            Try Again
          </Button>
          <Button
            variant="outlined"
            onClick={() => window.location.href = '/'}
            startIcon={<Home />}
          >
            Go Home
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary">
          If this problem persists, please contact support.
        </Typography>
      </Box>
    </Container>
  );
}