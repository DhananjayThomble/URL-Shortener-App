'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Grid,
  Stack,
  Typography,
  TextField,
  Button,
  IconButton,
  Chip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Checkbox,
  FormControlLabel,
  Pagination,
  Select,
  FormControl,
  InputLabel,
  InputAdornment,
  Collapse,
  Alert,
  Skeleton,
  Fab,
} from '@mui/material';
import {
  Search,
  FilterList,
  ViewList,
  ViewModule,
  Sort,
  Add,
  Delete,
  Visibility,
  VisibilityOff,
  FileDownload,
  Refresh,
  Clear,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import { useUrls } from '@/hooks/useUrls';
import { UrlCard } from './UrlCard';
import { UrlShortener } from './UrlShortener';
import type { URLData, URLFilters } from '@/types';

interface UrlListProps {
  showCreateButton?: boolean;
  showFilters?: boolean;
  showBulkActions?: boolean;
  defaultViewMode?: 'grid' | 'list';
  onUrlEdit?: (url: URLData) => void;
  onUrlAnalytics?: (url: URLData) => void;
}

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100];

const CATEGORIES = [
  'Business',
  'Personal',
  'Social Media',
  'Marketing',
  'Education',
  'Technology',
  'Entertainment',
  'News',
  'Other',
];

