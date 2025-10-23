'use client';

import { useState, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Box,
  IconButton,
  Button,
  Chip,
  Stack,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Avatar,
  Checkbox,
  Collapse,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  MoreVert,
  ContentCopy,
  Edit,
  Delete,
  Analytics,
  QrCode,
  Share,
  Visibility,
  VisibilityOff,
  Link as LinkIcon,
  TrendingUp,
  Schedule,
  Category,
  OpenInNew,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import { useUrls } from '@/hooks/useUrls';
import { QRCodePreview } from '@/components/qr';
import type { URLData } from '@/types';

interface UrlCardProps {
  url: URLData;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onEdit?: (url: URLData) => void;
  onAnalytics?: (url: URLData) => void;
  showSelection?: boolean;
  compact?: boolean;
}

export function UrlCard({
  url,
  selected = false,
  onSelect,
  onEdit,
  onAnalytics,
  showSelection = false,
  compact = false,
}: UrlCardProps) {
  const { deleteUrl, updateUrl, isDeleting, isUpdating } = useUrls();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);

  const menuOpen = Boolean(anchorEl);
  const shortUrl = `${window.location.origin}/${url.shortCode}`;

  // Handle menu
  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  // Handle copy URL
  const handleCopy = useCallback(async (event?: React.MouseEvent) => {
    event?.stopPropagation();
    
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  }, [shortUrl]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (window.confirm('Are you sure you want to delete this URL?')) {
      try {
        await deleteUrl(url.id);
      } catch (error) {
        console.error('Failed to delete URL:', error);
      }
    }
    handleMenuClose();
  }, [deleteUrl, url.id]);

  // Handle toggle active status
  const handleToggleActive = useCallback(async () => {
    setIsToggling(true);
    try {
      await updateUrl(url.id, { isActive: !url.isActive });
    } catch (error) {
      console.error('Failed to toggle URL status:', error);
    } finally {
      setIsToggling(false);
    }
    handleMenuClose();
  }, [updateUrl, url.id, url.isActive]);

  // Handle edit
  const handleEdit = () => {
    onEdit?.(url);
    handleMenuClose();
  };

  // Handle analytics
  const handleAnalytics = () => {
    onAnalytics?.(url);
    handleMenuClose();
  };

  // Handle selection
  const handleSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    onSelect?.(url.id);
  };

  // Handle card click
  const handleCardClick = () => {
    if (showSelection) {
      onSelect?.(url.id);
    } else {
      setShowDetails(!showDetails);
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get domain from URL
  const getDomain = (urlString: string) => {
    try {
      return new URL(urlString).hostname;
    } catch {
      return urlString;
    }
  };

  // Get favicon URL
  const getFaviconUrl = (urlString: string) => {
    try {
      const domain = new URL(urlString).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return null;
    }
  };

  return (
    <Card
      sx={{
        cursor: showSelection ? 'pointer' : 'default',
        transition: 'all 0.2s ease-in-out',
        border: selected ? 2 : 1,
        borderColor: selected ? 'primary.main' : 'divider',
        '&:hover': {
          boxShadow: 2,
          borderColor: selected ? 'primary.main' : 'primary.light',
        },
        opacity: url.isActive ? 1 : 0.7,
      }}
      onClick={handleCardClick}
    >
      <CardContent sx={{ pb: compact ? 1 : 2 }}>
        {/* Header */}
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" mb={2}>
          <Box display="flex" alignItems="center" gap={1} flex={1} minWidth={0}>
            {showSelection && (
              <Checkbox
                checked={selected}
                onChange={handleSelect}
                size="small"
                onClick={(e) => e.stopPropagation()}
              />
            )}

            {/* Favicon */}
            <Avatar
              src={getFaviconUrl(url.originalUrl) || undefined}
              sx={{ width: 24, height: 24 }}
            >
              <LinkIcon fontSize="small" />
            </Avatar>

            {/* URL Info */}
            <Box flex={1} minWidth={0}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {url.metadata?.title || getDomain(url.originalUrl)}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {getDomain(url.originalUrl)}
              </Typography>
            </Box>
          </Box>

          {/* Status & Menu */}
          <Box display="flex" alignItems="center" gap={1}>
            {!url.isActive && (
              <Chip
                label="Inactive"
                size="small"
                color="warning"
                variant="outlined"
              />
            )}

            <IconButton
              size="small"
              onClick={handleMenuOpen}
              disabled={isDeleting || isUpdating}
            >
              <MoreVert />
            </IconButton>
          </Box>
        </Box>

        {/* Short URL */}
        <Box
          sx={{
            p: 1.5,
            backgroundColor: 'action.hover',
            borderRadius: 1,
            mb: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              color: 'primary.main',
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {shortUrl}
          </Typography>

          <Tooltip title={copied ? 'Copied!' : 'Copy URL'}>
            <IconButton
              size="small"
              onClick={handleCopy}
              color={copied ? 'success' : 'default'}
            >
              <ContentCopy fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Stats */}
        <Stack direction="row" spacing={2} alignItems="center" mb={compact ? 0 : 2}>
          <Box display="flex" alignItems="center" gap={0.5}>
            <TrendingUp fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {url.visitCount} clicks
            </Typography>
          </Box>

          <Box display="flex" alignItems="center" gap={0.5}>
            <Schedule fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {formatDate(url.createdAt)}
            </Typography>
          </Box>

          {url.category && (
            <Chip
              label={url.category}
              size="small"
              variant="outlined"
              icon={<Category />}
            />
          )}
        </Stack>

        {/* Expandable Details */}
        {!compact && (
          <Box>
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setShowDetails(!showDetails);
              }}
              startIcon={showDetails ? <ExpandLess /> : <ExpandMore />}
            >
              {showDetails ? 'Hide' : 'Show'} Details
            </Button>

            <Collapse in={showDetails}>
              <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Original URL:
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    wordBreak: 'break-all',
                    mb: 2,
                    p: 1,
                    backgroundColor: 'background.paper',
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                  }}
                >
                  {url.originalUrl}
                </Typography>

                {url.metadata?.description && (
                  <Box mb={2}>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Description:
                    </Typography>
                    <Typography variant="body2">
                      {url.metadata.description}
                    </Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={1} flexWrap="wrap">
                  <Typography variant="caption" color="text.secondary">
                    ID: {url.id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Updated: {formatDate(url.updatedAt)}
                  </Typography>
                </Stack>
              </Box>
            </Collapse>
          </Box>
        )}
      </CardContent>

      {/* Quick Actions */}
      {!compact && (
        <CardActions sx={{ pt: 0, px: 2, pb: 2 }}>
          <Button
            size="small"
            startIcon={<Analytics />}
            onClick={(e) => {
              e.stopPropagation();
              handleAnalytics();
            }}
          >
            Analytics
          </Button>

          <Button
            size="small"
            startIcon={<Share />}
            onClick={(e) => {
              e.stopPropagation();
              if (navigator.share) {
                navigator.share({
                  title: url.metadata?.title || 'Shortened URL',
                  url: shortUrl,
                });
              }
            }}
          >
            Share
          </Button>

          <Button
            size="small"
            startIcon={<OpenInNew />}
            onClick={(e) => {
              e.stopPropagation();
              window.open(shortUrl, '_blank');
            }}
          >
            Visit
          </Button>
        </CardActions>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={handleCopy}>
          <ListItemIcon>
            <ContentCopy fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy URL</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleEdit}>
          <ListItemIcon>
            <Edit fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleAnalytics}>
          <ListItemIcon>
            <Analytics fontSize="small" />
          </ListItemIcon>
          <ListItemText>Analytics</ListItemText>
        </MenuItem>

        <MenuItem onClick={() => setShowQRCode(true)}>
          <ListItemIcon>
            <QrCode fontSize="small" />
          </ListItemIcon>
          <ListItemText>QR Code</ListItemText>
        </MenuItem>

        <MenuItem
          onClick={handleToggleActive}
          disabled={isToggling}
        >
          <ListItemIcon>
            {url.isActive ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            {url.isActive ? 'Deactivate' : 'Activate'}
          </ListItemText>
        </MenuItem>

        <MenuItem
          onClick={handleDelete}
          disabled={isDeleting}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <Delete fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* QR Code Dialog */}
      <Dialog
        open={showQRCode}
        onClose={() => setShowQRCode(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          QR Code for {url.metadata?.title || getDomain(url.originalUrl)}
        </DialogTitle>
        <DialogContent>
          <QRCodePreview
            url={shortUrl}
            size={256}
            showLabel={false}
            showActions={false}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowQRCode(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

export default UrlCard;