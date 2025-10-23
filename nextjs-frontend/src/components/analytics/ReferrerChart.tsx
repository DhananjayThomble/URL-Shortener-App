'use client';

import React from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Chip,
  LinearProgress,
} from '@mui/material';
import {
  Language,
  Search,
  Share,
  Email,
  Facebook,
  Twitter,
  LinkedIn,
  Instagram,
  YouTube,
  Reddit,
  Public,
} from '@mui/icons-material';
import type { ReferrerData } from '@/types/analytics';

interface ReferrerChartProps {
  data: ReferrerData[];
  maxItems?: number;
  height?: number;
  className?: string;
}

export const ReferrerChart: React.FC<ReferrerChartProps> = ({
  data,
  maxItems = 8,
  height = 250,
  className,
}) => {
  // Get referrer icon based on domain
  const getReferrerIcon = (referrer: string, domain: string) => {
    const domainLower = domain.toLowerCase();
    
    if (referrer === 'Direct') {
      return <Public />;
    }
    
    if (domainLower.includes('google')) {
      return <Search />;
    }
    
    if (domainLower.includes('facebook')) {
      return <Facebook />;
    }
    
    if (domainLower.includes('twitter') || domainLower.includes('t.co')) {
      return <Twitter />;
    }
    
    if (domainLower.includes('linkedin')) {
      return <LinkedIn />;
    }
    
    if (domainLower.includes('instagram')) {
      return <Instagram />;
    }
    
    if (domainLower.includes('youtube')) {
      return <YouTube />;
    }
    
    if (domainLower.includes('reddit')) {
      return <Reddit />;
    }
    
    if (domainLower.includes('mail') || domainLower.includes('email')) {
      return <Email />;
    }
    
    if (domainLower.includes('share') || domainLower.includes('social')) {
      return <Share />;
    }
    
    return <Language />;
  };

  // Get referrer color based on domain
  const getReferrerColor = (domain: string) => {
    const domainLower = domain.toLowerCase();
    
    if (domainLower.includes('google')) {
      return '#4285f4';
    }
    
    if (domainLower.includes('facebook')) {
      return '#1877f2';
    }
    
    if (domainLower.includes('twitter') || domainLower.includes('t.co')) {
      return '#1da1f2';
    }
    
    if (domainLower.includes('linkedin')) {
      return '#0077b5';
    }
    
    if (domainLower.includes('instagram')) {
      return '#e4405f';
    }
    
    if (domainLower.includes('youtube')) {
      return '#ff0000';
    }
    
    if (domainLower.includes('reddit')) {
      return '#ff4500';
    }
    
    return '#666666';
  };

  // Format referrer display name
  const formatReferrerName = (referrer: string, domain: string) => {
    if (referrer === 'Direct') {
      return 'Direct Traffic';
    }
    
    if (referrer.length > 30) {
      return `${referrer.substring(0, 30)}...`;
    }
    
    return referrer;
  };

  if (!data || data.length === 0) {
    return (
      <Box
        className={className}
        sx={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">No referrer data available</Typography>
      </Box>
    );
  }

  return (
    <Box className={className}>
      <List dense sx={{ maxHeight: height, overflow: 'auto' }}>
        {data.slice(0, maxItems).map((referrer, index) => (
          <ListItem
            key={`${referrer.domain}-${index}`}
            sx={{
              px: 0,
              py: 1,
              mb: 1,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <ListItemAvatar>
              <Avatar
                sx={{
                  bgcolor: getReferrerColor(referrer.domain),
                  width: 32,
                  height: 32,
                }}
              >
                {getReferrerIcon(referrer.referrer, referrer.domain)}
              </Avatar>
            </ListItemAvatar>
            
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="medium" noWrap sx={{ flex: 1, mr: 1 }}>
                    {formatReferrerName(referrer.referrer, referrer.domain)}
                  </Typography>
                  <Chip
                    label={referrer.clicks.toLocaleString()}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              }
              secondary={
                <Box sx={{ mt: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
                      {referrer.domain}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {referrer.percentage.toFixed(1)}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={referrer.percentage}
                    sx={{
                      height: 3,
                      borderRadius: 2,
                      bgcolor: 'action.selected',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: getReferrerColor(referrer.domain),
                      },
                    }}
                  />
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>

      {data.length > maxItems && (
        <Box sx={{ mt: 1, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            +{data.length - maxItems} more referrers
          </Typography>
        </Box>
      )}
    </Box>
  );
};