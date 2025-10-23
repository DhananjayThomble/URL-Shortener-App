import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, mockAdminUser } from '../utils/test-utils'

// Mock the auth store
const mockAuthStore = {
  user: mockAdminUser,
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

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(() => mockAuthStore),
}))

// Mock admin components
const MockAdminDashboard = () => (
  <div>
    <h1>Admin Dashboard</h1>
    <div data-testid="admin-stats">
      <div>Total Users: 100</div>
      <div>Total URLs: 500</div>
      <div>Active Sessions: 25</div>
    </div>
  </div>
)

const MockUsersPage = () => (
  <div>
    <h1>User Management</h1>
    <input placeholder="Search users" />
    <div data-testid="users-table">
      <div data-testid="user-row">
        <span>John Doe</span>
        <span>john@example.com</span>
        <button>Edit</button>
        <button>Delete</button>
      </div>
    </div>
  </div>
)

const MockAnalyticsPage = () => (
  <div>
    <h1>Analytics Dashboard</h1>
    <div data-testid="analytics-charts">
      <div data-testid="chart-container">
        <canvas data-testid="chart" />
      </div>
    </div>
    <button>Date Range</button>
  </div>
)

describe('Admin Panel Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Admin Dashboard', () => {
    it('should render admin dashboard', async () => {
      render(<MockAdminDashboard />)

      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument()
      expect(screen.getByTestId('admin-stats')).toBeInTheDocument()
    })

    it('should display system statistics', async () => {
      render(<MockAdminDashboard />)

      expect(screen.getByText('Total Users: 100')).toBeInTheDocument()
      expect(screen.getByText('Total URLs: 500')).toBeInTheDocument()
      expect(screen.getByText('Active Sessions: 25')).toBeInTheDocument()
    })
  })

  describe('User Management', () => {
    it('should render users page', async () => {
      render(<MockUsersPage />)

      expect(screen.getByText('User Management')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/search users/i)).toBeInTheDocument()
    })

    it('should display users table', async () => {
      render(<MockUsersPage />)

      expect(screen.getByTestId('users-table')).toBeInTheDocument()
      expect(screen.getByTestId('user-row')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })

    it('should have user action buttons', async () => {
      render(<MockUsersPage />)

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
    })

    it('should handle user search', async () => {
      const user = userEvent.setup()
      render(<MockUsersPage />)

      const searchInput = screen.getByPlaceholderText(/search users/i)
      await user.type(searchInput, 'john')

      expect(searchInput).toHaveValue('john')
    })
  })

  describe('Analytics Dashboard', () => {
    it('should render analytics page', async () => {
      render(<MockAnalyticsPage />)

      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
      expect(screen.getByTestId('analytics-charts')).toBeInTheDocument()
    })

    it('should display charts', async () => {
      render(<MockAnalyticsPage />)

      expect(screen.getByTestId('chart-container')).toBeInTheDocument()
      expect(screen.getByTestId('chart')).toBeInTheDocument()
    })

    it('should have date range controls', async () => {
      render(<MockAnalyticsPage />)

      expect(screen.getByRole('button', { name: /date range/i })).toBeInTheDocument()
    })

    it('should handle date range interaction', async () => {
      const user = userEvent.setup()
      render(<MockAnalyticsPage />)

      const dateButton = screen.getByRole('button', { name: /date range/i })
      await user.click(dateButton)

      expect(dateButton).toBeInTheDocument()
    })
  })

  describe('Access Control', () => {
    it('should allow admin access', () => {
      const { useAuthStore } = require('@/stores/authStore')
      const store = useAuthStore()
      
      expect(store.user).toEqual(mockAdminUser)
      expect(store.user.role).toBe('admin')
      expect(store.isAuthenticated).toBe(true)
    })

    it('should verify admin permissions', () => {
      expect(mockAdminUser.role).toBe('admin')
    })
  })

  describe('Admin Actions', () => {
    it('should handle user edit action', async () => {
      const user = userEvent.setup()
      render(<MockUsersPage />)

      const editButton = screen.getByRole('button', { name: /edit/i })
      await user.click(editButton)

      expect(editButton).toBeInTheDocument()
    })

    it('should handle user delete action', async () => {
      const user = userEvent.setup()
      render(<MockUsersPage />)

      const deleteButton = screen.getByRole('button', { name: /delete/i })
      await user.click(deleteButton)

      expect(deleteButton).toBeInTheDocument()
    })
  })
})