export function UrlList({
  showCreateButton = true,
  showFilters = true,
  showBulkActions = true,
  defaultViewMode = 'grid',
  onUrlEdit,
  onUrlAnalytics,
}: UrlListProps) {
  const {
    urls,
    pagination,
    isLoading,
    error,
    searchQuery,
    filters,
    sortBy,
    sortOrder,
    viewMode,
    showFilters: showFiltersState,
    selectedUrls,
    selectedCount,
    isAllSelected,
    isPartiallySelected,
    // Actions
    fetchUrls,
    refreshUrls,
    searchUrls,
    applyFilters,
    clearFilters,
    sortUrls,
    goToPage,
    changePageSize,
    setViewMode,
    setShowFilters,
    selectAll,
    clearSelection,
    toggleSelection,
    bulkDeleteUrls,
    bulkOperation,
    clearError,
  } = useUrls();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);
  const [sortMenuAnchor, setSortMenuAnchor] = useState<null | HTMLElement>(null);
  const [bulkMenuAnchor, setBulkMenuAnchor] = useState<null | HTMLElement>(null);

  // Initialize view mode
  useEffect(() => {
    if (viewMode !== defaultViewMode) {
      setViewMode(defaultViewMode);
    }
  }, [defaultViewMode, viewMode, setViewMode]);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (localSearchQuery !== searchQuery) {
        searchUrls(localSearchQuery);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [localSearchQuery, searchQuery, searchUrls]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<URLFilters>) => {
    applyFilters(newFilters);
  }, [applyFilters]);

  // Handle sort
  const handleSort = (newSortBy: typeof sortBy, newSortOrder: typeof sortOrder) => {
    sortUrls(newSortBy, newSortOrder);
    setSortMenuAnchor(null);
  };

  // Handle bulk actions
  const handleBulkAction = async (action: 'delete' | 'activate' | 'deactivate' | 'export') => {
    if (selectedUrls.length === 0) return;

    try {
      switch (action) {
        case 'delete':
          if (window.confirm(`Delete ${selectedUrls.length} URLs?`)) {
            await bulkDeleteUrls(selectedUrls);
          }
          break;
        case 'activate':
        case 'deactivate':
          await bulkOperation({ action, urlIds: selectedUrls });
          break;
        case 'export':
          // TODO: Implement export functionality
          alert('Export functionality coming soon!');
          break;
      }
    } catch (error) {
      console.error('Bulk action failed:', error);
    }

    setBulkMenuAnchor(null);
  };

  // Handle URL creation success
  const handleUrlCreated = () => {
    setShowCreateForm(false);
    refreshUrls();
  };

  // Render loading skeleton
  const renderSkeleton = () => (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
      ))}
    </Box>
  );

  // Render empty state
  const renderEmptyState = () => (
    <Box
      sx={{
        textAlign: 'center',
        py: 8,
        px: 2,
      }}
    >
      <Typography variant="h6" gutterBottom>
        No URLs found
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {searchQuery || Object.keys(filters).length > 0
          ? 'Try adjusting your search or filters'
          : 'Create your first shortened URL to get started'}
      </Typography>
      {showCreateButton && (
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setShowCreateForm(true)}
        >
          Create URL
        </Button>
      )}
    </Box>
  );

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
          <Typography variant="h5" component="h1">
            My URLs
          </Typography>

          <Stack direction="row" spacing={1}>
            {showCreateButton && (
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => setShowCreateForm(true)}
              >
                Create URL
              </Button>
            )}

            <IconButton onClick={refreshUrls} disabled={isLoading}>
              <Refresh />
            </IconButton>
          </Stack>
        </Box>

        {/* Search and Controls */}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          {/* Search */}
          <TextField
            placeholder="Search URLs..."
            value={localSearchQuery}
            onChange={(e) => setLocalSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
              endAdornment: localSearchQuery && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setLocalSearchQuery('')}
                  >
                    <Clear />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ flex: 1, minWidth: 300 }}
          />

          {/* Controls */}
          <Stack direction="row" spacing={1}>
            {showFilters && (
              <Button
                startIcon={<FilterList />}
                onClick={() => setShowFilters(!showFiltersState)}
                variant={showFiltersState ? 'contained' : 'outlined'}
              >
                Filters
              </Button>
            )}

            <IconButton
              onClick={(e) => setSortMenuAnchor(e.currentTarget)}
            >
              <Sort />
            </IconButton>

            <IconButton
              onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            >
              {viewMode === 'grid' ? <ViewList /> : <ViewModule />}
            </IconButton>
          </Stack>
        </Stack>

        {/* Filters */}
        {showFilters && (
          <Collapse in={showFiltersState}>
            <Box
              sx={{
                mt: 2,
                p: 2,
                backgroundColor: 'action.hover',
                borderRadius: 1,
              }}
            >
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={filters.category || ''}
                    onChange={(e) => handleFilterChange({ category: e.target.value || undefined })}
                    label="Category"
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    {CATEGORIES.map(category => (
                      <MenuItem key={category} value={category.toLowerCase()}>
                        {category}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={filters.isActive === undefined ? '' : filters.isActive ? 'active' : 'inactive'}
                    onChange={(e) => {
                      const value = e.target.value;
                      handleFilterChange({
                        isActive: value === '' ? undefined : value === 'active'
                      });
                    }}
                    label="Status"
                  >
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="inactive">Inactive</MenuItem>
                  </Select>
                </FormControl>

                <Button
                  startIcon={<Clear />}
                  onClick={clearFilters}
                  disabled={Object.keys(filters).length === 0 && !searchQuery}
                >
                  Clear Filters
                </Button>
              </Stack>
            </Box>
          </Collapse>
        )}

        {/* Bulk Actions */}
        {showBulkActions && selectedCount > 0 && (
          <Box
            sx={{
              mt: 2,
              p: 2,
              backgroundColor: 'primary.light',
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box display="flex" alignItems="center" gap={2}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isAllSelected}
                    indeterminate={isPartiallySelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        selectAll();
                      } else {
                        clearSelection();
                      }
                    }}
                  />
                }
                label={`${selectedCount} selected`}
              />
            </Box>

            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<Delete />}
                onClick={(e) => setBulkMenuAnchor(e.currentTarget)}
                color="error"
              >
                Actions
              </Button>
              <Button
                size="small"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </Stack>
          </Box>
        )}
      </Box>

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={clearError}>
          {error}
        </Alert>
      )}

      {/* Create Form */}
      <Collapse in={showCreateForm}>
        <Box sx={{ mb: 3 }}>
          <UrlShortener
            onSuccess={handleUrlCreated}
            compact
          />
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Button onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </Box>
        </Box>
      </Collapse>

      {/* Content */}
      {isLoading && urls.length === 0 ? (
        renderSkeleton()
      ) : urls.length === 0 ? (
        renderEmptyState()
      ) : (
        <>
          {/* URL Grid/List */}
          <Box 
            sx={{ 
              display: 'grid', 
              gridTemplateColumns: viewMode === 'grid' 
                ? 'repeat(auto-fill, minmax(300px, 1fr))' 
                : '1fr',
              gap: 2,
              mb: 3 
            }}
          >
            {urls.map((url) => (
              <UrlCard
                key={url.id}
                url={url}
                selected={selectedUrls.includes(url.id)}
                onSelect={toggleSelection}
                onEdit={onUrlEdit}
                onAnalytics={onUrlAnalytics}
                showSelection={showBulkActions}
                compact={viewMode === 'list'}
              />
            ))}
          </Box>

          {/* Pagination */}
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={2}>
              <Typography variant="body2" color="text.secondary">
                Showing {((pagination.page - 1) * pagination.limit) + 1}-
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </Typography>

              <FormControl size="small">
                <Select
                  value={pagination.limit}
                  onChange={(e) => changePageSize(Number(e.target.value))}
                >
                  {ITEMS_PER_PAGE_OPTIONS.map(option => (
                    <MenuItem key={option} value={option}>
                      {option} per page
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Pagination
              count={pagination.totalPages}
              page={pagination.page}
              onChange={(_, page) => goToPage(page)}
              color="primary"
            />
          </Box>
        </>
      )}

      {/* Sort Menu */}
      <Menu
        anchorEl={sortMenuAnchor}
        open={Boolean(sortMenuAnchor)}
        onClose={() => setSortMenuAnchor(null)}
      >
        <MenuItem onClick={() => handleSort('createdAt', 'desc')}>
          <ListItemText>Newest First</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSort('createdAt', 'asc')}>
          <ListItemText>Oldest First</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSort('visitCount', 'desc')}>
          <ListItemText>Most Clicks</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSort('visitCount', 'asc')}>
          <ListItemText>Least Clicks</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSort('updatedAt', 'desc')}>
          <ListItemText>Recently Updated</ListItemText>
        </MenuItem>
      </Menu>

      {/* Bulk Actions Menu */}
      <Menu
        anchorEl={bulkMenuAnchor}
        open={Boolean(bulkMenuAnchor)}
        onClose={() => setBulkMenuAnchor(null)}
      >
        <MenuItem onClick={() => handleBulkAction('activate')}>
          <ListItemIcon>
            <Visibility fontSize="small" />
          </ListItemIcon>
          <ListItemText>Activate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkAction('deactivate')}>
          <ListItemIcon>
            <VisibilityOff fontSize="small" />
          </ListItemIcon>
          <ListItemText>Deactivate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleBulkAction('export')}>
          <ListItemIcon>
            <FileDownload fontSize="small" />
          </ListItemIcon>
          <ListItemText>Export</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => handleBulkAction('delete')}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <Delete fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Floating Action Button */}
      {showCreateButton && !showCreateForm && (
        <Fab
          color="primary"
          sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            display: { xs: 'flex', md: 'none' },
          }}
          onClick={() => setShowCreateForm(true)}
        >
          <Add />
        </Fab>
      )}
    </Box>
  );
}

export default UrlList;