'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const { initialize, isLoading } = useAuthStore();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Initialize auth state from storage
        await initialize();
        setIsInitialized(true);
      } catch (error) {
        console.error('Auth initialization error:', error);
        setInitError('Failed to initialize authentication. Please refresh the page.');
        setIsInitialized(true); // Still allow the app to load
      }
    };

    initializeAuth();
  }, [initialize]);

  // Show loading screen while initializing
  if (!isInitialized) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        gap={2}
        sx={{
          background: (theme) => 
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)'
              : 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          Initializing SnapURL...
        </Typography>
      </Box>
    );
  }

  // Show error if initialization failed
  if (initError) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        minHeight="100vh"
        gap={2}
        sx={{ p: 3 }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          {initError}
        </Alert>
      </Box>
    );
  }

  return <>{children}</>;
}