'use client';

import { Box, CircularProgress, Typography, LinearProgress } from '@mui/material';

interface LoadingScreenProps {
  message?: string;
  progress?: number;
  fullScreen?: boolean;
}

export function LoadingScreen({ 
  message = 'Loading...', 
  progress,
  fullScreen = true 
}: LoadingScreenProps) {
  const containerSx = fullScreen 
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        zIndex: 9999,
      }
    : {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        width: '100%',
      };

  return (
    <Box sx={containerSx}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          maxWidth: 300,
          textAlign: 'center',
        }}
      >
        {/* Loading Spinner */}
        <CircularProgress 
          size={48} 
          thickness={4}
          sx={{ color: 'primary.main' }}
        />

        {/* Loading Message */}
        <Typography 
          variant="body1" 
          color="text.secondary"
          sx={{ fontWeight: 'medium' }}
        >
          {message}
        </Typography>

        {/* Progress Bar (if progress is provided) */}
        {typeof progress === 'number' && (
          <Box sx={{ width: '100%' }}>
            <LinearProgress 
              variant="determinate" 
              value={progress}
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: 'action.hover',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 3,
                },
              }}
            />
            <Typography 
              variant="caption" 
              color="text.secondary"
              sx={{ mt: 1, display: 'block' }}
            >
              {Math.round(progress)}%
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default LoadingScreen;