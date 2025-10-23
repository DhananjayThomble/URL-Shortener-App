import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { urlAPI } from '@/lib/api';
import type {
  URLData,
  CreateURLData,
  UpdateURLData,
  URLListParams,
  PaginatedResponse,
  URLFilters,
  BulkURLOperation,
} from '@/types';

interface URLState {
  // Data
  urls: URLData[];
  selectedUrls: string[];
  currentUrl: URLData | null;
  
  // Pagination & Filtering
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: URLFilters;
  searchQuery: string;
  sortBy: 'createdAt' | 'visitCount' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
  
  // UI State
  isLoading: boolean;
  isCreating: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  error: string | null;
  
  // View State
  viewMode: 'grid' | 'list';
  showFilters: boolean;
}

interface URLActions {
  // URL Operations
  createUrl: (data: CreateURLData) => Promise<URLData>;
  updateUrl: (id: string, data: UpdateURLData) => Promise<URLData>;
  deleteUrl: (id: string) => Promise<void>;
  bulkDeleteUrls: (ids: string[]) => Promise<void>;
  bulkOperation: (operation: BulkURLOperation) => Promise<void>;
  
  // Data Fetching
  fetchUrls: (params?: URLListParams) => Promise<void>;
  fetchUrl: (id: string) => Promise<void>;
  refreshUrls: () => Promise<void>;
  
  // Selection Management
  selectUrl: (id: string) => void;
  deselectUrl: (id: string) => void;
  selectAllUrls: () => void;
  clearSelection: () => void;
  toggleUrlSelection: (id: string) => void;
  
  // Filtering & Search
  setFilters: (filters: Partial<URLFilters>) => void;
  clearFilters: () => void;
  setSearchQuery: (query: string) => void;
  setSorting: (sortBy: URLState['sortBy'], sortOrder: URLState['sortOrder']) => void;
  
  // Pagination
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  
  // UI State
  setViewMode: (mode: 'grid' | 'list') => void;
  setShowFilters: (show: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  
  // Utility
  reset: () => void;
}

interface URLStore extends URLState, URLActions {}

const initialState: URLState = {
  // Data
  urls: [],
  selectedUrls: [],
  currentUrl: null,
  
  // Pagination & Filtering
  pagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  },
  filters: {},
  searchQuery: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
  
  // UI State
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  
  // View State
  viewMode: 'grid',
  showFilters: false,
};

