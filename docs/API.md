# SnapURL 2.0 - API Reference

> **Quick Reference**: Comprehensive API documentation for developers and AI tools

## Base URLs

| Environment | URL | Documentation |
|-------------|-----|---------------|
| **Production** | `https://snapurl.in/api/v1` | [Swagger Docs](https://snapurl.in/doc) |
| **Development** | `http://localhost:3000/api/v1` | [Local Swagger](http://localhost:3000/docs) |
| **Staging** | `https://staging.snapurl.in/api/v1` | N/A |

## Authentication

### JWT Token-Based Authentication

All protected endpoints require a valid JWT access token in the Authorization header:

```http
Authorization: Bearer <access_token>
```

### Token Lifecycle

| Token Type | Lifetime | Storage | Purpose |
|------------|----------|---------|---------|
| **Access Token** | 15 minutes | Frontend memory/localStorage | API requests |
| **Refresh Token** | 7 days | HTTP-only cookie / DB | Obtain new access token |

### Obtaining Tokens

**Login Request:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

**Response:**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "username": "johndoe",
    "role": "user"
  }
}
```

### Token Refresh

**Request:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

## API Endpoints

### Authentication & Users

#### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "johndoe",
  "password": "SecurePass123!"
}
```

**Response (201):**
```json
{
  "message": "Registration successful. Please check your email for verification.",
  "userId": "123e4567-e89b-12d3-a456-426614174000"
}
```

**Validation Rules:**
- Email: Valid email format, unique
- Username: 3-50 characters, alphanumeric + underscore, unique
- Password: Min 8 characters, must include uppercase, lowercase, number, special char

---

#### POST /auth/login
Authenticate user and receive JWT tokens.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "username": "johndoe",
    "role": "user",
    "emailVerified": true
  }
}
```

---

#### POST /auth/refresh
Refresh access token using refresh token.

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

#### POST /auth/verify-email
Verify email address with token from email.

**Request Body:**
```json
{
  "token": "verification-token-from-email"
}
```

**Response (200):**
```json
{
  "message": "Email verified successfully"
}
```

---

#### POST /auth/forgot-password
Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response (200):**
```json
{
  "message": "Password reset email sent. Check your inbox."
}
```

---

#### POST /auth/reset-password
Reset password using token from email.

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "newPassword": "NewSecurePass123!"
}
```

**Response (200):**
```json
{
  "message": "Password reset successful"
}
```

---

#### GET /users/me
Get current authenticated user profile.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "username": "johndoe",
  "role": "user",
  "emailVerified": true,
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

#### PUT /users/me
Update current user profile.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "username": "newusername",
  "email": "newemail@example.com"
}
```

**Response (200):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "newemail@example.com",
  "username": "newusername",
  "role": "user"
}
```

---

### URL Shortening

#### POST /urls
Create a shortened URL.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "originalUrl": "https://www.example.com/very/long/url/path",
  "customAlias": "mylink",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**Field Details:**
- `originalUrl` (required): Valid URL to shorten
- `customAlias` (optional): Custom short code (3-50 chars, alphanumeric + dash/underscore)
- `expiresAt` (optional): Expiration date (ISO 8601 format)

**Response (201):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "shortCode": "abc123",
  "originalUrl": "https://www.example.com/very/long/url/path",
  "shortUrl": "https://snapurl.in/abc123",
  "customAlias": "mylink",
  "clicks": 0,
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": "2024-12-31T23:59:59Z",
  "isActive": true
}
```

---

#### GET /urls
Get all URLs created by authenticated user.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Items per page (max 100) |
| `sortBy` | string | createdAt | Sort field (createdAt, clicks) |
| `order` | string | desc | Sort order (asc, desc) |
| `search` | string | - | Search in originalUrl |

**Example:**
```bash
GET /urls?page=1&limit=20&sortBy=clicks&order=desc&search=example
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "507f1f77bcf86cd799439011",
      "shortCode": "abc123",
      "originalUrl": "https://www.example.com/page",
      "shortUrl": "https://snapurl.in/abc123",
      "clicks": 42,
      "createdAt": "2024-01-15T10:30:00Z",
      "isActive": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

