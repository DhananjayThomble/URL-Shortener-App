'use client';

import { forwardRef, useState } from 'react';
import { Avatar as MuiAvatar, AvatarProps as MuiAvatarProps, Badge, Box } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Person } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type AvatarSize = 'small' | 'medium' | 'large' | 'xlarge';
export type AvatarVariant = 'circular' | 'rounded' | 'square';
export type AvatarStatus = 'online' | 'offline' | 'away' | 'busy';

export interface AvatarProps extends Omit<MuiAvatarProps, 'variant'> {
  size?: AvatarSize;
  variant?: AvatarVariant;
  name?: string;
  src?: string;
  status?: AvatarStatus;
  showStatus?: boolean;
  fallbackIcon?: React.ReactNode;
  loading?: boolean;
  clickable?: boolean;
  bordered?: boolean;
}

// Styled Avatar with custom variants
const StyledAvatar = styled(MuiAvatar, {
  shouldForwardProp: (prop) => !['avatarSize', 'clickable', 'bordered', 'loading'].includes(prop as string),
})<{ 
  avatarSize?: AvatarSize; 
  clickable?: boolean;
  bordered?: boolean;
  loading?: boolean;
}>(({ theme, avatarSize, clickable, bordered, loading }) => ({
  fontWeight: tokens.typography.fontWeight.medium,
  transition: 'all 0.2s ease-in-out',
  
  // Size variants
  ...(avatarSize === 'small' && {
    width: 32,
    height: 32,
    fontSize: tokens.typography.fontSize.sm[0],
  }),
  ...(avatarSize === 'medium' && {
    width: 40,
    height: 40,
    fontSize: tokens.typography.fontSize.base[0],
  }),
  ...(avatarSize === 'large' && {
    width: 56,
    height: 56,
    fontSize: tokens.typography.fontSize.lg[0],
  }),
  ...(avatarSize === 'xlarge' && {
    width: 80,
    height: 80,
    fontSize: tokens.typography.fontSize.xl[0],
  }),

  // Bordered variant
  ...(bordered && {
    border: `2px solid ${theme.palette.background.paper}`,
    boxShadow: `0 0 0 1px ${theme.palette.divider}`,
  }),

  // Clickable variant
  ...(clickable && {
    cursor: 'pointer',
    '&:hover': {
      transform: 'scale(1.05)',
      boxShadow: tokens.shadows.md,
    },
    '&:active': {
      transform: 'scale(0.98)',
    },
  }),

  // Loading state
  ...(loading && {
    backgroundColor: theme.palette.action.hover,
    animation: 'avatar-pulse 1.5s ease-in-out infinite',
    '@keyframes avatar-pulse': {
      '0%': { opacity: 1 },
      '50%': { opacity: 0.5 },
      '100%': { opacity: 1 },
    },
  }),

  // Focus styles for clickable avatars
  ...(clickable && {
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  }),
}));

// Status badge component
const StatusBadge = styled(Badge, {
  shouldForwardProp: (prop) => !['status', 'avatarSize'].includes(prop as string),
})<{ status?: AvatarStatus; avatarSize?: AvatarSize }>(({ theme, status, avatarSize }) => {
  const getStatusColor = () => {
    switch (status) {
      case 'online':
        return theme.palette.success.main;
      case 'away':
        return theme.palette.warning.main;
      case 'busy':
        return theme.palette.error.main;
      case 'offline':
      default:
        return theme.palette.grey[400];
    }
  };

  const getBadgeSize = () => {
    switch (avatarSize) {
      case 'small':
        return 8;
      case 'medium':
        return 10;
      case 'large':
        return 12;
      case 'xlarge':
        return 16;
      default:
        return 10;
    }
  };

  return {
    '& .MuiBadge-badge': {
      backgroundColor: getStatusColor(),
      color: getStatusColor(),
      width: getBadgeSize(),
      height: getBadgeSize(),
      borderRadius: '50%',
      border: `2px solid ${theme.palette.background.paper}`,
      '&::after': {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        animation: status === 'online' ? 'ripple 1.2s infinite ease-in-out' : 'none',
        border: '1px solid currentColor',
        content: '""',
      },
    },
    '@keyframes ripple': {
      '0%': {
        transform: 'scale(.8)',
        opacity: 1,
      },
      '100%': {
        transform: 'scale(2.4)',
        opacity: 0,
      },
    },
  };
});

// Generate initials from name
const generateInitials = (name: string): string => {
  return name
    .split(' ')
    .map(part => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
};

// Generate background color from name
const generateColorFromName = (name: string): string => {
  const colors = [
    '#f44336', '#e91e63', '#9c27b0', '#673ab7',
    '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4',
    '#009688', '#4caf50', '#8bc34a', '#cddc39',
    '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
};

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  (
    {
      size = 'medium',
      variant = 'circular',
      name,
      src,
      status,
      showStatus = false,
      fallbackIcon = <Person />,
      loading = false,
      clickable = false,
      bordered = false,
      children,
      onClick,
      ...props
    },
    ref
  ) => {
    const [imageError, setImageError] = useState(false);

    // Handle image load error
    const handleImageError = () => {
      setImageError(true);
    };

    // Handle click for clickable avatars
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (clickable && onClick) {
        onClick(event);
      }
    };

    // Handle keyboard interaction for clickable avatars
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (clickable && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onClick?.(event as any);
      }
    };

    // Determine what to display in avatar
    const getAvatarContent = () => {
      if (loading) {
        return null;
      }
      
      if (children) {
        return children;
      }
      
      if (src && !imageError) {
        return null; // Let MUI Avatar handle the image
      }
      
      if (name) {
        return generateInitials(name);
      }
      
      return fallbackIcon;
    };

    // Get background color for text avatars
    const getBackgroundColor = () => {
      if (src && !imageError) return undefined;
      if (name) return generateColorFromName(name);
      return undefined;
    };

    const avatarElement = (
      <StyledAvatar
        ref={ref}
        variant={variant}
        src={imageError ? undefined : src}
        avatarSize={size}
        clickable={clickable}
        bordered={bordered}
        loading={loading}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'button' : undefined}
        onError={handleImageError}
        sx={{
          backgroundColor: getBackgroundColor(),
          ...props.sx,
        }}
        {...props}
      >
        {getAvatarContent()}
      </StyledAvatar>
    );

    // Wrap with status badge if needed
    if (showStatus && status) {
      return (
        <StatusBadge
          overlap="circular"
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          variant="dot"
          status={status}
          avatarSize={size}
        >
          {avatarElement}
        </StatusBadge>
      );
    }

    return avatarElement;
  }
);

Avatar.displayName = 'Avatar';

export default Avatar;