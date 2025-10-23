'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Stack,
  Avatar,
  LinearProgress,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  Visibility,
  People,
  MoreVert,
  Analytics,
  ContentCopy,
  QrCode,
  Share,
  OpenInNew,
  Link as LinkIcon,
} from '@mui/icons-material';
import toast from 'react-hot-toast';
import type { URLData } from '@/types';

interface TopPerformingUrlsProps {
  urls?: URLData[];
  maxItems?: number;
  showHeader?: boolean;
  onViewAnalytics?: (url: URLData) => void;
  onViewAll?: () => void;
  className?: string;
}

interface UrlPerformanceData extends URLData {
  trend: number; // Percentage change
  uniqueVisitors: number;
  conversionRate: number;
  avgSessionDuration: number;
}

// Mock data for demonstration
const mockTopUrls: UrlPerformanceData[] = [
  {
    id: '1',
    userId: 'user1',
    shortCode: 'abc123',
    originalUrl: 'https://myportfolio.com/projects',
    visitCount: 1250,
    uniqueVisitors: 980,
    trend: 15.2,
    conversionRate: 78.4,
    avgSessionDuration: 145,
    isActive: true,
    category: 'Portfolio',
    metadata: {
      title: 'My Portfolio - Projects',
      description: 'Showcase of my latest projects and work',
      favicon: 'https://myportfolio.com/favicon.ico'
    },
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-15T14:30:00Z',
  },
  {
    id: '2',
    userId: 'user1',
    shortCode: 'xyz789',
    originalUrl: 'https://blog.example.com/react-performance',
    visitCount: 890,
    uniqueVisitors: 720,
    trend: -5.8,
    conversionRate: 80.9,
    avgSessionDuration: 220,
    isActive: true,
    category: 'Blog',
    metadata: {
      title: 'React Performance Tips',
      description: 'Advanced techniques for optimizing React applications',
    },
    createdAt: '2024-01-08T15:20:00Z',
    updatedAt: '2024-01-14T09:15:00Z',
  },
  {
    id: '3',
    userId: 'user1',
    shortCode: 'def456',
    originalUrl: 'https://shop.example.com/sale',
    visitCount: 675,
    uniqueVisitors: 540,
    trend: 28.7,
    conversionRate: 80.0,
    avgSessionDuration: 95,
    isActive: true,
    category: 'E-commerce',
    metadata: {
      title: 'Summer Sale - Up to 50% Off',
      description: 'Limited time offer on all summer items',
    },
    createdAt: '2024-01-12T08:45:00Z',
    updatedAt: '2024-01-15T16:20:00Z',
  },
];

