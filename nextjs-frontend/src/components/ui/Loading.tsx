'use client';

import { forwardRef } from 'react';
import {
  CircularProgress,
  LinearProgress,
  Box,
  Typography,
  Skeleton,
  Stack,
} from '@mui/material';
import { styled, keyframes } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export type LoadingVariant = 'circular' | 'linear' | 'dots' | 'pulse' | 'skeleton';
export type LoadingSize = 'small' | 'medium' | 'large';

export interface LoadingProps {
  variant?: LoadingVariant;
  size?: LoadingSize;
  message?: string;
  fullScreen?: boolean;
  overlay?: boolean;
  color?: 'primary' | 'secondary' | 'inherit';
  className?: string;
}

// Keyframe animations
const bounce = keyframes`
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
`;

const pulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.7;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

// Styled components
const LoadingContainer = styled(Box, {
  shouldForwardProp: (prop) => !['fullScreen', 'overlay'].includes(prop as string),
})<{ fullScreen?: boolean; overlay?: boolean }>(({ theme, fullScreen, overlay }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: theme.spacing(2),
  
  ...(fullScreen && {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: theme.zIndex.modal + 1,
    backgroundColor: overlay ? 'rgba(255, 255, 255, 0.8)' : 'transparent',
    backdropFilter: overlay ? 'blur(4px)' : 'none',
  }),
  
  ...(overlay && !fullScreen && {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    backdropFilter: 'blur(4px)',
    zIndex: 1,
  }),
}));

const DotsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5),
}));

const Dot = styled(Box, {
  shouldForwardProp: (prop) => !['delay', 'dotSize'].includes(prop as string),
})<{ delay: number; dotSize: number }>(({ theme, delay, dotSize }) => ({
  width: dotSize,
  height: dotSize,
  borderRadius: '50%',
  backgroundColor: theme.palette.primary.main,
  animation: `${bounce} 1.4s ease-in-out ${delay}s infinite both`,
}));

const PulseBox = styled(Box, {
  shouldForwardProp: (prop) => !['pulseSize'].includes(prop as string),
})<{ pulseSize: number }>(({ theme, pulseSize }) => ({
  width: pulseSize,
  height: pulseSize,
  borderRadius: '50%',
  backgroundColor: theme.palette.primary.main,
  animation: `${pulse} 1.5s ease-in-out infinite`,
}));

// Dots loading component
const DotsLoading: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const dotSize = size === 'small' ? 8 : size === 'large' ? 16 : 12;
  
  return (
    <DotsContainer>
      {[0, 1, 2].map((index) => (
        <Dot
          key={index}
          delay={index * 0.16}
          dotSize={dotSize}
        />
      ))}
    </DotsContainer>
  );
};

// Pulse loading component
const PulseLoading: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const pulseSize = size === 'small' ? 32 : size === 'large' ? 64 : 48;
  
  return <PulseBox pulseSize={pulseSize} />;
};

// Skeleton loading component
const SkeletonLoading: React.FC<{ size: LoadingSize }> = ({ size }) => {
  const height = size === 'small' ? 20 : size === 'large' ? 32 : 24;
  
  return (
    <Stack spacing={1} sx={{ width: '100%', maxWidth: 300 }}>
      <Skeleton variant="text" height={height} width="60%" />
      <Skeleton variant="text" height={height} width="80%" />
      <Skeleton variant="text" height={height} width="40%" />
      <Skeleton variant="rectangular" height={height * 4} />
      <Stack direction="row" spacing={1}>
        <Skeleton variant="circular" width={height * 2} height={height * 2} />
        <Stack spacing={0.5} sx={{ flex: 1 }}>
          <Skeleton variant="text" height={height * 0.8} width="70%" />
          <Skeleton variant="text" height={height * 0.8} width="50%" />
        </Stack>
      </Stack>
    </Stack>
  );
};

export const Loading = forwardRef<HTMLDivElement, LoadingProps>(
  (
    {
      variant = 'circular',
      size = 'medium',
      message,
      fullScreen = false,
      overlay = false,
      color = 'primary',
      className,
    },
    ref
  ) => {
    // Get size values
    const getCircularSize = () => {
      switch (size) {
        case 'small':
          return 24;
        case 'large':
          return 56;
        case 'medium':
        default:
          return 40;
      }
    };

    const getMessageVariant = () => {
      switch (size) {
        case 'small':
          return 'caption';
        case 'large':
          return 'h6';
        case 'medium':
        default:
          return 'body2';
      }
    };

    // Render loading content based on variant
    const renderLoadingContent = () => {
      switch (variant) {
        case 'linear':
          return (
            <Box sx={{ width: '100%', maxWidth: 300 }}>
              <LinearProgress color={color} />
            </Box>
          );
          
        case 'dots':
          return <DotsLoading size={size} />;
          
        case 'pulse':
          return <PulseLoading size={size} />;
          
        case 'skeleton':
          return <SkeletonLoading size={size} />;
          
        case 'circular':
        default:
          return (
            <CircularProgress
              size={getCircularSize()}
              color={color}
              thickness={4}
            />
          );
      }
    };

    return (
      <LoadingContainer
        ref={ref}
        fullScreen={fullScreen}
        overlay={overlay}
        className={className}
      >
        {renderLoadingContent()}
        
        {message && (
          <Typography
            variant={getMessageVariant() as any}
            color="text.secondary"
            textAlign="center"
          >
            {message}
          </Typography>
        )}
      </LoadingContainer>
    );
  }
);

Loading.displayName = 'Loading';

export default Loading;