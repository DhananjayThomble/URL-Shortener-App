# Integration Testing Documentation

This directory contains comprehensive integration tests for the SnapURL Next.js frontend application.

## Test Structure

```
src/__tests__/
├── integration/           # Integration test suites
│   ├── auth.test.tsx             # Authentication flow tests
│   ├── url-management.test.tsx   # URL management tests
│   ├── admin-panel.test.tsx      # Admin panel tests
│   ├── profile-management.test.tsx # Profile management tests
│   └── error-handling.test.tsx   # Error handling and edge cases
├── mocks/                # Mock service worker setup
│   ├── handlers.ts              # API mock handlers
│   └── server.ts               # MSW server setup
├── utils/                # Test utilities
│   └── test-utils.tsx          # Custom render and test helpers
└── README.md            # This file
```

## Running Tests

### All Tests
```bash
npm test
```

### Integration Tests Only
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Test Categories

### 1. Authentication Tests (`auth.test.tsx`)
- **Login Flow**: Valid/invalid credentials, form validation, loading states
- **Registration Flow**: User registration, password confirmation, error handling
- **API Integration**: Success/error responses, network errors
- **Token Management**: Token refresh, expiration handling

### 2. URL Management Tests (`url-management.test.tsx`)
- **URL Creation**: Form validation, custom back-half, category selection
- **URL Management**: CRUD operations, bulk actions, search/filtering
- **Analytics Integration**: Fetching and displaying URL analytics
- **Error Handling**: API errors, validation errors, network issues

### 3. Admin Panel Tests (`admin-panel.test.tsx`)
- **Dashboard**: System stats, health monitoring, real-time updates
- **User Management**: User list, search, deactivation, pagination
- **Admin Management**: CRUD operations for admin users
- **Role-based Access**: Permission checks, unauthorized access

### 4. Profile Management Tests (`profile-management.test.tsx`)
- **Profile Settings**: Edit profile, form validation, error handling
- **Security Settings**: Password change, email verification, session management
- **Account Settings**: Data export, account deletion, usage statistics
- **Navigation**: Tab switching, form state management

### 5. Error Handling Tests (`error-handling.test.tsx`)
- **Network Errors**: Timeouts, connection issues, DNS failures
- **HTTP Errors**: 400, 401, 403, 404, 409, 429, 500, 502, 503
- **Token Issues**: Expiration, refresh failures
- **Edge Cases**: Malformed responses, empty data, memory issues

## Mock Service Worker (MSW)

The tests use MSW to mock API responses, providing:

- **Realistic API Simulation**: Mimics actual backend behavior
- **Error Scenario Testing**: Simulates various error conditions
- **Offline Testing**: No dependency on actual backend services
- **Consistent Test Data**: Predictable responses for reliable tests

### Mock Handlers

Located in `mocks/handlers.ts`, covering:
- Authentication endpoints
- User management endpoints
- URL management endpoints
- Admin panel endpoints
- Error simulation endpoints

## Test Utilities

### Custom Render Function
```typescript
import { render } from '../utils/test-utils'

// Automatically wraps components with providers
render(<MyComponent />)
```

### Mock Data
```typescript
import { mockUser, mockUrl, mockAnalytics } from '../utils/test-utils'
```

### Store Mocks
```typescript
import { createMockAuthStore, createMockUrlStore } from '../utils/test-utils'
```

## Best Practices

### 1. Test Structure
- **Arrange**: Set up test data and mocks
- **Act**: Perform user interactions
- **Assert**: Verify expected outcomes

### 2. User-Centric Testing
- Use `userEvent` for realistic interactions
- Test from user's perspective, not implementation details
- Focus on behavior, not internal state

### 3. Async Testing
- Use `waitFor` for async operations
- Test loading states and error conditions
- Handle race conditions properly

### 4. Mock Management
- Reset mocks between tests
- Use specific mocks for specific scenarios
- Keep mocks simple and focused

### 5. Error Testing
- Test both happy path and error scenarios
- Verify error messages and recovery flows
- Test network failures and edge cases

## Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

## Continuous Integration

Tests run automatically on:
- Pull requests
- Main branch commits
- Release builds

## Debugging Tests

### Running Single Test
```bash
npm test -- --testNamePattern="should login successfully"
```

### Debug Mode
```bash
npm test -- --detectOpenHandles --forceExit
```

### Verbose Output
```bash
npm test -- --verbose
```

## Common Issues

### 1. MSW Not Working
- Ensure server is started in `jest.setup.js`
- Check handler URLs match API calls
- Verify request methods (GET, POST, etc.)

### 2. Async Test Failures
- Use `waitFor` for async operations
- Check for proper cleanup in `useEffect`
- Verify mock promises resolve/reject correctly

### 3. Component Not Rendering
- Check for missing providers in test setup
- Verify imports are correct
- Ensure mocks are properly configured

### 4. Store Mock Issues
- Reset store mocks between tests
- Use correct mock return values
- Verify store selectors are mocked

## Contributing

When adding new tests:

1. Follow existing patterns and structure
2. Add appropriate mock handlers for new API endpoints
3. Test both success and error scenarios
4. Update this documentation if needed
5. Ensure tests are deterministic and isolated

## Resources

- [Testing Library Documentation](https://testing-library.com/)
- [Jest Documentation](https://jestjs.io/)
- [MSW Documentation](https://mswjs.io/)
- [React Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)