'use client';

import React, { useState } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  IconButton,
  Tooltip,
  Chip,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  Badge,
} from '@mui/material';
import {
  Add,
  Search,
  FilterList,
  ViewList,
  ViewModule,
  Refresh,
  Download,
  QrCode,
  Analytics,
  Sort,
} from '@mui/icons-material';
import { UrlShortener, UrlList, UrlCard } from '@/components/url';
import { BulkQRGenerator } from '@/components/qr';
import { useUrls } from '@/hooks/useUrls';
import { useUrlStore } from '@/stores/urlStore';

interface UrlManagementDashboardProps {
  className?: string;
}

type ViewMode = 'grid' | 'list';
type TabValue = 'all' | 'active' | 'inactive' | 'recent';

export const UrlManagementDashboard: React.FC<UrlManagementDashboardProps> = ({
  className,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showUrlShortener, setShowUrlShortener] = useState(false);
  const [showBulkQR, setShowBulkQR] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sortBy, setSortBy] = useState<'createdAt' | 'visitCount' | 'updatedAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState<TabValue>('all');

  const {
    urls,
    selectedUrls,
    isLoading,
    pagination,
    selectUrl,
    clearSelection,
    selectAllUrls,
    fetchUrls,
    setFilters,
    setSorting,
    setSearchQuery: setStoreSearchQuery,
  } = useUrlStore();

  const { deleteUrl, updateUrl } = useUrls();

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setStoreSearchQuery(query);
  };

  // Handle category filter
  const handleCategoryFilter = (category: string) => {
    setCategoryFilter(category);
    setFilters({ category: category || undefined });
  };

  // Handle sorting
  const handleSort = (field: typeof sortBy, order: typeof sortOrder) => {
    setSortBy(field);
    setSortOrder(order);
    setSorting(field, order);
  };

  // Handle tab change
  const handleTabChange = (event: React.SyntheticEvent, newValue: TabValue) => {
    setActiveTab(newValue);
    
    switch (newValue) {
      case 'active':
        setFilters({ isActive: true });
        break;
      case 'inactive':
        setFilters({ isActive: false });
        break;
      case 'recent':
        handleSort('createdAt', 'desc');
        break;
      default:
        setFilters({});
    }
  };

  // Handle URL creation success
  const handleUrlCreated = () => {
    setShowUrlShortener(false);
    fetchUrls();
  };

  // Handle bulk operations
  const handleBulkDelete = async () => {
    if (selectedUrls.length === 0) return;
    
    if (window.confirm(`Delete ${selectedUrls.length} selected URLs?`)) {
      try {
        await Promise.all(selectedUrls.map(id => deleteUrl(id)));
        clearSelection();
        fetchUrls();
      } catch (error) {
        console.error('Bulk delete failed:', error);
      }
    }
  };

  const handleBulkActivate = async (active: boolean) => {
    if (selectedUrls.length === 0) return;
    
    try {
      await Promise.all(selectedUrls.map(id => updateUrl(id, { isActive: active })));
      clearSelection();
      fetchUrls();
    } catch (error) {
      console.error('Bulk update failed:', error);
    }
  };

  // Get filtered URLs based on active tab
  const getFilteredUrls = () => {
    let filtered = urls;
    
    if (searchQuery) {
      filtered = filtered.filter(url => 
        url.originalUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
        url.shortCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        url.metadata?.title?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return filtered;
  };

  const filteredUrls = getFilteredUrls();
  const selectedUrlsData = urls.filter(url => selectedUrls.includes(url.id));

  return (
    <Box className={className}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            URL Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Create, manage, and analyze your shortened URLs
          </Typography>
        </Box>
        
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setShowUrlShortener(true)}
          >
            Create URL
          </Button>
          
          <Button
            variant="outlined"
            startIcon={<QrCode />}
            onClick={() => setShowBulkQR(true)}
            disabled={selectedUrls.length === 0}
          >
            QR Codes ({selectedUrls.length})
          </Button>
        </Stack>
      </Box>

      {/* URL Shortener */}
      {showUrlShortener && (
        <Box sx={{ mb: 4 }}>
          <Card>
            <CardContent>
              <UrlShortener
                onSuccess={handleUrlCreated}
                showAdvanced={true}
              />
              <Box sx={{ mt: 2, textAlign: 'right' }}>
                <Button onClick={() => setShowUrlShortener(false)}>
                  Cancel
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Bulk QR Generator */}
      {showBulkQR && (
        <Box sx={{ mb: 4 }}>
          <Card>
            <CardContent>
              <BulkQRGenerator
                urls={selectedUrlsData}
                onComplete={() => setShowBulkQR(false)}
              />
              <Box sx={{ mt: 2, textAlign: 'right' }}>
                <Button onClick={() => setShowBulkQR(false)}>
                  Close
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}

      <Grid container spacing={3}>
        {/* Filters and Controls */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              {/* Tabs */}
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
              >
                <Tab 
                  label={
                    <Badge badgeContent={urls.length} color="primary" max={999}>
                      All URLs
                    </Badge>
                  } 
                  value="all" 
                />
                <Tab 
                  label={
                    <Badge badgeContent={urls.filter(u => u.isActive).length} color="success" max={999}>
                      Active
                    </Badge>
                  } 
                  value="active" 
                />
                <Tab 
                  label={
                    <Badge badgeContent={urls.filter(u => !u.isActive).length} color="warning" max={999}>
                      Inactive
                    </Badge>
                  } 
                  value="inactive" 
                />
                <Tab label="Recent" value="recent" />
              </Tabs>

              {/* Search and Filters */}
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  placeholder="Search URLs..."
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  size="small"
                  sx={{ minWidth: 250 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search />
                      </InputAdornment>
                    ),
                  }}
                />

                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={categoryFilter}
                    label="Category"
                    onChange={(e) => handleCategoryFilter(e.target.value)}
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    <MenuItem value="business">Business</MenuItem>
                    <MenuItem value="personal">Personal</MenuItem>
                    <MenuItem value="marketing">Marketing</MenuItem>
                    <MenuItem value="social">Social Media</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Sort By</InputLabel>
                  <Select
                    value={`${sortBy}-${sortOrder}`}
                    label="Sort By"
                    onChange={(e) => {
                      const [field, order] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder];
                      handleSort(field, order);
                    }}
                  >
                    <MenuItem value="createdAt-desc">Newest First</MenuItem>
                    <MenuItem value="createdAt-asc">Oldest First</MenuItem>
                    <MenuItem value="visitCount-desc">Most Clicks</MenuItem>
                    <MenuItem value="visitCount-asc">Least Clicks</MenuItem>
                    <MenuItem value="updatedAt-desc">Recently Updated</MenuItem>
                  </Select>
                </FormControl>

                <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
                  <Tooltip title="Refresh">
                    <IconButton onClick={() => fetchUrls()}>
                      <Refresh />
                    </IconButton>
                  </Tooltip>
                  
                  <Tooltip title="List View">
                    <IconButton 
                      onClick={() => setViewMode('list')}
                      color={viewMode === 'list' ? 'primary' : 'default'}
                    >
                      <ViewList />
                    </IconButton>
                  </Tooltip>
                  
                  <Tooltip title="Grid View">
                    <IconButton 
                      onClick={() => setViewMode('grid')}
                      color={viewMode === 'grid' ? 'primary' : 'default'}
                    >
                      <ViewModule />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>

              {/* Bulk Actions */}
              {selectedUrls.length > 0 && (
                <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="body2">
                      {selectedUrls.length} URL{selectedUrls.length !== 1 ? 's' : ''} selected
                    </Typography>
                    
                    <Button size="small" onClick={() => handleBulkActivate(true)}>
                      Activate
                    </Button>
                    
                    <Button size="small" onClick={() => handleBulkActivate(false)}>
                      Deactivate
                    </Button>
                    
                    <Button 
                      size="small" 
                      color="error"
                      onClick={handleBulkDelete}
                    >
                      Delete
                    </Button>
                    
                    <Button size="small" onClick={clearSelection}>
                      Clear Selection
                    </Button>
                    
                    <Button size="small" onClick={selectAllUrls}>
                      Select All
                    </Button>
                  </Stack>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* URL List */}
        <Grid item xs={12}>
          {viewMode === 'grid' ? (
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: 3 
            }}>
              {filteredUrls.map((url) => (
                <UrlCard
                  key={url.id}
                  url={url}
                  selected={selectedUrls.includes(url.id)}
                  onSelect={selectUrl}
                  showSelection={true}
                />
              ))}
            </Box>
          ) : (
            <UrlList
              urls={filteredUrls}
              selectedUrls={selectedUrls}
              onSelect={selectUrl}
              showSelection={true}
              isLoading={isLoading}
            />
          )}

          {/* Empty State */}
          {filteredUrls.length === 0 && !isLoading && (
            <Card>
              <CardContent sx={{ textAlign: 'center', py: 6 }}>
                <Add sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  {searchQuery || categoryFilter ? 'No URLs match your filters' : 'No URLs created yet'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {searchQuery || categoryFilter 
                    ? 'Try adjusting your search or filter criteria'
                    : 'Create your first shortened URL to get started'
                  }
                </Typography>
                {!searchQuery && !categoryFilter && (
                  <Button
                    variant="contained"
                    startIcon={<Add />}
                    onClick={() => setShowUrlShortener(true)}
                  >
                    Create Your First URL
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};