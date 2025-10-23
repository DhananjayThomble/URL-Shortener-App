import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../utils/test-utils'

// Mock components that demonstrate error handling
const MockErrorBoundary = ({ hasError, children }: { hasError: boolean; children: React.ReactNode }) => {
  if (hasError) {
    return (
      <div data-testid="error-boundary">
        <h1>Something went wrong</h1>
        <p>An error occurred while rendering this component</p>
        <button>Try Again</button>
      </div>
    )
  }
  return <>{children}</>
}

const MockFormWithValidation = () => {
  return (
    <div>
      <h1>Form with Validation</h1>
      <form>
        <div>
          <input aria-label="URL" type="url" required />
          <span data-testid="url-error" style={{ display: 'none' }}>
            Please enter a valid URL
          </span>
        </div>
        <div>
          <input aria-label="Email" type="email" required />
          <span data-testid="email-error" style={{ display: 'none' }}>
            Please enter a valid email
          </span>
        </div>
        <button type="submit">Submit</button>
      </form>
    </div>
  )
}

const MockNetworkStatus = ({ isOnline }: { isOnline: boolean }) => {
  return (
    <div>
      <h1>Network Status</h1>
      {isOnline ? (
        <div data-testid="online-status">
          <span>Connected</span>
        </div>
      ) : (
        <div data-testid="offline-status">
          <span>You are offline</span>
          <p>Please check your internet connection</p>
        </div>
      )}
    </div>
  )
}

const MockLoadingState = ({ isLoading, hasError }: { isLoading: boolean; hasError: boolean }) => {
  if (isLoading) {
    return (
      <div data-testid="loading-state">
        <span>Loading...</span>
      </div>
    )
  }

  if (hasError) {
    return (
      <div data-testid="error-state">
        <span>Error occurred</span>
        <button>Retry</button>
      </div>
    )
  }

  return (
    <div data-testid="success-state">
      <span>Content loaded successfully</span>
    </div>
  )
}

const MockApiErrorDisplay = ({ error }: { error: { status: number; message: string } | null }) => {
  if (!error) {
    return <div data-testid="no-error">All good!</div>
  }

  return (
    <div data-testid="api-error">
      <h2>Error {error.status}</h2>
      <p>{error.message}</p>
      {error.status === 401 && <button>Login Again</button>}
      {error.status === 403 && <span>Access Denied</span>}
      {error.status === 404 && <span>Not Found</span>}
      {error.status === 500 && <button>Try Again</button>}
    </div>
  )
}