export const useUrlStore = create<URLStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // URL Operations
      createUrl: async (data: CreateURLData) => {
        set({ isCreating: true, error: null });
        
        try {
          const newUrl = await urlAPI.createUrl(data);
          
          set(state => ({
            urls: [newUrl, ...(state.urls || [])],
            isCreating: false,
            pagination: {
              ...state.pagination,
              total: state.pagination.total + 1,
            },
          }));
          
          return newUrl;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to create URL';
          set({ isCreating: false, error: errorMessage });
          throw error;
        }
      },

      updateUrl: async (id: string, data: UpdateURLData) => {
        set({ isUpdating: true, error: null });
        
        try {
          const updatedUrl = await urlAPI.updateUrl(id, data);
          
          set(state => ({
            urls: (state.urls || []).map(url => url.id === id ? updatedUrl : url),
            currentUrl: state.currentUrl?.id === id ? updatedUrl : state.currentUrl,
            isUpdating: false,
          }));
          
          return updatedUrl;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to update URL';
          set({ isUpdating: false, error: errorMessage });
          throw error;
        }
      },

      deleteUrl: async (id: string) => {
        set({ isDeleting: true, error: null });
        
        try {
          await urlAPI.deleteUrl(id);
          
          set(state => ({
            urls: (state.urls || []).filter(url => url.id !== id),
            selectedUrls: state.selectedUrls.filter(urlId => urlId !== id),
            currentUrl: state.currentUrl?.id === id ? null : state.currentUrl,
            isDeleting: false,
            pagination: {
              ...state.pagination,
              total: Math.max(0, state.pagination.total - 1),
            },
          }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete URL';
          set({ isDeleting: false, error: errorMessage });
          throw error;
        }
      },

      bulkDeleteUrls: async (ids: string[]) => {
        set({ isDeleting: true, error: null });
        
        try {
          await get().bulkOperation({ action: 'delete', urlIds: ids });
          
          set(state => ({
            urls: (state.urls || []).filter(url => !ids.includes(url.id)),
            selectedUrls: [],
            isDeleting: false,
            pagination: {
              ...state.pagination,
              total: Math.max(0, state.pagination.total - ids.length),
            },
          }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete URLs';
          set({ isDeleting: false, error: errorMessage });
          throw error;
        }
      },

      bulkOperation: async (operation: BulkURLOperation) => {
        set({ isLoading: true, error: null });
        
        try {
          await urlAPI.bulkOperation(operation);
          
          // Refresh URLs after bulk operation
          await get().refreshUrls();
          
          set({ selectedUrls: [], isLoading: false });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Bulk operation failed';
          set({ isLoading: false, error: errorMessage });
          throw error;
        }
      },

      // Data Fetching
      fetchUrls: async (params?: URLListParams) => {
        set({ isLoading: true, error: null });
        
        try {
          const state = get();
          const requestParams: URLListParams = {
            page: state.pagination.page,
            limit: state.pagination.limit,
            search: state.searchQuery || undefined,
            category: state.filters.category,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder,
            ...params,
          };
          
          const response = await urlAPI.getUserUrls(requestParams);
          
          set({
            urls: Array.isArray(response.data) ? response.data : [],
            pagination: response.pagination,
            isLoading: false,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch URLs';
          set({ isLoading: false, error: errorMessage });
          throw error;
        }
      },

      fetchUrl: async (id: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const url = await urlAPI.getUrl(id);
          set({ currentUrl: url, isLoading: false });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to fetch URL';
          set({ isLoading: false, error: errorMessage });
          throw error;
        }
      },

      refreshUrls: async () => {
        const state = get();
        await get().fetchUrls({
          page: state.pagination.page,
          limit: state.pagination.limit,
        });
      },

      // Selection Management
      selectUrl: (id: string) => {
        set(state => ({
          selectedUrls: [...state.selectedUrls, id],
        }));
      },

      deselectUrl: (id: string) => {
        set(state => ({
          selectedUrls: state.selectedUrls.filter(urlId => urlId !== id),
        }));
      },

      selectAllUrls: () => {
        set(state => ({
          selectedUrls: (state.urls || []).map(url => url.id),
        }));
      },

      clearSelection: () => {
        set({ selectedUrls: [] });
      },

      toggleUrlSelection: (id: string) => {
        const state = get();
        if (state.selectedUrls.includes(id)) {
          get().deselectUrl(id);
        } else {
          get().selectUrl(id);
        }
      },

      // Filtering & Search
      setFilters: (filters: Partial<URLFilters>) => {
        set(state => ({
          filters: { ...state.filters, ...filters },
          pagination: { ...state.pagination, page: 1 }, // Reset to first page
        }));
        
        // Auto-fetch with new filters
        get().fetchUrls();
      },

      clearFilters: () => {
        set({
          filters: {},
          searchQuery: '',
          pagination: { ...get().pagination, page: 1 },
        });
        
        get().fetchUrls();
      },

      setSearchQuery: (query: string) => {
        set({
          searchQuery: query,
          pagination: { ...get().pagination, page: 1 },
        });
      },

      setSorting: (sortBy: URLState['sortBy'], sortOrder: URLState['sortOrder']) => {
        set({
          sortBy,
          sortOrder,
          pagination: { ...get().pagination, page: 1 },
        });
        
        get().fetchUrls();
      },

      // Pagination
      setPage: (page: number) => {
        set(state => ({
          pagination: { ...state.pagination, page },
        }));
        
        get().fetchUrls();
      },

      setLimit: (limit: number) => {
        set(state => ({
          pagination: { ...state.pagination, limit, page: 1 },
        }));
        
        get().fetchUrls();
      },

      // UI State
      setViewMode: (mode: 'grid' | 'list') => {
        set({ viewMode: mode });
      },

      setShowFilters: (show: boolean) => {
        set({ showFilters: show });
      },

      setError: (error: string | null) => {
        set({ error });
      },

      clearError: () => {
        set({ error: null });
      },

      // Utility
      reset: () => {
        set(initialState);
      },
    }),
    {
      name: 'url-store',
      // Only persist non-sensitive UI state
      partialize: (state: URLStore) => ({
        viewMode: state.viewMode,
        showFilters: state.showFilters,
        pagination: { limit: state.pagination.limit },
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
      }),
    }
  )
);

// Selectors for computed values
export const urlSelectors = {
  getSelectedUrlsCount: (state: URLStore) => state.selectedUrls?.length || 0,
  getIsAllSelected: (state: URLStore) => 
    (state.urls?.length || 0) > 0 && state.selectedUrls.length === (state.urls?.length || 0),
  getIsPartiallySelected: (state: URLStore) => 
    state.selectedUrls.length > 0 && state.selectedUrls.length < (state.urls?.length || 0),
  getFilteredUrlsCount: (state: URLStore) => state.urls?.length || 0,
  getTotalUrlsCount: (state: URLStore) => state.pagination?.total || 0,
  getHasNextPage: (state: URLStore) => 
    (state.pagination?.page || 0) < (state.pagination?.totalPages || 0),
  getHasPrevPage: (state: URLStore) => (state.pagination?.page || 0) > 1,
};