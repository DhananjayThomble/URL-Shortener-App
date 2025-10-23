'use client';

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  Grid,
  Avatar,
} from '@mui/material';
import {
  Add,
  Analytics,
  QrCode,
  Download,
  Share,
  Settings,
  Help,
  TrendingUp,
  Visibility,
  People,
  Link as LinkIcon,
  Speed,
  Security,
} from '@mui/icons-material';

interface ShortcutItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  action: () => void;
  badge?: string | number;
  disabled?: boolean;
}

interface DashboardShortcutsProps {
  onCreateUrl?: () => void;
  onViewAnalytics?: () => void;
  onGenerateQR?: () => void;
  onExportData?: () => void;
  onViewSettings?: () => void;
  onViewHelp?: () => void;
  className?: string;
}

export const DashboardShortcuts: React.FC<DashboardShortcutsProps> = ({
  onCreateUrl,
  onViewAnalytics,
  onGenerateQR,
  onExportData,
  onViewSettings,
  onViewHelp,
  className,
}) => {
  const shortcuts: ShortcutItem[] = [
    {
      title: 'Create URL',
      description: 'Shorten a new URL with custom options',
      icon: <Add />,
      color: '#1976d2',
      action: () => onCreateUrl?.(),
    },
    {
      title: 'View Analytics',
      description: 'See detailed performance metrics',
      icon: <Analytics />,
      color: '#388e3c',
      action: () => onViewAnalytics?.(),
      badge: 'New',
    },
    {
      title: 'Generate QR Codes',
      description: 'Create QR codes for your URLs',
      icon: <QrCode />,
      color: '#f57c00',
      action: () => onGenerateQR?.(),
    },
    {
      title: 'Export Data',
      description: 'Download your URLs and analytics',
      icon: <Download />,
      color: '#7b1fa2',
      action: () => onExportData?.(),
    },
    {
      title: 'Settings',
      description: 'Manage your account preferences',
      icon: <Settings />,
      color: '#616161',
      action: () => onViewSettings?.(),
    },
    {
      title: 'Help & Support',
      description: 'Get help and view documentation',
      icon: <Help />,
      color: '#d32f2f',
      action: () => onViewHelp?.(),
    },
  ];

  const quickStats = [
    {
      label: 'URLs Created',
      value: 24,
      icon: <LinkIcon />,
      color: '#1976d2',
    },
    {
      label: 'Total Clicks',
      value: '2.4K',
      icon: <Visibility />,
      color: '#388e3c',
    },
    {
      label: 'Unique Visitors',
      value: '1.8K',
      icon: <People />,
      color: '#f57c00',
    },
    {
      label: 'Performance',
      value: '98%',
      icon: <Speed />,
      color: '#7b1fa2',
    },
  ];

  return (
    <Box className={className}>
      <Grid container spacing={3}>
        {/* Quick Stats */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Stats
              </Typography>
              
              <Grid container spacing={2}>
                {quickStats.map((stat, index) => (
                  <Grid item xs={6} sm={3} key={index}>
                    <Box sx={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 2,
                      p: 2,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      border: 1,
                      borderColor: 'divider',
                    }}>
                      <Avatar sx={{ bgcolor: stat.color, width: 40, height: 40 }}>
                        {stat.icon}
                      </Avatar>
                      <Box>
                        <Typography variant="h6" fontWeight="bold">
                          {stat.value}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {stat.label}
                        </Typography>
                      </Box>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Action Shortcuts */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Quick Actions
              </Typography>
              
              <Grid container spacing={2}>
                {shortcuts.map((shortcut, index) => (
                  <Grid item xs={12} sm={6} md={4} key={index}>
                    <Card
                      variant="outlined"
                      sx={{
                        cursor: shortcut.disabled ? 'not-allowed' : 'pointer',
                        opacity: shortcut.disabled ? 0.6 : 1,
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': shortcut.disabled ? {} : {
                          boxShadow: 2,
                          borderColor: shortcut.color,
                          transform: 'translateY(-2px)',
                        },
                      }}
                      onClick={shortcut.disabled ? undefined : shortcut.action}
                    >
                      <CardContent sx={{ p: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                          <Avatar
                            sx={{
                              bgcolor: shortcut.color,
                              width: 48,
                              height: 48,
                            }}
                          >
                            {shortcut.icon}
                          </Avatar>
                          
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant="subtitle1" fontWeight="bold" noWrap>
                                {shortcut.title}
                              </Typography>
                              {shortcut.badge && (
                                <Chip
                                  label={shortcut.badge}
                                  size="small"
                                  color="primary"
                                  sx={{ height: 20, fontSize: '0.7rem' }}
                                />
                              )}
                            </Box>
                            
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}
                            >
                              {shortcut.description}
                            </Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Activity Preview */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="h6">
                  Recent Activity
                </Typography>
                <Button size="small">
                  View All
                </Button>
              </Box>
              
              <Stack spacing={2}>
                {[
                  {
                    action: 'Created URL',
                    target: 'My Portfolio Website',
                    time: '5 minutes ago',
                    icon: <Add />,
                    color: '#388e3c',
                  },
                  {
                    action: 'URL Clicked',
                    target: 'abc123 received 15 clicks',
                    time: '15 minutes ago',
                    icon: <TrendingUp />,
                    color: '#1976d2',
                  },
                  {
                    action: 'QR Code Generated',
                    target: 'Product Launch Page',
                    time: '1 hour ago',
                    icon: <QrCode />,
                    color: '#f57c00',
                  },
                ].map((activity, index) => (
                  <Box
                    key={index}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      p: 1.5,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                    }}
                  >
                    <Avatar sx={{ bgcolor: activity.color, width: 32, height: 32 }}>
                      {activity.icon}
                    </Avatar>
                    
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight="medium">
                        {activity.action}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {activity.target} • {activity.time}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};