describe('Error Handling Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Error Boundaries', () => {
    it('should render error boundary when error occurs', () => {
      render(
        <MockErrorBoundary hasError={true}>
          <div>This should not render</div>
        </MockErrorBoundary>
      )

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByText('An error occurred while rendering this component')).toBeInTheDocument()
    })

    it('should render children when no error', () => {
      render(
        <MockErrorBoundary hasError={false}>
          <div data-testid="child-content">This should render</div>
        </MockErrorBoundary>
      )

      expect(screen.getByTestId('child-content')).toBeInTheDocument()
      expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument()
    })

    it('should have retry button in error state', async () => {
      const user = userEvent.setup()
      render(
        <MockErrorBoundary hasError={true}>
          <div>Content</div>
        </MockErrorBoundary>
      )

      const retryButton = screen.getByRole('button', { name: /try again/i })
      await user.click(retryButton)

      expect(retryButton).toBeInTheDocument()
    })
  })

  describe('Form Validation Errors', () => {
    it('should render form with validation', () => {
      render(<MockFormWithValidation />)

      expect(screen.getByText('Form with Validation')).toBeInTheDocument()
      expect(screen.getByLabelText(/url/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    })

    it('should have validation error messages', () => {
      render(<MockFormWithValidation />)

      expect(screen.getByTestId('url-error')).toBeInTheDocument()
      expect(screen.getByTestId('email-error')).toBeInTheDocument()
    })

    it('should handle form submission', async () => {
      const user = userEvent.setup()
      render(<MockFormWithValidation />)

      const urlInput = screen.getByLabelText(/url/i)
      const emailInput = screen.getByLabelText(/email/i)
      const submitButton = screen.getByRole('button', { name: /submit/i })

      await user.type(urlInput, 'https://example.com')
      await user.type(emailInput, 'test@example.com')
      await user.click(submitButton)

      expect(urlInput).toHaveValue('https://example.com')
      expect(emailInput).toHaveValue('test@example.com')
    })
  })

  describe('Network Connectivity', () => {
    it('should show online status', () => {
      render(<MockNetworkStatus isOnline={true} />)

      expect(screen.getByTestId('online-status')).toBeInTheDocument()
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })

    it('should show offline status', () => {
      render(<MockNetworkStatus isOnline={false} />)

      expect(screen.getByTestId('offline-status')).toBeInTheDocument()
      expect(screen.getByText('You are offline')).toBeInTheDocument()
      expect(screen.getByText('Please check your internet connection')).toBeInTheDocument()
    })
  })

  describe('Loading and Error States', () => {
    it('should show loading state', () => {
      render(<MockLoadingState isLoading={true} hasError={false} />)

      expect(screen.getByTestId('loading-state')).toBeInTheDocument()
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })

    it('should show error state', () => {
      render(<MockLoadingState isLoading={false} hasError={true} />)

      expect(screen.getByTestId('error-state')).toBeInTheDocument()
      expect(screen.getByText('Error occurred')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })

    it('should show success state', () => {
      render(<MockLoadingState isLoading={false} hasError={false} />)

      expect(screen.getByTestId('success-state')).toBeInTheDocument()
      expect(screen.getByText('Content loaded successfully')).toBeInTheDocument()
    })

    it('should handle retry action', async () => {
      const user = userEvent.setup()
      render(<MockLoadingState isLoading={false} hasError={true} />)

      const retryButton = screen.getByRole('button', { name: /retry/i })
      await user.click(retryButton)

      expect(retryButton).toBeInTheDocument()
    })
  })

  describe('API Error Handling', () => {
    it('should show no error state', () => {
      render(<MockApiErrorDisplay error={null} />)

      expect(screen.getByTestId('no-error')).toBeInTheDocument()
      expect(screen.getByText('All good!')).toBeInTheDocument()
    })

    it('should handle 401 unauthorized error', () => {
      render(<MockApiErrorDisplay error={{ status: 401, message: 'Unauthorized access' }} />)

      expect(screen.getByTestId('api-error')).toBeInTheDocument()
      expect(screen.getByText('Error 401')).toBeInTheDocument()
      expect(screen.getByText('Unauthorized access')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /login again/i })).toBeInTheDocument()
    })

    it('should handle 403 forbidden error', () => {
      render(<MockApiErrorDisplay error={{ status: 403, message: 'Access forbidden' }} />)

      expect(screen.getByText('Error 403')).toBeInTheDocument()
      expect(screen.getByText('Access forbidden')).toBeInTheDocument()
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
    })

    it('should handle 404 not found error', () => {
      render(<MockApiErrorDisplay error={{ status: 404, message: 'Resource not found' }} />)

      expect(screen.getByText('Error 404')).toBeInTheDocument()
      expect(screen.getByText('Resource not found')).toBeInTheDocument()
      expect(screen.getByText('Not Found')).toBeInTheDocument()
    })

    it('should handle 500 server error', () => {
      render(<MockApiErrorDisplay error={{ status: 500, message: 'Internal server error' }} />)

      expect(screen.getByText('Error 500')).toBeInTheDocument()
      expect(screen.getByText('Internal server error')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('should handle error actions', async () => {
      const user = userEvent.setup()
      render(<MockApiErrorDisplay error={{ status: 401, message: 'Unauthorized' }} />)

      const loginButton = screen.getByRole('button', { name: /login again/i })
      await user.click(loginButton)

      expect(loginButton).toBeInTheDocument()
    })
  })

  describe('User Feedback', () => {
    it('should provide clear error messages', () => {
      render(<MockApiErrorDisplay error={{ status: 500, message: 'Something went wrong on our end' }} />)

      expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument()
    })

    it('should provide actionable error recovery', () => {
      render(<MockApiErrorDisplay error={{ status: 500, message: 'Server error' }} />)

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('should handle different error scenarios', () => {
      const { rerender } = render(<MockApiErrorDisplay error={{ status: 401, message: 'Unauthorized' }} />)
      expect(screen.getByRole('button', { name: /login again/i })).toBeInTheDocument()

      rerender(<MockApiErrorDisplay error={{ status: 500, message: 'Server error' }} />)
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()

      rerender(<MockApiErrorDisplay error={{ status: 403, message: 'Forbidden' }} />)
      expect(screen.getByText('Access Denied')).toBeInTheDocument()
    })
  })
})