export const TopPerformingUrls: React.FC<TopPerformingUrlsProps> = ({
  urls = mockTopUrls,
  maxItems = 5,
  showHeader = true,
  onViewAnalytics,
  onViewAll,
  className,
}) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedUrl, setSelectedUrl] = useState<UrlPerformanceData | null>(null);

  const displayUrls = urls.slice(0, maxItems);
  const hasMoreUrls = urls.length > maxItems;

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, url: UrlPerformanceData) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedUrl(url);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedUrl(null);
  };

  const handleCopyUrl = async (url: UrlPerformanceData) => {
    const shortUrl = `${window.location.origin}/${url.shortCode}`;
    try {
      await navigator.clipboard.writeText(shortUrl);
      toast.success('URL copied to clipboard');
    } catch (error) {
      toast.error('Failed to copy URL');
    }
    handleMenuClose();
  };

  const handleViewAnalytics = (url: UrlPerformanceData) => {
    onViewAnalytics?.(url);
    handleMenuClose();
  };

  const getDomain = (urlString: string) => {
    try {
      return new URL(urlString).hostname;
    } catch {
      return urlString;
    }
  };

  const getFaviconUrl = (urlString: string) => {
    try {
      const domain = new URL(urlString).hostname;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
      return null;
    }
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <Card className={className}>
      <CardContent sx={{ p: 0 }}>
        {/* Header */}
        {showHeader && (
          <Box sx={{ p: 3, pb: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="h6" component="h3" fontWeight="bold">
                  Top Performing URLs
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Your most successful links this month
                </Typography>
              </Box>
              
              {onViewAll && (
                <Button size="small" onClick={onViewAll}>
                  View All
                </Button>
              )}
            </Box>
          </Box>
        )}

        {/* URLs Table */}
        {displayUrls.length > 0 ? (
          <TableContainer sx={{ mt: showHeader ? 2 : 0 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>URL</TableCell>
                  <TableCell align="right">Clicks</TableCell>
                  <TableCell align="right">Visitors</TableCell>
                  <TableCell align="right">Rate</TableCell>
                  <TableCell align="right">Trend</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displayUrls.map((url, index) => (
                  <TableRow
                    key={url.id}
                    sx={{
                      '&:hover': { bgcolor: 'action.hover' },
                      cursor: 'pointer',
                    }}
                    onClick={() => onViewAnalytics?.(url)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography
                            variant="h6"
                            sx={{
                              minWidth: 24,
                              height: 24,
                              borderRadius: '50%',
                              bgcolor: index < 3 ? 'primary.main' : 'action.disabled',
                              color: index < 3 ? 'primary.contrastText' : 'text.secondary',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.75rem',
                              fontWeight: 'bold',
                            }}
                          >
                            {index + 1}
                          </Typography>
                          
                          <Avatar
                            src={getFaviconUrl(url.originalUrl) || undefined}
                            sx={{ width: 24, height: 24 }}
                          >
                            <LinkIcon fontSize="small" />
                          </Avatar>
                        </Box>
                        
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography
                            variant="body2"
                            fontWeight="medium"
                            noWrap
                            sx={{ maxWidth: 200 }}
                          >
                            {url.metadata?.title || getDomain(url.originalUrl)}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            /{url.shortCode}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight="medium">
                        {url.visitCount.toLocaleString()}
                      </Typography>
                    </TableCell>
                    
                    <TableCell align="right">
                      <Typography variant="body2">
                        {url.uniqueVisitors.toLocaleString()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {url.conversionRate.toFixed(1)}%
                      </Typography>
                    </TableCell>
                    
                    <TableCell align="right">
                      <Typography variant="body2">
                        {formatDuration(url.avgSessionDuration)}
                      </Typography>
                    </TableCell>
                    
                    <TableCell align="right">
                      <Chip
                        label={`${url.trend >= 0 ? '+' : ''}${url.trend.toFixed(1)}%`}
                        size="small"
                        color={url.trend >= 0 ? 'success' : 'error'}
                        icon={url.trend >= 0 ? <TrendingUp /> : <TrendingDown />}
                        variant="outlined"
                      />
                    </TableCell>
                    
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(e, url)}
                      >
                        <MoreVert />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
            <TrendingUp sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Performance Data
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create URLs and get clicks to see performance metrics
            </Typography>
          </Box>
        )}

        {/* View More */}
        {hasMoreUrls && (
          <Box sx={{ p: 2, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
            <Button onClick={onViewAll} size="small">
              View {urls.length - maxItems} More URLs
            </Button>
          </Box>
        )}

        {/* Context Menu */}
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={() => selectedUrl && handleCopyUrl(selectedUrl)}>
            <ListItemIcon>
              <ContentCopy fontSize="small" />
            </ListItemIcon>
            <ListItemText>Copy URL</ListItemText>
          </MenuItem>
          
          <MenuItem onClick={() => selectedUrl && handleViewAnalytics(selectedUrl)}>
            <ListItemIcon>
              <Analytics fontSize="small" />
            </ListItemIcon>
            <ListItemText>View Analytics</ListItemText>
          </MenuItem>
          
          <MenuItem onClick={handleMenuClose}>
            <ListItemIcon>
              <QrCode fontSize="small" />
            </ListItemIcon>
            <ListItemText>QR Code</ListItemText>
          </MenuItem>
          
          <MenuItem onClick={handleMenuClose}>
            <ListItemIcon>
              <Share fontSize="small" />
            </ListItemIcon>
            <ListItemText>Share</ListItemText>
          </MenuItem>
          
          <MenuItem 
            onClick={() => {
              if (selectedUrl) {
                window.open(`${window.location.origin}/${selectedUrl.shortCode}`, '_blank');
              }
              handleMenuClose();
            }}
          >
            <ListItemIcon>
              <OpenInNew fontSize="small" />
            </ListItemIcon>
            <ListItemText>Visit URL</ListItemText>
          </MenuItem>
        </Menu>
      </CardContent>
    </Card>
  );
};