# Testing the Bug Fixes

This guide explains how to test all the bug fixes and verify the API integration works correctly.

## Prerequisites

1. **Node.js** (v18 or higher)
2. **MongoDB** (running locally or via Docker)
3. **Redis** (optional but recommended for backend caching)

## Setup

### 1. Install Dependencies

```bash
# Install all dependencies
cd /path/to/URL-Shortener-App
npm install

# Or install individually
cd nextjs-frontend && npm install
cd ../nestjs-backend && npm install
```

### 2. Configure Backend

Create `.env` file in `nestjs-backend/` directory:

```env
# Database
DB_URL=mongodb://localhost:27017/url-shortener

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production
JWT_REFRESH_EXPIRES_IN=7d

# Server
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000
API_PREFIX=api/v1

# CORS
CORS_ORIGIN=http://localhost:3001
CORS_CREDENTIALS=true

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100

# Email (optional for testing)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=your-email@example.com
EMAIL_PASSWORD=your-password
EMAIL_FROM=noreply@snapurl.com

# Redis (optional)
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Configure Frontend

Create `.env.local` file in `nextjs-frontend/` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=SnapURL
NEXT_PUBLIC_APP_DESCRIPTION=The Beginner-Friendly URL Shortener
NEXT_PUBLIC_ENVIRONMENT=development
NEXT_PUBLIC_ENABLE_ANALYTICS=true
NEXT_PUBLIC_ENABLE_QR_CODES=true
NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS=true
NEXT_PUBLIC_ENABLE_PWA=true
```

## Running the Application

### Start Backend

```bash
cd nestjs-backend
npm run start:dev
```

Backend will start on `http://localhost:3000`

Verify backend is running:
```bash
curl http://localhost:3000/health
```

### Start Frontend

```bash
cd nextjs-frontend
npm run dev
```

Frontend will start on `http://localhost:3001`

## Testing the Fixes

### Option 1: Automated E2E Tests (Recommended)

The E2E tests will automatically test all the fixed bugs.

```bash
cd nextjs-frontend

# Make sure backend is running first!

# Run E2E tests
npm run test:e2e

# Run with UI (easier to debug)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Run specific test
npx playwright test tests/e2e/api-integration.spec.ts
```

**Expected Results:**
- All 21 tests should pass
- Tests verify:
  - User registration and login
  - Profile management
  - URL CRUD operations
  - URL features (password, activation, analytics)
  - Token refresh
  - Error handling

### Option 2: Manual Testing

#### Test 1: User Registration (Bug Fix #1)
1. Navigate to http://localhost:3001/register
2. Fill in the form:
   - Name: Test User
   - Email: test@example.com
   - Password: Test123!@#
3. Click "Create Account"
4. ✅ Should successfully register and redirect to dashboard
5. ✅ Check browser console - no errors

#### Test 2: Login and Profile (Bug Fixes #2, #3)
1. Navigate to http://localhost:3001/login
2. Login with credentials from Test 1
3. ✅ Should successfully login
4. Navigate to profile page
5. ✅ Profile should load correctly (using POST /auth/profile)
6. Update your name
7. ✅ Profile should update (using PATCH /users/profile)

#### Test 3: Password Change (Bug Fix - New Feature)
1. While logged in, go to settings/profile
2. Find "Change Password" section
3. Enter:
   - Current Password: Test123!@#
   - New Password: NewTest123!@#
4. Click "Change Password"
5. ✅ Password should change successfully
6. ✅ Should be logged out from all sessions
7. Login again with new password
8. ✅ Should login successfully

#### Test 4: URL Creation and Update (Bug Fix #2)
1. Navigate to dashboard
2. Create a new URL:
   - Original URL: https://www.example.com
   - Title: Example Site
3. ✅ URL should be created
4. Click on the URL to edit
5. Update the title to "Updated Example"
6. ✅ Should update successfully (using PATCH /urls/:id)

#### Test 5: URL Password Protection (Bug Fix - New Feature)
1. Select a URL from your list
2. Click "Set Password"
3. Enter password: SecurePass123
4. ✅ Password should be set
5. Click "Remove Password"
6. ✅ Password should be removed (using DELETE /urls/:id/password)

#### Test 6: Token Refresh (Bug Fix #7)
1. Login to the app
2. Wait for access token to expire (default 1 hour, or modify JWT_EXPIRES_IN to 1m for testing)
3. Try to access a protected resource
4. ✅ Token should automatically refresh
5. ✅ Request should succeed with new token

