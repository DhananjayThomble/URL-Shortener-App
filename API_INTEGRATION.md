# API Integration Documentation

This document describes the API endpoints used by the Next.js frontend and how they integrate with the NestJS backend.

## Base Configuration

- **Frontend**: `http://localhost:3001`
- **Backend**: `http://localhost:3000`
- **API Base Path**: `/api/v1`
- **Full API URL**: `http://localhost:3000/api/v1`

## Authentication Endpoints

### Register User
```
POST /api/v1/auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Password123!",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user",
    "lastLogin": "2024-01-01T00:00:00.000Z"
  }
}
```

### Login
```
POST /api/v1/auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "Password123!"
}
```

**Response (200):** Same as register

### Get Profile
```
POST /api/v1/auth/profile
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "role": "user",
  "isEmailVerified": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### Refresh Token
```
POST /api/v1/auth/refresh
```

**Request Body:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Logout
```
POST /api/v1/auth/logout
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "message": "Successfully logged out"
}
```

### Logout All Devices
```
POST /api/v1/auth/logout-all
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "message": "Successfully logged out from all devices"
}
```

### Forgot Password
```
POST /api/v1/auth/forgot-password
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "message": "Password reset email sent if email exists"
}
```

### Reset Password
```
POST /api/v1/auth/reset-password
```

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "newPassword": "NewPassword123!"
}
```

**Response (200):**
```json
{
  "message": "Password has been reset successfully. Please log in with your new password."
}
```

### Change Password
```
POST /api/v1/auth/change-password
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "currentPassword": "OldPassword123!",
  "newPassword": "NewPassword123!"
}
```

**Response (200):**
```json
{
  "message": "Password has been changed successfully. Please log in with your new password."
}
```

## URL Management Endpoints

### Create URL
```
POST /api/v1/urls
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "originalUrl": "https://www.example.com",
  "title": "Example Website",
  "tags": ["example", "test"],
  "customBackHalf": "my-custom-url",
  "expiresAt": "2024-12-31T23:59:59.000Z"
}
```

