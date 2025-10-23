'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Chip,
  IconButton,
  Tooltip,
  Button,
  Stack,
  Divider,
  Badge,
} from '@mui/material';
import {
  Add,
  Visibility,
  Edit,
  Delete,
  Share,
  QrCode,
  TrendingUp,
  Schedule,
  Refresh,
  MoreVert,
  Link as LinkIcon,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import type { RecentActivity } from '@/types/analytics';

interface RecentActivityFeedProps {
  activities?: RecentActivity[];
  maxItems?: number;
  showHeader?: boolean;
  onRefresh?: () => void;
  onViewAll?: () => void;
  className?: string;
}

const getActivityIcon = (type: RecentActivity['type']) => {
  switch (type) {
    case 'url_created':
      return <Add />;
    case 'url_clicked':
      return <Visibility />;
    case 'url_updated':
      return <Edit />;
    case 'url_deleted':
      return <Delete />;
    default:
      return <LinkIcon />;
  }
};

const getActivityColor = (type: RecentActivity['type']) => {
  switch (type) {
    case 'url_created':
      return 'success';
    case 'url_clicked':
      return 'primary';
    case 'url_updated':
      return 'warning';
    case 'url_deleted':
      return 'error';
    default:
      return 'default';
  }
};

const getActivityTitle = (activity: RecentActivity) => {
  switch (activity.type) {
    case 'url_created':
      return 'New URL Created';
    case 'url_clicked':
      return 'URL Clicked';
    case 'url_updated':
      return 'URL Updated';
    case 'url_deleted':
      return 'URL Deleted';
    default:
      return 'Activity';
  }
};

// Mock data for demonstration
const mockActivities: RecentActivity[] = [
  {
    id: '1',
    type: 'url_created',
    description: 'Created short URL for "My Portfolio Website"',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
    metadata: { shortCode: 'abc123', originalUrl: 'https://myportfolio.com' }
  },
  {
    id: '2',
    type: 'url_clicked',
    description: 'URL "abc123" received 15 new clicks',
    timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    metadata: { shortCode: 'abc123', clickCount: 15 }
  },
  {
    id: '3',
    type: 'url_updated',
    description: 'Updated category for "Product Launch Page"',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    metadata: { shortCode: 'xyz789', category: 'Marketing' }
  },
  {
    id: '4',
    type: 'url_created',
    description: 'Created short URL for "Blog Post - React Tips"',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
    metadata: { shortCode: 'def456', originalUrl: 'https://blog.example.com/react-tips' }
  },
  {
    id: '5',
    type: 'url_clicked',
    description: 'URL "def456" reached 100 clicks milestone',
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6 hours ago
    metadata: { shortCode: 'def456', milestone: 100 }
  },
];

export const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({
  activities = mockActivities,
  maxItems = 10,
  showHeader = true,
  onRefresh,
  onViewAll,
  className,
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  const safeActivities = activities || mockActivities;
  const displayActivities = safeActivities.slice(0, maxItems);
  const hasMoreActivities = safeActivities.length > maxItems;

  return (
    <Card className={className}>
      <CardContent sx={{ p: 0 }}>
        {/* Header */}
        {showHeader && (
          <Box sx={{ p: 3, pb: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="h6" component="h3" fontWeight="bold">
                  Recent Activity
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Latest updates on your URLs
                </Typography>
              </Box>
              
              <Stack direction="row" spacing={1}>
                {onRefresh && (
                  <Tooltip title="Refresh">
                    <IconButton 
                      size="small" 
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                    >
                      <Refresh />
                    </IconButton>
                  </Tooltip>
                )}
                
                {onViewAll && (
                  <Button size="small" onClick={onViewAll}>
                    View All
                  </Button>
                )}
              </Stack>
            </Box>
          </Box>
        )}

        {/* Activity List */}
        {displayActivities.length > 0 ? (
          <List sx={{ pt: showHeader ? 2 : 0 }}>
            {displayActivities.map((activity, index) => (
              <React.Fragment key={activity.id}>
                <ListItem
                  sx={{
                    px: 3,
                    py: 2,
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      sx={{
                        bgcolor: `${getActivityColor(activity.type)}.main`,
                        width: 40,
                        height: 40,
                      }}
                    >
                      {getActivityIcon(activity.type)}
                    </Avatar>
                  </ListItemAvatar>
                  
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography variant="body2" fontWeight="medium">
                          {getActivityTitle(activity)}
                        </Typography>
                        
                        {activity.metadata?.milestone && (
                          <Chip
                            label={`${activity.metadata.milestone} clicks`}
                            size="small"
                            color="success"
                            icon={<TrendingUp />}
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          {activity.description}
                        </Typography>
                        
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Schedule sx={{ fontSize: 14 }} />
                          <Typography variant="caption" color="text.secondary">
                            {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                          </Typography>
                          
                          {activity.metadata?.shortCode && (
                            <Chip
                              label={activity.metadata.shortCode}
                              size="small"
                              variant="outlined"
                              sx={{ ml: 1, height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Box>
                      </Box>
                    }
                  />
                  
                  <IconButton size="small" sx={{ alignSelf: 'flex-start' }}>
                    <MoreVert />
                  </IconButton>
                </ListItem>
                
                {index < displayActivities.length - 1 && (
                  <Divider variant="inset" component="li" />
                )}
              </React.Fragment>
            ))}
          </List>
        ) : (
          <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
            <LinkIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No Recent Activity
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Start creating and managing URLs to see activity here
            </Typography>
          </Box>
        )}

        {/* View More */}
        {hasMoreActivities && (
          <Box sx={{ p: 2, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
            <Button onClick={onViewAll} size="small">
              View {safeActivities.length - maxItems} More Activities
            </Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
};