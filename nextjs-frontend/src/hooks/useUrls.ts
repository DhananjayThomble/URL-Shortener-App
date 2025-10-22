'use client';

import { useCallback, useEffect } from 'react';
import { useUrlStore, urlSelectors } from '@/stores/urlStore';
import { withErrorHandling } from '@/lib/api/utils';
import type {
  URLData,
  CreateURLData,
  UpdateURLData,
  URLListParams,
  URLFilters,
  BulkURLOperation,
} from '@/types';

export function useUrls() {
  const store = useUrlStore();

  // Auto-fetch URLs on mount
  useEffect(() => {
    if (store.urls.length === 0 && !store.isLoading) {
      store.fetchUrls();
    }
  }, []);

  // URL Operations with error handling
  const createUrl = useCallback(
    async (data: CreateURLData) => {
      return withErrorHandling(
        () => store.createUrl(data),
        {
          showSuccessToast: true,
          successMessage: 'URL shortened successfully!',
        }
      );
    },
    [store.createUrl]
  );

  const updateUrl = useCallback(
    async (id: string, data: UpdateURLData) => {
      return withErrorHandling(
        () => store.updateUrl(id, data),
        {
          showSuccessToast: true,
          successMessage: 'URL updated successfully!',
        }
      );
    },
    [store.updateUrl]
  );

  const deleteUrl = useCallback(
    async (id: string) => {
      return withErrorHandling(
        () => store.deleteUrl(id),
        {
          showSuccessToast: true,
          successMessage: 'URL deleted successfully!',
        }
      );
    },
    [store.deleteUrl]
  );

  const bulkDeleteUrls = useCallback(
    async (ids: string[]) => {
      return withErrorHandling(
        () => store.bulkDeleteUrls(ids),
        {
          showSuccessToast: true,
          successMessage: `${ids.length} URLs deleted successfully!`,
        }
      );
    },
    [store.bulkDeleteUrls]
  );

  const bulkOperation = useCallback(
    async (operation: BulkURLOperation) => {
      const actionMessages = {
        delete: 'URLs deleted successfully!',
        activate: 'URLs activated successfully!',
        deactivate: 'URLs deactivated successfully!',
        export: 'URLs exported successfully!',
      };

      return withErrorHandling(
        () => store.bulkOperation(operation),
        {
          showSuccessToast: true,
          successMessage: actionMessages[operation.action],
        }
      );
    },
    [store.bulkOperation]
  );

  // Data fetching
  const fetchUrls = useCallback(
    async (params?: URLListParams) => {
      return withErrorHandling(() => store.fetchUrls(params));
    },
    [store.fetchUrls]
  );

  const refreshUrls = useCallback(
    async () => {
      return withErrorHandling(() => store.refreshUrls());
    },
    [store.refreshUrls]
  );

  // Search and filter
  const searchUrls = useCallback(
    (query: string) => {
      store.setSearchQuery(query);
      // Debounce the actual search
      const timeoutId = setTimeout(() => {
        store.fetchUrls();
      }, 300);
      
      return () => clearTimeout(timeoutId);
    },
    [store.setSearchQuery, store.fetchUrls]
  );

  const applyFilters = useCallback(
    (filters: Partial<URLFilters>) => {
      store.setFilters(filters);
    },
    [store.setFilters]
  );

  // Pagination helpers
  const goToPage = useCallback(
    (page: number) => {
      store.setPage(page);
    },
    [store.setPage]
  );

  const changePageSize = useCallback(
    (limit: number) => {
      store.setLimit(limit);
    },
    [store.setLimit]
  );

  const goToNextPage = useCallback(() => {
    if (urlSelectors.getHasNextPage(store)) {
      store.setPage(store.pagination.page + 1);
    }
  }, [store]);

  const goToPrevPage = useCallback(() => {
    if (urlSelectors.getHasPrevPage(store)) {
      store.setPage(store.pagination.page - 1);
    }
  }, [store]);

  // Selection helpers
  const selectUrl = useCallback(
    (id: string) => {
      store.selectUrl(id);
    },
    [store.selectUrl]
  );

  const deselectUrl = useCallback(
    (id: string) => {
      store.deselectUrl(id);
    },
    [store.deselectUrl]
  );

  const toggleSelection = useCallback(
    (id: string) => {
      store.toggleUrlSelection(id);
    },
    [store.toggleUrlSelection]
  );

  const selectAll = useCallback(() => {
    store.selectAllUrls();
  }, [store.selectAllUrls]);

  const clearSelection = useCallback(() => {
    store.clearSelection();
  }, [store.clearSelection]);

  // Sorting
  const sortUrls = useCallback(
    (sortBy: 'createdAt' | 'visitCount' | 'updatedAt', sortOrder: 'asc' | 'desc') => {
      store.setSorting(sortBy, sortOrder);
    },
    [store.setSorting]
  );

  // View mode
  const setViewMode = useCallback(
    (mode: 'grid' | 'list') => {
      store.setViewMode(mode);
    },
    [store.setViewMode]
  );

  // Get URL by ID
  const getUrlById = useCallback(
    (id: string): URLData | undefined => {
      return store.urls.find(url => url.id === id);
    },
    [store.urls]
  );

  // Check if URL is selected
  const isUrlSelected = useCallback(
    (id: string): boolean => {
      return store.selectedUrls.includes(id);
    },
    [store.selectedUrls]
  );

  // Computed values using selectors
  const selectedCount = urlSelectors.getSelectedUrlsCount(store);
  const isAllSelected = urlSelectors.getIsAllSelected(store);
  const isPartiallySelected = urlSelectors.getIsPartiallySelected(store);
  const hasNextPage = urlSelectors.getHasNextPage(store);
  const hasPrevPage = urlSelectors.getHasPrevPage(store);
  const totalCount = urlSelectors.getTotalUrlsCount(store);

  return {
    // Data
    urls: store.urls,
    currentUrl: store.currentUrl,
    selectedUrls: store.selectedUrls,
    
    // Pagination
    pagination: store.pagination,
    hasNextPage,
    hasPrevPage,
    
    // Filters & Search
    filters: store.filters,
    searchQuery: store.searchQuery,
    sortBy: store.sortBy,
    sortOrder: store.sortOrder,
    
    // UI State
    isLoading: store.isLoading,
    isCreating: store.isCreating,
    isUpdating: store.isUpdating,
    isDeleting: store.isDeleting,
    error: store.error,
    viewMode: store.viewMode,
    showFilters: store.showFilters,
    
    // Selection state
    selectedCount,
    isAllSelected,
    isPartiallySelected,
    totalCount,
    
    // Operations
    createUrl,
    updateUrl,
    deleteUrl,
    bulkDeleteUrls,
    bulkOperation,
    
    // Data fetching
    fetchUrls,
    refreshUrls,
    
    // Search & Filter
    searchUrls,
    applyFilters,
    clearFilters: store.clearFilters,
    
    // Pagination
    goToPage,
    changePageSize,
    goToNextPage,
    goToPrevPage,
    
    // Selection
    selectUrl,
    deselectUrl,
    toggleSelection,
    selectAll,
    clearSelection,
    isUrlSelected,
    
    // Sorting
    sortUrls,
    
    // View
    setViewMode,
    setShowFilters: store.setShowFilters,
    
    // Utilities
    getUrlById,
    clearError: store.clearError,
    reset: store.reset,
  };
}

export default useUrls;