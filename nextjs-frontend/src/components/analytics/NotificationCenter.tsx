'use client';

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  IconButton,
  Badge,
  Popover,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemSecondaryAction,
  Divider,
  Button,
  Chip,
  Avatar,
} from '@mui/material';
import {
  Notifications,
  NotificationsActive,
  Close,
  TrendingUp,
  People,
  Language,
  DevicesOther,
  Star,
  Celebration,
  Clear,
} from '@mui/icons-material';
import { formatDistanceToNow } from 'date-fns';
import type { MilestoneEvent } from '@/hooks/useRealTimeAnalytics';

interface NotificationCenterProps {
  notifications: MilestoneEvent[];
  onRemove: (notification: MilestoneEvent) => void;
  onClear: () => void;
  className?: string;
}

interface ExtendedMilestoneEvent extends MilestoneEvent {
  id: string;
  timestamp: Date;
  read: boolean;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onRemove,
  onClear,
  className,
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [readNotifications, setReadNotifications] = useState<Set<string>>(new Set());

  // Convert notifications to extended format
  const extendedNotifications: ExtendedMilestoneEvent[] = notifications.map((notification, index) => ({
    ...notification,
    id: `${notification.type}-${notification.milestone}-${index}`,
    timestamp: new Date(),
    read: readNotifications.has(`${notification.type}-${notification.milestone}-${index}`),
  }));

  const unreadCount = extendedNotifications.filter(n => !n.read).length;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleMarkAsRead = (notificationId: string) => {
    setReadNotifications(prev => new Set([...prev, notificationId]));
  };

  const handleRemove = (notification: ExtendedMilestoneEvent) => {
    onRemove(notification);
    handleMarkAsRead(notification.id);
  };

  const getNotificationIcon = (type: MilestoneEvent['type']) => {
    switch (type) {
      case 'clicks':
        return <TrendingUp />;
      case 'unique_visitors':
        return <People />;
      case 'countries':
        return <Language />;
      case 'devices':
        return <DevicesOther />;
      default:
        return <Star />;
    }
  };

  const getNotificationColor = (type: MilestoneEvent['type']) => {
    switch (type) {
      case 'clicks':
        return 'primary';
      case 'unique_visitors':
        return 'secondary';
      case 'countries':
        return 'success';
      case 'devices':
        return 'info';
      default:
        return 'default';
    }
  };

  const formatMilestoneTitle = (notification: ExtendedMilestoneEvent) => {
    switch (notification.type) {
      case 'clicks':
        return `${notification.milestone.toLocaleString()} Total Clicks!`;
      case 'unique_visitors':
        return `${notification.milestone.toLocaleString()} Unique Visitors!`;
      case 'countries':
        return `Popular in ${notification.milestone} Countries!`;
      case 'devices':
        return `${notification.milestone} Device Types!`;
      default:
        return 'Milestone Reached!';
    }
  };

  const open = Boolean(anchorEl);

  return (
    <Box className={className}>
      <IconButton
        onClick={handleClick}
        color="inherit"
        aria-label="notifications"
      >
        <Badge badgeContent={unreadCount} color="error">
          {unreadCount > 0 ? <NotificationsActive /> : <Notifications />}
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <Card sx={{ width: 400, maxHeight: 500 }}>
          <CardContent sx={{ p: 0 }}>
            {/* Header */}
            <Box sx={{ p: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">
                  Notifications
                </Typography>
                <Box>
                  {extendedNotifications.length > 0 && (
                    <Button
                      size="small"
                      onClick={onClear}
                      startIcon={<Clear />}
                    >
                      Clear All
                    </Button>
                  )}
                  <IconButton size="small" onClick={handleClose}>
                    <Close />
                  </IconButton>
                </Box>
              </Box>
              
              {unreadCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
                </Typography>
              )}
            </Box>

            {/* Notifications List */}
            {extendedNotifications.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Notifications sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
                <Typography variant="body2" color="text.secondary">
                  No notifications yet
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  You'll receive notifications when your links reach milestones
                </Typography>
              </Box>
            ) : (
              <List sx={{ maxHeight: 350, overflow: 'auto' }}>
                {extendedNotifications.map((notification, index) => (
                  <React.Fragment key={notification.id}>
                    <ListItem
                      sx={{
                        bgcolor: notification.read ? 'transparent' : 'action.hover',
                        '&:hover': { bgcolor: 'action.selected' },
                      }}
                      onClick={() => handleMarkAsRead(notification.id)}
                    >
                      <ListItemIcon>
                        <Avatar
                          sx={{
                            bgcolor: `${getNotificationColor(notification.type)}.main`,
                            width: 32,
                            height: 32,
                          }}
                        >
                          {getNotificationIcon(notification.type)}
                        </Avatar>
                      </ListItemIcon>
                      
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" fontWeight="medium">
                              {formatMilestoneTitle(notification)}
                            </Typography>
                            {!notification.read && (
                              <Chip
                                label="New"
                                size="small"
                                color="primary"
                                sx={{ height: 16, fontSize: '0.6rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box sx={{ mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary" display="block">
                              {notification.message}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatDistanceToNow(notification.timestamp, { addSuffix: true })}
                            </Typography>
                          </Box>
                        }
                      />
                      
                      <ListItemSecondaryAction>
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(notification);
                          }}
                        >
                          <Close fontSize="small" />
                        </IconButton>
                      </ListItemSecondaryAction>
                    </ListItem>
                    
                    {index < extendedNotifications.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            )}

            {/* Footer */}
            {extendedNotifications.length > 0 && (
              <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary">
                  Celebrating your link's success! 🎉
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Popover>
    </Box>
  );
};