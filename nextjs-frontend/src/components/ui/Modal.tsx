'use client';

import { forwardRef } from 'react';
import {
  Dialog,
  DialogProps,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Typography,
  Slide,
  Fade,
  Zoom,
  Box,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { TransitionProps } from '@mui/material/transitions';
import { styled } from '@mui/material/styles';
import { Close } from '@mui/icons-material';
import { tokens } from '@/lib/theme/tokens';

export type ModalSize = 'small' | 'medium' | 'large' | 'fullscreen';
export type ModalAnimation = 'fade' | 'slide' | 'zoom';

export interface ModalProps extends Omit<DialogProps, 'maxWidth' | 'fullWidth' | 'title'> {
  size?: ModalSize;
  animation?: ModalAnimation;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEscapeKey?: boolean;
  loading?: boolean;
  headerDivider?: boolean;
  footerDivider?: boolean;
  onClose?: () => void;
}

// Styled Dialog with custom sizing
const StyledDialog = styled(Dialog, {
  shouldForwardProp: (prop) => !['modalSize'].includes(prop as string),
})<{ modalSize?: ModalSize }>(({ theme, modalSize }) => ({
  '& .MuiDialog-paper': {
    borderRadius: tokens.borderRadius.xl,
    boxShadow: tokens.shadows.xl,
    margin: theme.spacing(2),
    
    // Size variants
    ...(modalSize === 'small' && {
      maxWidth: '400px',
      width: '100%',
    }),
    ...(modalSize === 'medium' && {
      maxWidth: '600px',
      width: '100%',
    }),
    ...(modalSize === 'large' && {
      maxWidth: '900px',
      width: '100%',
    }),
    ...(modalSize === 'fullscreen' && {
      maxWidth: 'none',
      width: '100vw',
      height: '100vh',
      margin: 0,
      borderRadius: 0,
    }),
  },
  
  '& .MuiBackdrop-root': {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
  },
}));

// Custom dialog title with close button
const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(3),
  paddingBottom: theme.spacing(2),
  
  '& .MuiTypography-root': {
    fontWeight: tokens.typography.fontWeight.semibold,
    fontSize: tokens.typography.fontSize.xl[0],
  },
}));

// Transition components
const SlideTransition = forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
  (props, ref) => <Slide direction="up" ref={ref} {...props} />
);
SlideTransition.displayName = 'SlideTransition';

const FadeTransition = forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
  (props, ref) => <Fade ref={ref} {...props} />
);
FadeTransition.displayName = 'FadeTransition';

const ZoomTransition = forwardRef<unknown, TransitionProps & { children: React.ReactElement }>(
  (props, ref) => <Zoom ref={ref} {...props} />
);
ZoomTransition.displayName = 'ZoomTransition';

export const Modal = forwardRef<HTMLDivElement, ModalProps>(
  (
    {
      size = 'medium',
      animation = 'fade',
      title,
      subtitle,
      actions,
      showCloseButton = true,
      closeOnBackdropClick = true,
      closeOnEscapeKey = true,
      loading = false,
      headerDivider = false,
      footerDivider = false,
      children,
      onClose,
      open,
      ...props
    },
    ref
  ) => {
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    
    // Adjust size for mobile
    const effectiveSize = isMobile && size !== 'fullscreen' ? 'small' : size;
    
    // Select transition component
    const getTransitionComponent = () => {
      switch (animation) {
        case 'slide':
          return SlideTransition;
        case 'zoom':
          return ZoomTransition;
        case 'fade':
        default:
          return FadeTransition;
      }
    };

    // Handle backdrop click
    const handleBackdropClick = (event: React.MouseEvent) => {
      if (closeOnBackdropClick && onClose) {
        onClose();
      }
    };

    // Handle escape key
    const handleKeyDown = (event: React.KeyboardEvent) => {
      if (closeOnEscapeKey && event.key === 'Escape' && onClose) {
        onClose();
      }
    };

    return (
      <StyledDialog
        ref={ref}
        open={open}
        onClose={onClose}
        modalSize={effectiveSize}
        TransitionComponent={getTransitionComponent()}
        transitionDuration={300}
        slotProps={{
          backdrop: {
            onClick: handleBackdropClick,
          },
        }}
        onKeyDown={handleKeyDown}
        disableEscapeKeyDown={!closeOnEscapeKey}
        fullScreen={effectiveSize === 'fullscreen'}
        {...props}
      >
        {/* Header */}
        {(title || subtitle || showCloseButton) && (
          <>
            <StyledDialogTitle>
              <Box>
                {title && (
                  <Typography variant="h6" component="h2">
                    {title}
                  </Typography>
                )}
                {subtitle && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {subtitle}
                  </Typography>
                )}
              </Box>
              
              {showCloseButton && (
                <IconButton
                  onClick={onClose}
                  size="small"
                  sx={{
                    color: 'text.secondary',
                    '&:hover': {
                      backgroundColor: 'action.hover',
                    },
                  }}
                >
                  <Close />
                </IconButton>
              )}
            </StyledDialogTitle>
            
            {headerDivider && (
              <Box
                sx={{
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  mx: 3,
                }}
              />
            )}
          </>
        )}

        {/* Content */}
        <DialogContent
          sx={{
            padding: theme.spacing(3),
            paddingTop: title || subtitle ? theme.spacing(2) : theme.spacing(3),
            paddingBottom: actions ? theme.spacing(2) : theme.spacing(3),
            minHeight: loading ? 200 : 'auto',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          {loading ? (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              minHeight={200}
            >
              <Typography variant="body2" color="text.secondary">
                Loading...
              </Typography>
            </Box>
          ) : (
            children
          )}
        </DialogContent>

        {/* Actions */}
        {actions && (
          <>
            {footerDivider && (
              <Box
                sx={{
                  borderTop: `1px solid ${theme.palette.divider}`,
                  mx: 3,
                }}
              />
            )}
            
            <DialogActions
              sx={{
                padding: theme.spacing(3),
                paddingTop: theme.spacing(2),
                gap: theme.spacing(1),
              }}
            >
              {actions}
            </DialogActions>
          </>
        )}
      </StyledDialog>
    );
  }
);

Modal.displayName = 'Modal';

export default Modal;