---

#### GET /urls/:shortCode
Get details of a specific URL.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "shortCode": "abc123",
  "originalUrl": "https://www.example.com/page",
  "shortUrl": "https://snapurl.in/abc123",
  "customAlias": "mylink",
  "clicks": 42,
  "createdAt": "2024-01-15T10:30:00Z",
  "expiresAt": null,
  "isActive": true,
  "userId": "123e4567-e89b-12d3-a456-426614174000"
}
```

---

#### DELETE /urls/:shortCode
Delete a shortened URL.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "message": "URL deleted successfully"
}
```

---

#### GET /:shortCode/qr
Generate QR code for shortened URL.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `size` | number | 200 | QR code size in pixels (100-500) |
| `format` | string | png | Image format (png, svg) |

**Example:**
```bash
GET /abc123/qr?size=300&format=png
```

**Response (200):**
- Content-Type: `image/png` or `image/svg+xml`
- Binary image data

---

### Analytics

#### GET /urls/:shortCode/analytics
Get analytics for a specific URL.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startDate` | string | 30 days ago | Start date (ISO 8601) |
| `endDate` | string | now | End date (ISO 8601) |
| `groupBy` | string | day | Grouping (hour, day, week, month) |

**Example:**
```bash
GET /urls/abc123/analytics?startDate=2024-01-01&endDate=2024-01-31&groupBy=day
```

**Response (200):**
```json
{
  "shortCode": "abc123",
  "totalClicks": 156,
  "uniqueVisitors": 89,
  "clicksByDate": [
    {
      "date": "2024-01-15",
      "clicks": 12
    }
  ],
  "topReferrers": [
    {
      "referrer": "google.com",
      "count": 45
    },
    {
      "referrer": "direct",
      "count": 32
    }
  ],
  "deviceBreakdown": {
    "mobile": 72,
    "desktop": 64,
    "tablet": 20
  },
  "browserBreakdown": {
    "chrome": 89,
    "firefox": 34,
    "safari": 23,
    "other": 10
  },
  "countryBreakdown": [
    {
      "country": "US",
      "count": 78
    },
    {
      "country": "IN",
      "count": 45
    }
  ]
}
```

---

#### GET /analytics/dashboard
Get user's overall analytics dashboard.

**Headers:**
```http
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "totalUrls": 23,
  "totalClicks": 1234,
  "activeUrls": 20,
  "expiredUrls": 3,
  "clicksThisMonth": 456,
  "topPerformingUrls": [
    {
      "shortCode": "abc123",
      "originalUrl": "https://example.com/page",
      "clicks": 234
    }
  ],
  "recentActivity": [
    {
      "shortCode": "xyz789",
      "action": "created",
      "timestamp": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

### Public Endpoints (No Auth Required)

#### GET /:shortCode
Redirect to original URL.

**Example:**
```bash
GET /abc123
```

**Response (301/302):**
- Redirects to original URL
- Sets tracking cookies
- Records analytics asynchronously

---

#### GET /health
Health check endpoint.

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "mongodb": "healthy"
  }
}
```

---

### Admin Endpoints (Admin Role Required)

#### GET /admin/users
List all users.

**Headers:**
```http
Authorization: Bearer <admin_access_token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `role` | string | - | Filter by role |

