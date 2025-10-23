'use client';

import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Avatar,
  Box,
  Chip,
} from '@mui/material';
import {
  PersonAdd,
  Link as LinkIcon,
  Security,
  AdminPanelSettings,
  Analytics,
} from '@mui/icons-material';

interface ActivityItem {
  id: string;
  type: 'user_registered' | 'url_created' | 'admin_login' | 'security_alert' | 'analytics_export';
  message: string;
  timestamp: string;
  user?: string;
  severity?: 'info' | 'warning' | 'error';
}

export function RecentActivityWidget() {
  // Mock data - in real app, this would come from API
  const recentActivity: ActivityItem[] = [
    {
      id: '1',
      type: 'user_registered',
      message: 'New user registered',
      timestamp: '2 minutes ago',
      user: 'john.doe@example.com',
      severity: 'info',
    },
    {
      id: '2',
      type: 'url_created',
      message: 'URL shortened',
      timestamp: '5 minutes ago',
      user: 'jane.smith@example.com',
      severity: 'info',
    },
    {
      id: '3',
      type: 'admin_login',
      message: 'Admin login',
      timestamp: '12 minutes ago',
      user: 'admin@snapurl.com',
      severity: 'info',
    },
    {
      id: '4',
      type: 'security_alert',
      message: 'Multiple failed login attempts',
      timestamp: '25 minutes ago',
      user: 'suspicious@example.com',
      severity: 'warning',
    },
    {
      id: '5',
      type: 'analytics_export',
      message: 'Analytics data exported',
      timestamp: '1 hour ago',
      user: 'manager@company.com',
      severity: 'info',
    },
  ];

  const getActivityIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'user_registered':
        return <PersonAdd />;
      case 'url_created':
        return <LinkIcon />;
      case 'admin_login':
        return <AdminPanelSettings />;
      case 'security_alert':
        return <Security />;
      case 'analytics_export':
        return <Analytics />;
      default:
        return <PersonAdd />;
    }
  };

  const getActivityColor = (type: ActivityItem['type'], severity?: string) => {
    if (severity === 'error') return 'error.main';
    if (severity === 'warning') return 'warning.main';
    
    switch (type) {
      case 'user_registered':
        return 'success.main';
      case 'url_created':
        return 'primary.main';
      case 'admin_login':
        return 'secondary.main';
      case 'security_alert':
        return 'warning.main';
      case 'analytics_export':
        return 'info.main';
      default:
        return 'primary.main';
    }
  };

  const getSeverityChip = (severity?: string) => {
    if (!severity || severity === 'info') return null;
    
    return (
      <Chip
        label={severity.toUpperCase()}
        size="small"
        color={severity === 'error' ? 'error' : 'warning'}
        variant="outlined"
      />
    );
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Recent Activity
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Latest system events and user actions
        </Typography>

        <List>
          {recentActivity.map((activity) => (
            <ListItem key={activity.id} sx={{ px: 0 }}>
              <ListItemIcon>
                <Avatar
                  sx={{
                    bgcolor: getActivityColor(activity.type, activity.severity),
                    width: 40,
                    height: 40,
                  }}
                >
                  {getActivityIcon(activity.type)}
                </Avatar>
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight="medium">
                      {activity.message}
                    </Typography>
                    {getSeverityChip(activity.severity)}
                  </Box>
                }
                secondary={
                  <Box>
                    {activity.user && (
                      <Typography variant="caption" color="text.secondary">
                        {activity.user}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {activity.timestamp}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Typography
            variant="body2"
            color="primary"
            sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          >
            View All Activity
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}