#### Test 7: Logout (Bug Fixes #5, #6)
1. Click "Logout"
2. ✅ Should logout successfully (using POST /auth/logout with refresh_token)
3. Try accessing dashboard
4. ✅ Should redirect to login page

#### Test 8: Logout All Devices (Bug Fix #6)
1. Login from multiple browsers/devices
2. Click "Logout from all devices"
3. ✅ Should logout from all sessions (using POST /auth/logout-all)
4. Verify other sessions are invalid

#### Test 9: Password Reset (Bug Fix #8)
1. Go to forgot password page
2. Enter email
3. ✅ Should send reset email
4. Check backend logs for reset token (in dev mode)
5. Use token to reset password
6. ✅ Should reset successfully (using newPassword field)

### Option 3: API Testing with curl

Test the fixed endpoints directly:

#### Register
```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "name": "Test User"
  }'
```

#### Login
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }'
```

#### Get Profile (POST method)
```bash
curl -X POST http://localhost:3000/api/v1/auth/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### Update Profile (PATCH /users/profile)
```bash
curl -X PATCH http://localhost:3000/api/v1/users/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name"
  }'
```

#### Create URL
```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originalUrl": "https://www.example.com",
    "title": "Example Site"
  }'
```

#### Update URL (PATCH method)
```bash
curl -X PATCH http://localhost:3000/api/v1/urls/YOUR_URL_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title"
  }'
```

#### Set URL Password
```bash
curl -X PUT http://localhost:3000/api/v1/urls/YOUR_URL_ID/password \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "SecurePass123"
  }'
```

#### Remove URL Password (NEW)
```bash
curl -X DELETE http://localhost:3000/api/v1/urls/YOUR_URL_ID/password \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### Change Password (NEW)
```bash
curl -X POST http://localhost:3000/api/v1/auth/change-password \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "Test123!@#",
    "newPassword": "NewTest123!@#"
  }'
```

#### Refresh Token (refresh_token field)
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "YOUR_REFRESH_TOKEN"
  }'
```

#### Logout (refresh_token field)
```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "refresh_token": "YOUR_REFRESH_TOKEN"
  }'
```

## Troubleshooting

### Backend won't start
- Check MongoDB is running: `mongosh` or `mongo`
- Check .env file exists and has correct values
- Check port 3000 is not in use: `lsof -i :3000`

### Frontend won't start
- Check .env.local file exists
- Check port 3001 is not in use: `lsof -i :3001`
- Clear Next.js cache: `rm -rf .next`

### E2E tests fail
- Ensure backend is running first
- Ensure frontend dev server is running
- Check backend URL is correct in .env.local
- Try running tests with --headed to see what's happening
- Check browser console for errors

### API requests fail with CORS errors
- Check CORS_ORIGIN in backend .env matches frontend URL
- Ensure CORS_CREDENTIALS=true
- Clear browser cache

### Token refresh not working
- Check JWT_REFRESH_SECRET is set in backend .env
- Check refresh token is being stored in frontend
- Check browser localStorage for tokens

## Verifying All Fixes

Run this checklist to verify all bugs are fixed:

- [ ] TypeScript compiles without errors
- [ ] User can register successfully
- [ ] User can login successfully
- [ ] Profile loads with POST method
- [ ] Profile updates with PATCH to /users/profile
- [ ] URLs update with PATCH method
- [ ] Password can be set on URLs
- [ ] Password can be removed from URLs
- [ ] User can change their password
- [ ] Token refresh uses refresh_token field
- [ ] Logout uses refresh_token field
- [ ] Logout all devices works
- [ ] Password reset uses newPassword field
- [ ] All E2E tests pass

## Test Results

After running the tests, you should see:

```
✅ 21 passed (api-integration.spec.ts)
✅ All authentication flows working
✅ All URL operations working
✅ All security features working
```

## Getting Help

If you encounter issues:

1. Check the logs:
   - Backend: Check terminal where backend is running
   - Frontend: Check browser console
   - Tests: Check Playwright test output

2. Review documentation:
   - API_INTEGRATION.md - API reference
   - BUG_FIXES_SUMMARY.md - What was fixed

3. Check GitHub Issues:
   - Create an issue with error details
   - Include logs and steps to reproduce

## Clean Up

After testing:

```bash
# Stop servers (Ctrl+C in terminals)

# Clean up test data (optional)
mongo url-shortener --eval "db.dropDatabase()"

# Remove .env files if needed (but keep as templates)
```
