'use client';

import { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  Divider,
  Card,
  CardContent,
  Alert,
  Chip,
  Grid,
} from '@mui/material';
import {
  Link as LinkIcon,
  Analytics,
  QrCode,
  List,
  Dashboard,
  Settings,
} from '@mui/icons-material';
import {
  UrlShortener,
  UrlList,
  UrlCard,
} from '@/components/url';
import { useUrls } from '@/hooks/useUrls';
import type { URLData } from '@/types';

// Mock URL data for demonstration
const mockUrls: URLData[] = [
  {
    id: '1',
    userId: 'user1',
    shortCode: 'abc123',
    originalUrl: 'https://example.com/very-long-url-that-needs-shortening',
    customBackHalf: 'my-link',
    category: 'business',
    visitCount: 142,
    isActive: true,
    metadata: {
      title: 'Example Website - Home Page',
      description: 'This is an example website with a very long URL',
      favicon: 'https://example.com/favicon.ico',
    },
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-20T14:45:00Z',
  },
  {
    id: '2',
    userId: 'user1',
    shortCode: 'def456',
    originalUrl: 'https://github.com/user/repository',
    category: 'technology',
    visitCount: 89,
    isActive: true,
    metadata: {
      title: 'GitHub Repository',
      description: 'A cool open source project',
    },
    createdAt: '2024-01-10T08:15:00Z',
    updatedAt: '2024-01-18T16:20:00Z',
  },
  {
    id: '3',
    userId: 'user1',
    shortCode: 'ghi789',
    originalUrl: 'https://docs.google.com/document/d/1234567890/edit',
    category: 'personal',
    visitCount: 23,
    isActive: false,
    metadata: {
      title: 'Shared Document',
      description: 'Important document for review',
    },
    createdAt: '2024-01-05T12:00:00Z',
    updatedAt: '2024-01-15T09:30:00Z',
  },
];

