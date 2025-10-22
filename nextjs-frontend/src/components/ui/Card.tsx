'use client';

import { forwardRef } from 'react';
import {
  Card as MuiCard,
  CardProps as MuiCardProps,
  CardContent,
  CardHeader,
  CardActions,
  Typography,
  IconButton,
  Skeleton,
  Box,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { MoreVert } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type CardVariant = 'elevated' | 'outlined' | 'filled';
export type CardSize = 'small' | 'medium' | 'large';

export interface CardProps extends Omit<MuiCardProps, 'variant' | 'title'> {
  variant?: CardVariant;
  size?: CardSize;
  loading?: boolean;
  hoverable?: boolean;
  clickable?: boolean;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  actions?: React.ReactNode;
  image?: string;
  imageAlt?: string;
  imageHeight?: number;
  footer?: React.ReactNode;
}

// Styled Card with custom variants
const StyledCard = styled(MuiCard, {
  shouldForwardProp: (prop) => !['hoverable', 'clickable', 'cardSize', 'customVariant'].includes(prop as string),
})<{ hoverable?: boolean; clickable?: boolean; cardSize?: CardSize; customVariant?: CardVariant }>(
  ({ theme, hoverable, clickable, cardSize, customVariant }) => ({
    borderRadius: tokens.borderRadius.xl,
    transition: 'all 0.2s ease-in-out',
    position: 'relative',
    overflow: 'hidden',

    // Size variants
    ...(cardSize === 'small' && {
      '& .MuiCardContent-root': {
        padding: tokens.components.card.padding.sm,
        '&:last-child': {
          paddingBottom: tokens.components.card.padding.sm,
        },
      },
    }),
    ...(cardSize === 'medium' && {
      '& .MuiCardContent-root': {
        padding: tokens.components.card.padding.md,
        '&:last-child': {
          paddingBottom: tokens.components.card.padding.md,
        },
      },
    }),
    ...(cardSize === 'large' && {
      '& .MuiCardContent-root': {
        padding: tokens.components.card.padding.lg,
        '&:last-child': {
          paddingBottom: tokens.components.card.padding.lg,
        },
      },
    }),

    // Variant styles
    ...(customVariant === 'elevated' && {
      boxShadow: tokens.shadows.md,
      border: 'none',
    }),
    ...(customVariant === 'outlined' && {
      boxShadow: 'none',
      border: `1px solid ${theme.palette.divider}`,
    }),
    ...(customVariant === 'filled' && {
      boxShadow: 'none',
      backgroundColor: theme.palette.action.hover,
      border: 'none',
    }),

    // Interactive states
    ...(hoverable && {
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: tokens.shadows.lg,
      },
    }),
    
    ...(clickable && {
      cursor: 'pointer',
      '&:hover': {
        transform: 'translateY(-1px)',
        boxShadow: tokens.shadows.lg,
      },
      '&:active': {
        transform: 'translateY(0)',
        boxShadow: tokens.shadows.md,
      },
    }),

    // Focus styles for clickable cards
    ...(clickable && {
      '&:focus-visible': {
        outline: `2px solid ${theme.palette.primary.main}`,
        outlineOffset: '2px',
      },
    }),
  })
);

// Card image component
const CardImage = styled('img')(({ theme }) => ({
  width: '100%',
  height: 'auto',
  display: 'block',
  objectFit: 'cover',
}));

// Loading skeleton component
const CardSkeleton: React.FC<{ size?: CardSize }> = ({ size = 'medium' }) => {
  const padding = size === 'small' ? 2 : size === 'large' ? 4 : 3;
  
  return (
    <Box sx={{ p: padding }}>
      <Skeleton variant="text" width="60%" height={32} sx={{ mb: 1 }} />
      <Skeleton variant="text" width="40%" height={20} sx={{ mb: 2 }} />
      <Skeleton variant="rectangular" width="100%" height={120} sx={{ mb: 2 }} />
      <Skeleton variant="text" width="100%" height={16} />
      <Skeleton variant="text" width="80%" height={16} />
      <Skeleton variant="text" width="90%" height={16} />
    </Box>
  );
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  (
    {
      variant = 'elevated',
      size = 'medium',
      loading = false,
      hoverable = false,
      clickable = false,
      title,
      subtitle,
      headerAction,
      actions,
      image,
      imageAlt,
      imageHeight = 200,
      footer,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    // Handle click for clickable cards
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (clickable && onClick) {
        onClick(event);
      }
    };

    // Handle keyboard interaction for clickable cards
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (clickable && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onClick?.(event as any);
      }
    };

    return (
      <StyledCard
        ref={ref}
        variant={variant === 'outlined' ? 'outlined' : 'elevation'}
        cardSize={size}
        hoverable={hoverable}
        clickable={clickable}
        customVariant={variant}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'button' : undefined}
        {...props}
      >
        {loading ? (
          <CardSkeleton size={size} />
        ) : (
          <>
            {/* Card Image */}
            {image && (
              <CardImage
                src={image}
                alt={imageAlt || ''}
                style={{ height: imageHeight }}
              />
            )}

            {/* Card Header */}
            {(title || subtitle || headerAction) && (
              <CardHeader
                title={
                  typeof title === 'string' ? (
                    <Typography variant="h6" component="h3">
                      {title}
                    </Typography>
                  ) : (
                    title
                  )
                }
                subheader={
                  typeof subtitle === 'string' ? (
                    <Typography variant="body2" color="text.secondary">
                      {subtitle}
                    </Typography>
                  ) : (
                    subtitle
                  )
                }
                action={
                  headerAction || (
                    <IconButton size="small">
                      <MoreVert />
                    </IconButton>
                  )
                }
                sx={{
                  pb: children ? 1 : 2,
                }}
              />
            )}

            {/* Card Content */}
            {children && (
              <CardContent sx={{ pt: title || subtitle ? 0 : undefined }}>
                {children}
              </CardContent>
            )}

            {/* Card Actions */}
            {actions && (
              <CardActions sx={{ px: size === 'small' ? 2 : size === 'large' ? 4 : 3 }}>
                {actions}
              </CardActions>
            )}

            {/* Card Footer */}
            {footer && (
              <Box
                sx={{
                  px: size === 'small' ? 2 : size === 'large' ? 4 : 3,
                  pb: size === 'small' ? 2 : size === 'large' ? 4 : 3,
                  pt: 1,
                  borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                  backgroundColor: (theme) => theme.palette.action.hover,
                }}
              >
                {footer}
              </Box>
            )}
          </>
        )}
      </StyledCard>
    );
  }
);

Card.displayName = 'Card';

export default Card;