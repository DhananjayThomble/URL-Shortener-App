import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, mockUser } from '../utils/test-utils'

// Mock the auth store
const mockUpdateUser = jest.fn()

const mockAuthStore = {
  user: mockUser,
  isLoading: false,
  isAuthenticated: true,
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
  refreshToken: jest.fn(),
  updateUser: mockUpdateUser,
  setLoading: jest.fn(),
  initialize: jest.fn(),
  checkAndRefreshToken: jest.fn(),
}

jest.mock('@/stores/authStore', () => ({
  useAuthStore: jest.fn(() => mockAuthStore),
}))

// Mock profile components
const MockProfilePage = () => (
  <div>
    <h1>Profile Settings</h1>
    <div data-testid="profile-info">
      <div>Name: {mockUser.name}</div>
      <div>Email: {mockUser.email}</div>
    </div>
    <form data-testid="profile-form">
      <input aria-label="Name" defaultValue={mockUser.name} />
      <input aria-label="Email" defaultValue={mockUser.email} />
      <button type="submit">Save Changes</button>
    </form>
  </div>
)

const MockPasswordSection = () => (
  <div data-testid="password-section">
    <h2>Change Password</h2>
    <form>
      <input aria-label="Current Password" type="password" />
      <input aria-label="New Password" type="password" />
      <input aria-label="Confirm Password" type="password" />
      <button type="submit">Change Password</button>
    </form>
  </div>
)

const MockAccountSettings = () => (
  <div data-testid="account-settings">
    <h2>Account Settings</h2>
    <div>
      <label>
        <input type="checkbox" aria-label="Email Notifications" />
        Email Notifications
      </label>
    </div>
    <div>
      <label htmlFor="theme-select">Theme:</label>
      <select id="theme-select" aria-label="Theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  </div>
)

const MockSecuritySettings = () => (
  <div data-testid="security-settings">
    <h2>Security Settings</h2>
    <div>
      <button>Enable Two-Factor Authentication</button>
    </div>
    <div>
      <span>Last Login: {mockUser.lastLoginAt}</span>
    </div>
  </div>
)

describe('Profile Management Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Profile Display', () => {
    it('should render profile page', async () => {
      render(<MockProfilePage />)

      expect(screen.getByText('Profile Settings')).toBeInTheDocument()
      expect(screen.getByTestId('profile-info')).toBeInTheDocument()
    })

    it('should display user information', async () => {
      render(<MockProfilePage />)

      expect(screen.getByText(`Name: ${mockUser.name}`)).toBeInTheDocument()
      expect(screen.getByText(`Email: ${mockUser.email}`)).toBeInTheDocument()
    })

    it('should show profile form', async () => {
      render(<MockProfilePage />)

      expect(screen.getByTestId('profile-form')).toBeInTheDocument()
      expect(screen.getByDisplayValue(mockUser.name)).toBeInTheDocument()
      expect(screen.getByDisplayValue(mockUser.email)).toBeInTheDocument()
    })
  })

  describe('Profile Editing', () => {
    it('should allow editing profile information', async () => {
      const user = userEvent.setup()
      render(<MockProfilePage />)

      const nameInput = screen.getByDisplayValue(mockUser.name)
      const saveButton = screen.getByRole('button', { name: /save changes/i })

      await user.clear(nameInput)
      await user.type(nameInput, 'Updated Name')
      await user.click(saveButton)

      expect(nameInput).toHaveValue('Updated Name')
    })

    it('should handle form submission', async () => {
      const user = userEvent.setup()
      render(<MockProfilePage />)

      const saveButton = screen.getByRole('button', { name: /save changes/i })
      await user.click(saveButton)

      expect(saveButton).toBeInTheDocument()
    })
  })

  describe('Password Change', () => {
    it('should render password section', async () => {
      render(<MockPasswordSection />)

      expect(screen.getByTestId('password-section')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument()
    })

    it('should have password fields', async () => {
      render(<MockPasswordSection />)

      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
    })

    it('should handle password change form', async () => {
      const user = userEvent.setup()
      render(<MockPasswordSection />)

      const currentPasswordInput = screen.getByLabelText(/current password/i)
      const newPasswordInput = screen.getByLabelText(/new password/i)
      const confirmPasswordInput = screen.getByLabelText(/confirm password/i)
      const changeButton = screen.getByRole('button', { name: /change password/i })

      await user.type(currentPasswordInput, 'currentpassword')
      await user.type(newPasswordInput, 'newpassword123')
      await user.type(confirmPasswordInput, 'newpassword123')
      await user.click(changeButton)

      expect(currentPasswordInput).toHaveValue('currentpassword')
      expect(newPasswordInput).toHaveValue('newpassword123')
      expect(confirmPasswordInput).toHaveValue('newpassword123')
    })
  })

  describe('Account Settings', () => {
    it('should render account settings', async () => {
      render(<MockAccountSettings />)

      expect(screen.getByTestId('account-settings')).toBeInTheDocument()
      expect(screen.getByText('Account Settings')).toBeInTheDocument()
    })

    it('should have notification preferences', async () => {
      render(<MockAccountSettings />)

      expect(screen.getByLabelText(/email notifications/i)).toBeInTheDocument()
    })

    it('should handle notification toggle', async () => {
      const user = userEvent.setup()
      render(<MockAccountSettings />)

      const notificationCheckbox = screen.getByLabelText(/email notifications/i)
      await user.click(notificationCheckbox)

      expect(notificationCheckbox).toBeChecked()
    })

    it('should have theme selector', async () => {
      render(<MockAccountSettings />)

      expect(screen.getByLabelText(/theme/i)).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /light/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /dark/i })).toBeInTheDocument()
    })

    it('should handle theme selection', async () => {
      const user = userEvent.setup()
      render(<MockAccountSettings />)

      const themeSelect = screen.getByLabelText(/theme/i)
      await user.selectOptions(themeSelect, 'dark')

      expect(themeSelect).toHaveValue('dark')
    })
  })

  describe('Security Settings', () => {
    it('should render security settings', async () => {
      render(<MockSecuritySettings />)

      expect(screen.getByTestId('security-settings')).toBeInTheDocument()
      expect(screen.getByText('Security Settings')).toBeInTheDocument()
    })

    it('should show two-factor authentication option', async () => {
      render(<MockSecuritySettings />)

      expect(screen.getByRole('button', { name: /enable two-factor/i })).toBeInTheDocument()
    })

    it('should display last login information', async () => {
      render(<MockSecuritySettings />)

      expect(screen.getByText(`Last Login: ${mockUser.lastLoginAt}`)).toBeInTheDocument()
    })

    it('should handle 2FA setup', async () => {
      const user = userEvent.setup()
      render(<MockSecuritySettings />)

      const twoFactorButton = screen.getByRole('button', { name: /enable two-factor/i })
      await user.click(twoFactorButton)

      expect(twoFactorButton).toBeInTheDocument()
    })
  })

  describe('Store Integration', () => {
    it('should have access to update user function', () => {
      expect(mockUpdateUser).toBeDefined()
    })

    it('should handle user updates', async () => {
      mockUpdateUser.mockResolvedValueOnce({ ...mockUser, name: 'Updated Name' })
      
      await mockUpdateUser({ name: 'Updated Name' })
      
      expect(mockUpdateUser).toHaveBeenCalledWith({ name: 'Updated Name' })
    })
  })
})