export function UrlManagementExample() {
  const { urls, isLoading, totalCount } = useUrls();
  const [activeDemo, setActiveDemo] = useState<string>('overview');
  const [selectedUrl, setSelectedUrl] = useState<URLData | null>(null);

  const demos = {
    overview: 'System Overview',
    shortener: 'URL Shortener',
    list: 'URL List Management',
    card: 'URL Card Component',
    analytics: 'Analytics Dashboard',
  };

  const handleUrlEdit = (url: URLData) => {
    setSelectedUrl(url);
    alert(`Edit URL: ${url.shortCode}`);
  };

  const handleUrlAnalytics = (url: URLData) => {
    setSelectedUrl(url);
    setActiveDemo('analytics');
  };

  const renderDemo = () => {
    switch (activeDemo) {
      case 'overview':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              URL Management System Overview
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
              A comprehensive URL shortening and management system with analytics, bulk operations, and advanced features.
            </Typography>

            {/* Stats Overview */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3, mb: 4 }}>
              <Card>
                <CardContent sx={{ textAlign: 'center' }}>
                  <LinkIcon sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
                  <Typography variant="h4" color="primary">
                    {urls.length || totalCount || '0'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total URLs
                  </Typography>
                </CardContent>
              </Card>

              <Card>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Analytics sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
                  <Typography variant="h4" color="success.main">
                    {mockUrls.reduce((sum, url) => sum + url.visitCount, 0)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Total Clicks
                  </Typography>
                </CardContent>
              </Card>

              <Card>
                <CardContent sx={{ textAlign: 'center' }}>
                  <QrCode sx={{ fontSize: 48, color: 'info.main', mb: 1 }} />
                  <Typography variant="h4" color="info.main">
                    {mockUrls.filter(url => url.isActive).length}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Active URLs
                  </Typography>
                </CardContent>
              </Card>
            </Box>

            {/* Features Overview */}
            <Box display="grid" gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }} gap={3}>
              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <LinkIcon color="primary" />
                    <Typography variant="h6">URL Shortening</Typography>
                  </Box>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>Custom short codes and back-halves</li>
                    <li>Bulk URL creation and management</li>
                    <li>Category organization and tagging</li>
                    <li>URL validation and metadata extraction</li>
                    <li>Password protection and expiration</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    <Dashboard color="primary" />
                    <Typography variant="h6">Management Features</Typography>
                  </Box>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li>Advanced search and filtering</li>
                    <li>Bulk operations (activate, deactivate, delete)</li>
                    <li>Grid and list view modes</li>
                    <li>Real-time analytics and statistics</li>
                    <li>Export functionality (CSV, Excel, JSON)</li>
                  </ul>
                </CardContent>
              </Card>
            </Box>
          </Box>
        );

      case 'shortener':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              URL Shortener Component
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Advanced URL shortening form with validation, custom codes, and metadata extraction.
            </Typography>
            
            <UrlShortener
              onSuccess={(url) => {
                alert(`URL created successfully: ${url.shortCode}`);
              }}
              showAdvanced
            />
          </Box>
        );

      case 'list':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              URL List Management
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Comprehensive URL management with search, filtering, bulk operations, and multiple view modes.
            </Typography>
            
            <UrlList
              onUrlEdit={handleUrlEdit}
              onUrlAnalytics={handleUrlAnalytics}
              showCreateButton
              showFilters
              showBulkActions
            />
          </Box>
        );

      case 'card':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              URL Card Component
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Individual URL cards with actions, analytics, and detailed information display.
            </Typography>
            
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
              {mockUrls.map((url) => (
                <UrlCard
                  key={url.id}
                  url={url}
                  onEdit={handleUrlEdit}
                  onAnalytics={handleUrlAnalytics}
                  showSelection
                />
              ))}
            </Box>
          </Box>
        );

      case 'analytics':
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              Analytics Dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Detailed analytics and statistics for URL performance tracking.
            </Typography>
            
            {selectedUrl ? (
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Analytics for: {selectedUrl.shortCode}
                  </Typography>
                  
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        Click Statistics
                      </Typography>
                      <Typography variant="h4" color="primary">
                        {selectedUrl.visitCount}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Total Clicks
                      </Typography>
                    </Box>
                    
                    <Box>
                      <Typography variant="subtitle2" gutterBottom>
                        URL Information
                      </Typography>
                      <Stack spacing={1}>
                        <Chip label={`Category: ${selectedUrl.category}`} size="small" />
                        <Chip 
                          label={selectedUrl.isActive ? 'Active' : 'Inactive'} 
                          color={selectedUrl.isActive ? 'success' : 'warning'}
                          size="small" 
                        />
                        <Typography variant="body2">
                          Created: {new Date(selectedUrl.createdAt).toLocaleDateString()}
                        </Typography>
                      </Stack>
                    </Box>
                  </Box>
                  
                  <Alert severity="info" sx={{ mt: 2 }}>
                    <Typography variant="body2">
                      <strong>Coming Soon:</strong> Detailed analytics including click-through rates, 
                      geographic data, referrer information, and time-based statistics.
                    </Typography>
                  </Alert>
                </CardContent>
              </Card>
            ) : (
              <Alert severity="info">
                Select a URL from the list to view its analytics.
              </Alert>
            )}
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        URL Management System
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Comprehensive URL shortening and management system with advanced features, analytics, and bulk operations.
      </Typography>

      {/* Demo Navigation */}
      <Stack direction="row" spacing={1} sx={{ mb: 3 }} flexWrap="wrap">
        {Object.entries(demos).map(([key, label]) => (
          <Button
            key={key}
            variant={activeDemo === key ? 'contained' : 'outlined'}
            onClick={() => setActiveDemo(key)}
            size="small"
          >
            {label}
          </Button>
        ))}
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* Active Demo */}
      {renderDemo()}
    </Box>
  );
}

export default UrlManagementExample;