**Response (201):**
```json
{
  "id": "uuid",
  "originalUrl": "https://www.example.com",
  "shortCode": "abc123",
  "shortUrl": "http://localhost:3000/r/abc123",
  "title": "Example Website",
  "tags": ["example", "test"],
  "clicks": 0,
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### List URLs
```
GET /api/v1/urls?page=1&limit=10
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "uuid",
      "originalUrl": "https://www.example.com",
      "shortCode": "abc123",
      "shortUrl": "http://localhost:3000/r/abc123",
      "title": "Example Website",
      "clicks": 42,
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10
  }
}
```

### Get URL by ID
```
GET /api/v1/urls/{id}
Authorization: Bearer {access_token}
```

**Response (200):** Single URL object

### Update URL
```
PATCH /api/v1/urls/{id}
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "title": "Updated Title",
  "tags": ["updated", "tags"]
}
```

**Response (200):** Updated URL object

### Delete URL
```
DELETE /api/v1/urls/{id}
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "message": "URL deleted successfully"
}
```

### Get URL Analytics
```
GET /api/v1/urls/{id}/analytics?period=7d
Authorization: Bearer {access_token}
```

**Query Parameters:**
- `period`: `24h`, `7d`, `30d`, `90d`

**Response (200):**
```json
{
  "clicks": 42,
  "uniqueVisitors": 30,
  "clicksByDate": [
    { "date": "2024-01-01", "clicks": 10 }
  ],
  "clicksByCountry": [
    { "country": "US", "clicks": 20 }
  ],
  "clicksByDevice": [
    { "device": "mobile", "clicks": 25 }
  ],
  "clicksByBrowser": [
    { "browser": "Chrome", "clicks": 30 }
  ]
}
```

### Set URL Password
```
PUT /api/v1/urls/{id}/password
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "password": "SecurePassword123"
}
```

**Response (200):** Updated URL object

### Remove URL Password
```
DELETE /api/v1/urls/{id}/password
Authorization: Bearer {access_token}
```

**Response (200):** Updated URL object

### Deactivate URL
```
PUT /api/v1/urls/{id}/deactivate
Authorization: Bearer {access_token}
```

**Response (200):** Updated URL object with `isActive: false`

### Reactivate URL
```
PUT /api/v1/urls/{id}/reactivate
Authorization: Bearer {access_token}
```

**Response (200):** Updated URL object with `isActive: true`

### Bulk Create URLs
```
POST /api/v1/urls/bulk
Authorization: Bearer {access_token}
```

**Request Body:**
```json
[
  {
    "originalUrl": "https://www.google.com",
    "title": "Google"
  },
  {
    "originalUrl": "https://www.github.com",
    "title": "GitHub"
  }
]
```

**Response (201):** Array of created URL objects

### Get Popular URLs
```
GET /api/v1/urls/popular/top?limit=10
Authorization: Bearer {access_token}
```

**Response (200):** Array of top performing URLs

## User Management Endpoints

### Get User Profile
```
GET /api/v1/users/profile
Authorization: Bearer {access_token}
```

**Response (200):** User object

### Update User Profile
```
PATCH /api/v1/users/profile
Authorization: Bearer {access_token}
```

**Request Body:**
```json
{
  "name": "Updated Name"
}
```

**Response (200):** Updated user object

### Verify Email
```
POST /api/v1/users/verify-email
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "message": "Email verified successfully"
}
```

## Admin Endpoints

### Get Dashboard Stats
```
GET /api/v1/admin/dashboard
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "users": {
    "total": 1000,
    "newThisMonth": 50,
    "activeThisWeek": 300
  },
  "urls": {
    "total": 5000,
    "createdThisMonth": 200,
    "totalClicks": 100000
  },
  "analytics": {
    "clicksToday": 1000,
    "clicksThisWeek": 7000,
    "topCountries": [
      { "country": "US", "clicks": 50000 }
    ],
    "topDevices": [
      { "device": "mobile", "clicks": 60000 }
    ]
  },
  "system": {
    "cacheHitRate": 0.95,
    "avgResponseTime": 50,
    "uptime": 99.9
  }
}
```

### Get All Users
```
GET /api/v1/admin/users?page=1&limit=20
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "name": "John Doe",
      "isEmailVerified": true,
      "role": "user",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "lastLoginAt": "2024-01-01T00:00:00.000Z",
      "urlCount": 10,
      "totalClicks": 100
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1000,
    "pages": 50
  }
}
```

### Get Audit Logs
```
GET /api/v1/admin/audit-logs?limit=100
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "logs": [
    {
      "id": "uuid",
      "adminId": "admin-uuid",
      "action": "user_deactivated",
      "resource": "user",
      "resourceId": "user-uuid",
      "details": { "reason": "Terms violation" },
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "total": 1000
}
```

## Error Responses

All endpoints may return standard error responses:

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Invalid credentials",
  "error": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Insufficient permissions",
  "error": "Forbidden"
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Resource not found",
  "error": "Not Found"
}
```

### 429 Too Many Requests
```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "error": "Too Many Requests"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

## Rate Limiting

The following rate limits are applied:

- **Authentication endpoints** (`/auth/login`, `/auth/register`): 5 requests per 15 minutes
- **Password reset** (`/auth/forgot-password`): 3 requests per 15 minutes
- **URL creation** (`/urls`): 10 requests per minute
- **URL redirection** (`/r/:shortCode`): 100 requests per minute

## Authentication

Most endpoints require authentication via Bearer token:

```
Authorization: Bearer {access_token}
```

Tokens are obtained via login/register and should be included in the Authorization header for protected endpoints.

## Frontend Integration

The frontend uses the following configuration in `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

API calls are made through the `apiClient` which automatically:
- Adds the `Authorization` header with the access token
- Handles token refresh on 401 errors
- Transforms responses to a consistent format
- Provides error handling and logging

## Testing

End-to-end API integration tests are located in:
```
nextjs-frontend/tests/e2e/api-integration.spec.ts
```

To run the tests:
```bash
cd nextjs-frontend
npm run test:e2e
```

Tests require both frontend and backend servers to be running.
