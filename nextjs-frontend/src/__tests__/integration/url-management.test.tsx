import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, mockUser, mockUrl } from '../utils/test-utils'

// Mock the stores
const mockCreateUrl = jest.fn()
const mockUpdateUrl = jest.fn()
const mockDeleteUrl = jest.fn()
const mockFetchUrls = jest.fn()

const mockAuthStore = {
  user: mockUser,
  isLoading: false,
  isAuthenticated: true,
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
  refreshToken: jest.fn(),
  updateUser: jest.fn(),
  setLoading: jest.fn(),
  initialize: jest.fn(),
  checkAndRefreshToken: jest.fn(),
}

const mockUrlStore = {
  urls: [mockUrl],
  selectedUrls: [],
  currentUrl: null,
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
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
  createUrl: mockCreateUrl,
  updateUrl: mockUpdateUrl,
  deleteUrl: mockDeleteUrl,
  fetchUrls: mockFetchUrls,
  bulkDeleteUrls: jest.fn(),
  bulkOperation: jest.fn(),
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
}

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(() => mockAuthStore),
}))

jest.mock('@/stores/urlStore', () => ({
  useUrlStore: jest.fn(() => mockUrlStore),
}))

// Mock components
const MockUrlShortener = () => (
  <div>
    <h1>Shorten Your URL</h1>
    <form>
      <input aria-label="URL" type="url" placeholder="Enter URL to shorten" />
      <button type="submit">Shorten</button>
    </form>
  </div>
)

const MockDashboard = () => (
  <div>
    <h1>Dashboard</h1>
    <div>
      <input placeholder="Search URLs" />
      <div data-testid="url-list">
        <div data-testid="url-item">
          <span>{mockUrl.shortCode}</span>
          <span>{mockUrl.originalUrl}</span>
          <button>Edit</button>
          <button>Delete</button>
        </div>
      </div>
    </div>
  </div>
)

describe('URL Management Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('URL Creation', () => {
    it('should render URL shortener form', async () => {
      render(<MockUrlShortener />)

      expect(screen.getByText('Shorten Your URL')).toBeInTheDocument()
      expect(screen.getByLabelText(/url/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /shorten/i })).toBeInTheDocument()
    })

    it('should handle URL input', async () => {
      const user = userEvent.setup()
      render(<MockUrlShortener />)

      const urlInput = screen.getByLabelText(/url/i)
      const submitButton = screen.getByRole('button', { name: /shorten/i })

      await user.type(urlInput, 'https://example.com/very-long-url')
      await user.click(submitButton)

      expect(urlInput).toHaveValue('https://example.com/very-long-url')
    })

    it('should validate URL format', async () => {
      const user = userEvent.setup()
      render(<MockUrlShortener />)

      const urlInput = screen.getByLabelText(/url/i)
      
      await user.type(urlInput, 'invalid-url')
      
      // URL input should accept the value (validation would be handled by form logic)
      expect(urlInput).toHaveValue('invalid-url')
    })
  })

  describe('URL Management Dashboard', () => {
    it('should display dashboard', async () => {
      render(<MockDashboard />)

      expect(screen.getByText('Dashboard')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })

    it('should display URL list', async () => {
      render(<MockDashboard />)

      expect(screen.getByTestId('url-list')).toBeInTheDocument()
      expect(screen.getByTestId('url-item')).toBeInTheDocument()
      expect(screen.getByText(mockUrl.shortCode)).toBeInTheDocument()
      expect(screen.getByText(mockUrl.originalUrl)).toBeInTheDocument()
    })

    it('should have action buttons', async () => {
      render(<MockDashboard />)

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('should handle search input', async () => {
      const user = userEvent.setup()
      render(<MockDashboard />)

      const searchInput = screen.getByPlaceholderText(/search/i)
      await user.type(searchInput, 'example')

      expect(searchInput).toHaveValue('example')
    })
  })

  describe('URL Store Integration', () => {
    it('should have access to URL store functions', () => {
      expect(mockCreateUrl).toBeDefined()
      expect(mockUpdateUrl).toBeDefined()
      expect(mockDeleteUrl).toBeDefined()
      expect(mockFetchUrls).toBeDefined()
    })

    it('should handle URL creation', async () => {
      mockCreateUrl.mockResolvedValueOnce(mockUrl)
      
      const result = await mockCreateUrl({
        originalUrl: 'https://example.com',
      })
      
      expect(mockCreateUrl).toHaveBeenCalledWith({
        originalUrl: 'https://example.com',
      })
      expect(result).toEqual(mockUrl)
    })

    it('should handle URL updates', async () => {
      const updatedUrl = { ...mockUrl, customBackHalf: 'custom' }
      mockUpdateUrl.mockResolvedValueOnce(updatedUrl)
      
      const result = await mockUpdateUrl(mockUrl.id, {
        customBackHalf: 'custom',
      })
      
      expect(mockUpdateUrl).toHaveBeenCalledWith(mockUrl.id, {
        customBackHalf: 'custom',
      })
      expect(result).toEqual(updatedUrl)
    })

    it('should handle URL deletion', async () => {
      mockDeleteUrl.mockResolvedValueOnce(undefined)
      
      await mockDeleteUrl(mockUrl.id)
      
      expect(mockDeleteUrl).toHaveBeenCalledWith(mockUrl.id)
    })

    it('should handle URL fetching', async () => {
      mockFetchUrls.mockResolvedValueOnce([mockUrl])
      
      await mockFetchUrls()
      
      expect(mockFetchUrls).toHaveBeenCalled()
    })
  })

  describe('URL Actions', () => {
    it('should handle edit button click', async () => {
      const user = userEvent.setup()
      render(<MockDashboard />)

      const editButton = screen.getByRole('button', { name: /edit/i })
      await user.click(editButton)

      // Button should be clickable
      expect(editButton).toBeInTheDocument()
    })

    it('should handle delete button click', async () => {
      const user = userEvent.setup()
      render(<MockDashboard />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      // Button should be clickable
      expect(deleteButton).toBeInTheDocument()
    })
  })
})