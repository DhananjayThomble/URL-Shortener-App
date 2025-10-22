'use client';

import { forwardRef } from 'react';
import { Skeleton as MuiSkeleton, SkeletonProps as MuiSkeletonProps, Box, Stack } from '@mui/material';
import { styled } from '@mui/material/styles';
import { tokens } from '@/lib/theme/tokens';

export type SkeletonVariant = 'text' | 'rectangular' | 'rounded' | 'circular';
export type SkeletonAnimation = 'pulse' | 'wave' | false;

export interface SkeletonProps extends Omit<MuiSkeletonProps, 'variant' | 'animation'> {
  variant?: SkeletonVariant;
  animation?: SkeletonAnimation;
  lines?: number;
  avatar?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}

// Styled Skeleton with enhanced animations
const StyledSkeleton = styled(MuiSkeleton)(({ theme }) => ({
  borderRadius: tokens.borderRadius.sm,
  
  '&.MuiSkeleton-pulse': {
    animation: 'skeleton-pulse 1.5s ease-in-out 0.5s infinite',
  },
  
  '&.MuiSkeleton-wave': {
    '&::after': {
      background: `linear-gradient(90deg, transparent, ${theme.palette.action.hover}, transparent)`,
    },
  },

  '@keyframes skeleton-pulse': {
    '0%': {
      opacity: 1,
    },
    '50%': {
      opacity: 0.4,
    },
    '100%': {
      opacity: 1,
    },
  },
}));

// Predefined skeleton layouts
export const SkeletonText = forwardRef<HTMLSpanElement, Omit<SkeletonProps, 'variant'> & { lines?: number }>(
  ({ lines = 1, width, height = 20, ...props }, ref) => {
    if (lines === 1) {
      return (
        <StyledSkeleton
          ref={ref}
          variant="text"
          width={width}
          height={height}
          {...props}
        />
      );
    }

    return (
      <Stack spacing={0.5}>
        {Array.from({ length: lines }).map((_, index) => (
          <StyledSkeleton
            key={index}
            variant="text"
            width={index === lines - 1 ? '60%' : width}
            height={height}
            {...props}
          />
        ))}
      </Stack>
    );
  }
);

export const SkeletonCard = forwardRef<HTMLDivElement, Omit<SkeletonProps, 'variant'> & { 
  avatar?: boolean;
  lines?: number;
}>(
  ({ avatar = false, lines = 3, animation = 'pulse', ...props }, ref) => {
    return (
      <Box ref={ref} sx={{ p: 2 }}>
        {/* Header with optional avatar */}
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          {avatar && (
            <StyledSkeleton
              variant="circular"
              width={40}
              height={40}
              animation={animation}
            />
          )}
          <Box flex={1}>
            <StyledSkeleton
              variant="text"
              width="60%"
              height={24}
              animation={animation}
            />
            <StyledSkeleton
              variant="text"
              width="40%"
              height={16}
              animation={animation}
              sx={{ mt: 0.5 }}
            />
          </Box>
        </Box>

        {/* Image placeholder */}
        <StyledSkeleton
          variant="rectangular"
          width="100%"
          height={200}
          animation={animation}
          sx={{ mb: 2 }}
        />

        {/* Text lines */}
        <Stack spacing={0.5}>
          {Array.from({ length: lines }).map((_, index) => (
            <StyledSkeleton
              key={index}
              variant="text"
              width={index === lines - 1 ? '70%' : '100%'}
              height={16}
              animation={animation}
            />
          ))}
        </Stack>

        {/* Action buttons */}
        <Box display="flex" gap={1} mt={2}>
          <StyledSkeleton
            variant="rectangular"
            width={80}
            height={32}
            animation={animation}
          />
          <StyledSkeleton
            variant="rectangular"
            width={80}
            height={32}
            animation={animation}
          />
        </Box>
      </Box>
    );
  }
);

export const SkeletonList = forwardRef<HTMLDivElement, Omit<SkeletonProps, 'variant'> & { 
  items?: number;
  avatar?: boolean;
}>(
  ({ items = 5, avatar = true, animation = 'pulse', ...props }, ref) => {
    return (
      <Stack ref={ref} spacing={2}>
        {Array.from({ length: items }).map((_, index) => (
          <Box key={index} display="flex" alignItems="center" gap={2}>
            {avatar && (
              <StyledSkeleton
                variant="circular"
                width={40}
                height={40}
                animation={animation}
              />
            )}
            <Box flex={1}>
              <StyledSkeleton
                variant="text"
                width="80%"
                height={20}
                animation={animation}
              />
              <StyledSkeleton
                variant="text"
                width="60%"
                height={16}
                animation={animation}
                sx={{ mt: 0.5 }}
              />
            </Box>
            <StyledSkeleton
              variant="rectangular"
              width={60}
              height={24}
              animation={animation}
            />
          </Box>
        ))}
      </Stack>
    );
  }
);

export const SkeletonTable = forwardRef<HTMLDivElement, Omit<SkeletonProps, 'variant'> & { 
  rows?: number;
  columns?: number;
}>(
  ({ rows = 5, columns = 4, animation = 'pulse', ...props }, ref) => {
    return (
      <Box ref={ref}>
        {/* Table header */}
        <Box display="flex" gap={2} mb={2} pb={1} borderBottom="1px solid" borderColor="divider">
          {Array.from({ length: columns }).map((_, index) => (
            <Box key={index} flex={1}>
              <StyledSkeleton
                variant="text"
                width="70%"
                height={20}
                animation={animation}
              />
            </Box>
          ))}
        </Box>

        {/* Table rows */}
        <Stack spacing={1}>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <Box key={rowIndex} display="flex" gap={2} py={1}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <Box key={colIndex} flex={1}>
                  <StyledSkeleton
                    variant="text"
                    width={colIndex === 0 ? '90%' : '60%'}
                    height={16}
                    animation={animation}
                  />
                </Box>
              ))}
            </Box>
          ))}
        </Stack>
      </Box>
    );
  }
);

export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(
  (
    {
      variant = 'text',
      animation = 'pulse',
      lines,
      avatar,
      loading = true,
      children,
      ...props
    },
    ref
  ) => {
    // If not loading, render children
    if (!loading && children) {
      return <>{children}</>;
    }

    // Handle multi-line text skeletons
    if (variant === 'text' && lines && lines > 1) {
      return <SkeletonText ref={ref} lines={lines} animation={animation} {...props} />;
    }

    return (
      <StyledSkeleton
        ref={ref}
        variant={variant}
        animation={animation}
        {...props}
      />
    );
  }
);

Skeleton.displayName = 'Skeleton';
SkeletonText.displayName = 'SkeletonText';
SkeletonCard.displayName = 'SkeletonCard';
SkeletonList.displayName = 'SkeletonList';
SkeletonTable.displayName = 'SkeletonTable';

export default Skeleton;