**Response (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "username": "johndoe",
      "role": "user",
      "emailVerified": true,
      "createdAt": "2024-01-15T10:30:00Z",
      "urlCount": 15
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

#### GET /admin/stats
Get system-wide statistics.

**Headers:**
```http
Authorization: Bearer <admin_access_token>
```

**Response (200):**
```json
{
  "totalUsers": 1523,
  "totalUrls": 45678,
  "totalClicks": 234567,
  "activeUsers": 892,
  "newUsersToday": 34,
  "urlsCreatedToday": 156
}
```

---

## Error Responses

### Standard Error Format

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "timestamp": "2024-01-15T10:30:00Z",
  "path": "/api/v1/urls",
  "details": [
    {
      "field": "originalUrl",
      "message": "Invalid URL format"
    }
  ]
}
```

### HTTP Status Codes

| Status Code | Meaning | Common Causes |
|-------------|---------|---------------|
| **200** | OK | Request successful |
| **201** | Created | Resource created successfully |
| **400** | Bad Request | Invalid request data, validation failed |
| **401** | Unauthorized | Missing or invalid authentication token |
| **403** | Forbidden | Insufficient permissions |
| **404** | Not Found | Resource not found |
| **409** | Conflict | Resource already exists (duplicate) |
| **422** | Unprocessable Entity | Semantic errors in request |
| **429** | Too Many Requests | Rate limit exceeded |
| **500** | Internal Server Error | Server-side error |
| **503** | Service Unavailable | Service temporarily unavailable |

### Common Error Scenarios

#### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Invalid or expired token",
  "error": "Unauthorized"
}
```

**Solutions:**
- Refresh access token using refresh token
- Login again to obtain new tokens
- Verify token is included in Authorization header

#### 429 Too Many Requests
```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "error": "Too Many Requests",
  "retryAfter": 60
}
```

**Rate Limits:**
- URL creation: 10 requests/minute
- Login: 5 requests/minute
- API calls: 100 requests/minute (authenticated)

## Rate Limiting

| Endpoint Pattern | Limit | Window | Scope |
|-----------------|-------|--------|-------|
| `POST /auth/login` | 5 requests | 1 minute | Per IP |
| `POST /auth/register` | 3 requests | 1 hour | Per IP |
| `POST /urls` | 10 requests | 1 minute | Per user |
| `GET /urls` | 60 requests | 1 minute | Per user |
| `GET /:shortCode` | 100 requests | 1 minute | Per IP |
| All other endpoints | 60 requests | 1 minute | Per user/IP |

**Rate Limit Headers:**
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1634567890
```

## Pagination

All list endpoints support pagination with consistent query parameters:

```bash
GET /urls?page=2&limit=20
```

**Response includes pagination metadata:**
```json
{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 45,
    "pages": 3,
    "hasNext": true,
    "hasPrev": true
  }
}
```

## API Versioning

Current API version: **v1**

- Base path: `/api/v1`
- Breaking changes will introduce new versions (v2, v3)
- Old versions maintained for 12 months after deprecation

## Testing the API

### Using cURL

**Create URL:**
```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originalUrl": "https://www.example.com/page"
  }'
```

### Using Swagger UI

1. Navigate to http://localhost:3000/docs
2. Click "Authorize" button
3. Enter JWT token: `Bearer YOUR_ACCESS_TOKEN`
4. Try out endpoints interactively

### Using Postman

Import the OpenAPI spec from:
```
http://localhost:3000/docs-json
```

## SDK & Libraries

### JavaScript/TypeScript
```typescript
import { SnapURLClient } from '@snapurl/sdk';

const client = new SnapURLClient({
  baseUrl: 'https://snapurl.in/api/v1',
  apiKey: 'YOUR_ACCESS_TOKEN'
});

const url = await client.urls.create({
  originalUrl: 'https://example.com'
});
```

### Python
```python
from snapurl import SnapURL

client = SnapURL(
    base_url='https://snapurl.in/api/v1',
    api_key='YOUR_ACCESS_TOKEN'
)

url = client.urls.create(
    original_url='https://example.com'
)
```

## WebSocket Support

**Coming Soon**: Real-time analytics updates via WebSocket connections.

## Cross-References

- **Authentication Flow**: See [../backend/README.md](../backend/README.md#authentication)
- **Security Practices**: See [SECURITY.md](./SECURITY.md)
- **System Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Database Schema**: See [DATABASE.md](./DATABASE.md)

---

**Last Updated**: 2025-12-28  
**API Version**: v1  
**Maintainer**: SnapURL Team
