import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { CssBaseline } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  const theme = createTheme({
    palette: {
      mode: 'light',
    },
  })

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  )
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options })

export * from '@testing-library/react'
export { customRender as render }

// Mock user data
export const mockUser = {
  id: '1',
  email: 'test@example.com',
  name: 'Test User',
  isEmailVerified: true,
  role: 'user' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  lastLoginAt: '2024-01-01T00:00:00.000Z',
}

export const mockAdminUser = {
  ...mockUser,
  role: 'admin' as const,
}

// Mock URL data
export const mockUrl = {
  id: '1',
  originalUrl: 'https://example.com',
  shortCode: 'abc123',
  customBackHalf: null,
  category: 'general',
  tags: [],
  visitCount: 10,
  isActive: true,
  expiresAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  userId: '1',
}

// Mock analytics data
export const mockAnalytics = {
  totalClicks: 100,
  uniqueClicks: 80,
  clicksByDate: [
    { date: '2024-01-01', clicks: 10 },
    { date: '2024-01-02', clicks: 15 },
    { date: '2024-01-03', clicks: 20 },
  ],
  topCountries: [
    { country: 'United States', clicks: 50 },
    { country: 'United Kingdom', clicks: 30 },
  ],
  topDevices: [
    { device: 'Desktop', clicks: 60 },
    { device: 'Mobile', clicks: 40 },
  ],
  topBrowsers: [
    { browser: 'Chrome', percentage: 70 },
    { browser: 'Firefox', percentage: 30 },
  ],
  topReferrers: [
    { referrer: 'google.com', clicks: 40 },
    { referrer: 'direct', clicks: 60 },
  ],
}

// Mock auth store
export const createMockAuthStore = (user = mockUser, isAuthenticated = true) => ({
  user: isAuthenticated ? user : null,
  tokens: isAuthenticated ? {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresIn: 3600,
  } : null,
  isLoading: false,
  isAuthenticated,
  login: jest.fn(),
  register: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
  updateUser: jest.fn(),
  setLoading: jest.fn(),
  initialize: jest.fn(),
  checkAndRefreshToken: jest.fn(),
})

// Mock URL store
export const createMockUrlStore = (urls = [mockUrl]) => ({
  urls,
  selectedUrls: [],
  currentUrl: null,
  pagination: {
    page: 1,
    limit: 20,
    total: urls.length,
    totalPages: 1,
  },
  filters: {},
  searchQuery: '',
  sortBy: 'createdAt' as const,
  sortOrder: 'desc' as const,
  isLoading: false,
  isCreating: false,
  isUpdating: false,
  isDeleting: false,
  error: null,
  viewMode: 'grid' as const,
  showFilters: false,
  createUrl: jest.fn(),
  updateUrl: jest.fn(),
  deleteUrl: jest.fn(),
  bulkDeleteUrls: jest.fn(),
  bulkOperation: jest.fn(),
  fetchUrls: jest.fn(),
  fetchUrl: jest.fn(),
  refreshUrls: jest.fn(),
  selectUrl: jest.fn(),
  deselectUrl: jest.fn(),
  selectAllUrls: jest.fn(),
  clearSelection: jest.fn(),
  toggleUrlSelection: jest.fn(),
  setFilters: jest.fn(),
  clearFilters: jest.fn(),
  setSearchQuery: jest.fn(),
  setSorting: jest.fn(),
  setPage: jest.fn(),
  setLimit: jest.fn(),
  setViewMode: jest.fn(),
  setShowFilters: jest.fn(),
  setError: jest.fn(),
  clearError: jest.fn(),
  reset: jest.fn(),
})

// Test helpers
export const waitForLoadingToFinish = () => 
  new Promise(resolve => setTimeout(resolve, 0))

export const createMockApiResponse = <T,>(data: T) => ({
  data,
  success: true,
  message: 'Success',
})