# API Usage Examples

This document provides comprehensive examples of how to use the SnapURL API, including authentication, URL management, analytics, and advanced features.

## Table of Contents

1. [Authentication Examples](#authentication-examples)
2. [URL Management Examples](#url-management-examples)
3. [Analytics Examples](#analytics-examples)
4. [Bio Pages Examples](#bio-pages-examples)
5. [Tag Management Examples](#tag-management-examples)
6. [Admin Operations Examples](#admin-operations-examples)
7. [Error Handling Examples](#error-handling-examples)
8. [Rate Limiting Examples](#rate-limiting-examples)
9. [Bulk Operations Examples](#bulk-operations-examples)
10. [SDK Examples](#sdk-examples)

## Authentication Examples

### User Registration

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "SecurePassword123!",
    "name": "John Doe"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "john.doe@example.com",
      "name": "John Doe",
      "isEmailVerified": false,
      "createdAt": "2024-01-15T10:30:00.000Z"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  },
  "message": "Registration successful. Please verify your email."
}
```

### User Login

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com",
    "password": "SecurePassword123!"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900,
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "john.doe@example.com",
      "name": "John Doe",
      "role": "user"
    }
  }
}
```

### Token Refresh

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

### Email Verification

```bash
curl -X POST http://localhost:3000/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{
    "token": "verification-token-from-email"
  }'
```

### Password Reset Request

```bash
curl -X POST http://localhost:3000/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john.doe@example.com"
  }'
```

### Password Reset

```bash
curl -X POST http://localhost:3000/api/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "reset-token-from-email",
    "newPassword": "NewSecurePassword123!"
  }'
```

## URL Management Examples

### Create Short URL

```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "originalUrl": "https://www.example.com/very/long/url/with/many/parameters?param1=value1&param2=value2",
    "customAlias": "my-custom-link",
    "title": "Example Website",
    "description": "A great example website",
    "tags": ["marketing", "campaign-2024"],
    "expiresAt": "2024-12-31T23:59:59.000Z"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "65a1b2c3d4e5f6789abcdef0",
    "shortCode": "abc123",
    "shortUrl": "http://localhost:3000/abc123",
    "originalUrl": "https://www.example.com/very/long/url/with/many/parameters?param1=value1&param2=value2",
    "customAlias": "my-custom-link",
    "title": "Example Website",
    "description": "A great example website",
    "tags": ["marketing", "campaign-2024"],
    "clickCount": 0,
    "isActive": true,
    "expiresAt": "2024-12-31T23:59:59.000Z",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Create URL with Advanced Features

```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "originalUrl": "https://www.example.com/mobile-app",
    "iosUrl": "https://apps.apple.com/app/example",
    "androidUrl": "https://play.google.com/store/apps/details?id=com.example",
    "password": "secret123",
    "passwordHint": "Your favorite number",
    "utmSource": "newsletter",
    "utmMedium": "email",
    "utmCampaign": "january-2024",
    "geoTargeting": [
      {
        "country": "US",
        "redirectUrl": "https://www.example.com/us"
      },
      {
        "country": "UK",
        "redirectUrl": "https://www.example.com/uk"
      }
    ],
    "trackingPixels": {
      "facebook": "123456789",
      "google": "GA-123456789",
      "tiktok": "TT-123456789"
    }
  }'
```

### List User URLs

```bash
curl -X GET "http://localhost:3000/api/v1/urls?page=1&limit=10&sortBy=createdAt&order=desc&search=example&tags=marketing" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "urls": [
      {
        "id": "65a1b2c3d4e5f6789abcdef0",
        "shortCode": "abc123",
        "shortUrl": "http://localhost:3000/abc123",
        "originalUrl": "https://www.example.com/page",
        "title": "Example Page",
        "clickCount": 42,
        "isActive": true,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "pagination": {
      "total": 25,
      "page": 1,
      "limit": 10,
      "pages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### Get URL Details

```bash
curl -X GET http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Update URL

```bash
curl -X PUT http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "title": "Updated Title",
    "description": "Updated description",
    "tags": ["marketing", "updated"],
    "isActive": true
  }'
```

### Delete URL

```bash
curl -X DELETE http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Generate QR Code

```bash
curl -X POST http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0/qr \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "size": 256,
    "format": "png",
    "errorCorrectionLevel": "M"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "qrCodeUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEA...",
    "downloadUrl": "http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0/qr/download"
  }
}
```

## Analytics Examples

### Get URL Analytics

```bash
curl -X GET "http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0/analytics?startDate=2024-01-01&endDate=2024-01-31&granularity=day" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalClicks": 1523,
      "uniqueVisitors": 892,
      "averageClicksPerDay": 49.1,
      "conversionRate": 0.586
    },
    "clicksByDate": [
      {
        "date": "2024-01-01",
        "clicks": 45,
        "uniqueVisitors": 32
      },
      {
        "date": "2024-01-02",
        "clicks": 67,
        "uniqueVisitors": 48
      }
    ],
    "deviceBreakdown": {
      "mobile": {
        "count": 685,
        "percentage": 45.0
      },
      "desktop": {
        "count": 609,
        "percentage": 40.0
      },
      "tablet": {
        "count": 229,
        "percentage": 15.0
      }
    },
    "browserBreakdown": {
      "Chrome": 612,
      "Safari": 305,
      "Firefox": 183,
      "Edge": 152,
      "Other": 271
    },
    "osBreakdown": {
      "Windows": 548,
      "iOS": 365,
      "Android": 320,
      "macOS": 198,
      "Linux": 92
    },
    "geographicData": [
      {
        "country": "United States",
        "countryCode": "US",
        "clicks": 456,
        "percentage": 29.9
      },
      {
        "country": "United Kingdom",
        "countryCode": "GB",
        "clicks": 234,
        "percentage": 15.4
      }
    ],
    "topReferrers": [
      {
        "domain": "google.com",
        "clicks": 234,
        "percentage": 15.4
      },
      {
        "domain": "facebook.com",
        "clicks": 189,
        "percentage": 12.4
      },
      {
        "domain": "direct",
        "clicks": 456,
        "percentage": 29.9
      }
    ],
    "utmAnalytics": {
      "sources": {
        "newsletter": 345,
        "social": 234,
        "search": 189
      },
      "mediums": {
        "email": 345,
        "social": 234,
        "organic": 189
      },
      "campaigns": {
        "january-2024": 456,
        "winter-sale": 234
      }
    }
  }
}
```

### Get Real-time Analytics

```bash
curl -X GET http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0/analytics/realtime \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Get User Dashboard Analytics

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/dashboard?period=30d" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "summary": {
      "totalUrls": 45,
      "totalClicks": 12456,
      "activeUrls": 42,
      "topPerformingUrl": {
        "id": "65a1b2c3d4e5f6789abcdef0",
        "shortCode": "abc123",
        "title": "Best Performing Link",
        "clicks": 1523
      }
    },
    "recentActivity": [
      {
        "urlId": "65a1b2c3d4e5f6789abcdef0",
        "shortCode": "abc123",
        "action": "click",
        "timestamp": "2024-01-15T14:30:00.000Z",
        "country": "US",
        "device": "mobile"
      }
    ],
    "clickTrends": [
      {
        "date": "2024-01-14",
        "clicks": 234
      },
      {
        "date": "2024-01-15",
        "clicks": 267
      }
    ]
  }
}
```

## Bio Pages Examples

### Create Bio Page

```bash
curl -X POST http://localhost:3000/api/v1/bio-pages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "username": "johndoe",
    "title": "John Doe - Developer",
    "bio": "Full-stack developer passionate about creating amazing web experiences.",
    "avatarUrl": "https://example.com/avatar.jpg",
    "theme": "modern",
    "backgroundColor": "#1a1a1a",
    "textColor": "#ffffff",
    "buttonStyle": "rounded",
    "isPublic": true
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "65a1b2c3d4e5f6789abcdef1",
    "username": "johndoe",
    "title": "John Doe - Developer",
    "bio": "Full-stack developer passionate about creating amazing web experiences.",
    "avatarUrl": "https://example.com/avatar.jpg",
    "theme": "modern",
    "backgroundColor": "#1a1a1a",
    "textColor": "#ffffff",
    "buttonStyle": "rounded",
    "isPublic": true,
    "bioPageUrl": "http://localhost:3000/bio/johndoe",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Add Bio Links

```bash
curl -X POST http://localhost:3000/api/v1/bio-pages/65a1b2c3d4e5f6789abcdef1/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "links": [
      {
        "title": "My Portfolio",
        "url": "https://johndoe.dev",
        "icon": "portfolio",
        "position": 1,
        "isActive": true
      },
      {
        "title": "GitHub",
        "url": "https://github.com/johndoe",
        "icon": "github",
        "position": 2,
        "isActive": true
      },
      {
        "title": "LinkedIn",
        "url": "https://linkedin.com/in/johndoe",
        "icon": "linkedin",
        "position": 3,
        "isActive": true
      }
    ]
  }'
```

### Update Bio Link Order

```bash
curl -X PUT http://localhost:3000/api/v1/bio-pages/65a1b2c3d4e5f6789abcdef1/links/reorder \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "linkOrders": [
      {
        "linkId": "65a1b2c3d4e5f6789abcdef2",
        "position": 1
      },
      {
        "linkId": "65a1b2c3d4e5f6789abcdef3",
        "position": 2
      }
    ]
  }'
```

### Get Public Bio Page

```bash
curl -X GET http://localhost:3000/bio/johndoe
```

**Response:**
```json
{
  "success": true,
  "data": {
    "username": "johndoe",
    "title": "John Doe - Developer",
    "bio": "Full-stack developer passionate about creating amazing web experiences.",
    "avatarUrl": "https://example.com/avatar.jpg",
    "theme": "modern",
    "backgroundColor": "#1a1a1a",
    "textColor": "#ffffff",
    "buttonStyle": "rounded",
    "links": [
      {
        "id": "65a1b2c3d4e5f6789abcdef2",
        "title": "My Portfolio",
        "url": "https://johndoe.dev",
        "icon": "portfolio",
        "position": 1,
        "clickCount": 45
      },
      {
        "id": "65a1b2c3d4e5f6789abcdef3",
        "title": "GitHub",
        "url": "https://github.com/johndoe",
        "icon": "github",
        "position": 2,
        "clickCount": 32
      }
    ]
  }
}
```

## Tag Management Examples

### Create Tags

```bash
curl -X POST http://localhost:3000/api/v1/tags \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "tags": [
      {
        "name": "marketing",
        "color": "#ff6b6b"
      },
      {
        "name": "social-media",
        "color": "#4ecdc4"
      },
      {
        "name": "campaign-2024",
        "color": "#45b7d1"
      }
    ]
  }'
```

### List User Tags

```bash
curl -X GET http://localhost:3000/api/v1/tags \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tags": [
      {
        "id": "65a1b2c3d4e5f6789abcdef4",
        "name": "marketing",
        "color": "#ff6b6b",
        "urlCount": 12,
        "createdAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "id": "65a1b2c3d4e5f6789abcdef5",
        "name": "social-media",
        "color": "#4ecdc4",
        "urlCount": 8,
        "createdAt": "2024-01-15T10:31:00.000Z"
      }
    ]
  }
}
```

### Tag URLs

```bash
curl -X POST http://localhost:3000/api/v1/urls/65a1b2c3d4e5f6789abcdef0/tags \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "tagIds": [
      "65a1b2c3d4e5f6789abcdef4",
      "65a1b2c3d4e5f6789abcdef5"
    ]
  }'
```

### Filter URLs by Tags

```bash
curl -X GET "http://localhost:3000/api/v1/urls?tags=marketing,social-media&tagOperator=AND" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Admin Operations Examples

### Get System Statistics

```bash
curl -X GET http://localhost:3000/api/v1/admin/statistics \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "users": {
      "total": 1234,
      "verified": 1089,
      "active": 987,
      "newThisMonth": 45
    },
    "urls": {
      "total": 45678,
      "active": 43210,
      "clicks": 234567,
      "newThisMonth": 1234
    },
    "system": {
      "uptime": "15d 4h 32m",
      "version": "1.0.0",
      "environment": "production"
    }
  }
}
```

### List All Users (Admin)

```bash
curl -X GET "http://localhost:3000/api/v1/admin/users?page=1&limit=20&sortBy=createdAt&order=desc" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Deactivate URL (Admin)

```bash
curl -X POST http://localhost:3000/api/v1/admin/urls/65a1b2c3d4e5f6789abcdef0/deactivate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "reason": "Violates terms of service",
    "notifyUser": true
  }'
```

### View Audit Logs

```bash
curl -X GET "http://localhost:3000/api/v1/admin/audit-logs?startDate=2024-01-01&endDate=2024-01-31&action=url_created&userId=550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Error Handling Examples

### Validation Error

```bash
curl -X POST http://localhost:3000/api/v1/urls \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "originalUrl": "not-a-valid-url",
    "customAlias": "a"
  }'
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "originalUrl",
        "message": "originalUrl must be a valid URL"
      },
      {
        "field": "customAlias",
        "message": "customAlias must be at least 3 characters long"
      }
    ]
  },
  "statusCode": 400,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/urls"
}
```

### Authentication Error

```bash
curl -X GET http://localhost:3000/api/v1/urls \
  -H "Authorization: Bearer invalid-token"
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  },
  "statusCode": 401,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/urls"
}
```

### Resource Not Found

```bash
curl -X GET http://localhost:3000/api/v1/urls/nonexistent-id \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "URL not found"
  },
  "statusCode": 404,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/urls/nonexistent-id"
}
```

## Rate Limiting Examples

### Rate Limit Exceeded

```bash
# Make too many requests quickly
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "wrong"}'
done
```

**Response (after limit exceeded):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later"
  },
  "statusCode": 429,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "path": "/api/v1/auth/login"
}
```

**Rate Limit Headers:**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1642248600
Retry-After: 900
```

## Bulk Operations Examples

### Bulk URL Import

```bash
curl -X POST http://localhost:3000/api/v1/bulk/import \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "file=@urls.csv" \
  -F "options={\"skipDuplicates\": true, \"notifyOnComplete\": true}"
```

**CSV Format:**
```csv
originalUrl,customAlias,title,tags
https://example.com/page1,page1,Example Page 1,"marketing,social"
https://example.com/page2,page2,Example Page 2,"marketing,email"
https://example.com/page3,,Example Page 3,"social"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "bulk-import-65a1b2c3d4e5f6789abcdef6",
    "status": "processing",
    "totalRows": 3,
    "estimatedTime": "2 minutes"
  }
}
```

### Check Import Status

```bash
curl -X GET http://localhost:3000/api/v1/bulk/jobs/bulk-import-65a1b2c3d4e5f6789abcdef6 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "bulk-import-65a1b2c3d4e5f6789abcdef6",
    "status": "completed",
    "progress": {
      "processed": 3,
      "successful": 2,
      "failed": 1,
      "percentage": 100
    },
    "results": {
      "created": 2,
      "skipped": 0,
      "errors": [
        {
          "row": 3,
          "error": "Custom alias 'page3' already exists"
        }
      ]
    },
    "completedAt": "2024-01-15T10:35:00.000Z"
  }
}
```

### Bulk Export

```bash
curl -X POST http://localhost:3000/api/v1/bulk/export \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "format": "csv",
    "includeAnalytics": true,
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-01-31"
    },
    "filters": {
      "tags": ["marketing"],
      "isActive": true
    }
  }'
```

## SDK Examples

### JavaScript/TypeScript SDK

```typescript
import { SnapURLClient } from '@snapurl/sdk';

// Initialize client
const client = new SnapURLClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key', // or use token-based auth
});

// Authenticate with email/password
await client.auth.login('user@example.com', 'password');

// Create short URL
const url = await client.urls.create({
  originalUrl: 'https://example.com/long-url',
  customAlias: 'my-link',
  title: 'My Example Link',
  tags: ['marketing', 'campaign'],
});

console.log(`Short URL: ${url.shortUrl}`);

// Get analytics
const analytics = await client.analytics.getUrlAnalytics(url.id, {
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  granularity: 'day',
});

console.log(`Total clicks: ${analytics.summary.totalClicks}`);

// Create bio page
const bioPage = await client.bioPages.create({
  username: 'johndoe',
  title: 'John Doe - Developer',
  bio: 'Full-stack developer',
  theme: 'modern',
});

// Add bio links
await client.bioPages.addLinks(bioPage.id, [
  {
    title: 'Portfolio',
    url: 'https://johndoe.dev',
    icon: 'portfolio',
  },
  {
    title: 'GitHub',
    url: 'https://github.com/johndoe',
    icon: 'github',
  },
]);
```

### Python SDK

```python
from snapurl import SnapURLClient

# Initialize client
client = SnapURLClient(
    base_url='http://localhost:3000',
    api_key='your-api-key'
)

# Authenticate
client.auth.login('user@example.com', 'password')

# Create short URL
url = client.urls.create(
    original_url='https://example.com/long-url',
    custom_alias='my-link',
    title='My Example Link',
    tags=['marketing', 'campaign']
)

print(f"Short URL: {url.short_url}")

# Get analytics
analytics = client.analytics.get_url_analytics(
    url.id,
    start_date='2024-01-01',
    end_date='2024-01-31',
    granularity='day'
)

print(f"Total clicks: {analytics.summary.total_clicks}")

# Bulk operations
with open('urls.csv', 'rb') as file:
    job = client.bulk.import_urls(
        file=file,
        skip_duplicates=True,
        notify_on_complete=True
    )

# Check job status
status = client.bulk.get_job_status(job.job_id)
print(f"Import status: {status.status}")
```

### cURL Wrapper Script

```bash
#!/bin/bash

# snapurl-cli.sh - Command line wrapper for SnapURL API

BASE_URL="http://localhost:3000"
TOKEN_FILE="$HOME/.snapurl_token"

# Login function
login() {
    local email=$1
    local password=$2
    
    response=$(curl -s -X POST "$BASE_URL/api/v1/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$email\",\"password\":\"$password\"}")
    
    token=$(echo $response | jq -r '.data.accessToken')
    echo $token > $TOKEN_FILE
    echo "Logged in successfully"
}

# Create URL function
create_url() {
    local original_url=$1
    local custom_alias=$2
    local title=$3
    
    token=$(cat $TOKEN_FILE)
    
    curl -s -X POST "$BASE_URL/api/v1/urls" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "{\"originalUrl\":\"$original_url\",\"customAlias\":\"$custom_alias\",\"title\":\"$title\"}" \
        | jq '.data.shortUrl'
}

# Usage examples
case $1 in
    "login")
        login $2 $3
        ;;
    "create")
        create_url $2 $3 $4
        ;;
    *)
        echo "Usage: $0 {login|create} [args...]"
        ;;
esac
```

**Usage:**
```bash
# Login
./snapurl-cli.sh login user@example.com password

# Create URL
./snapurl-cli.sh create "https://example.com/long-url" "my-link" "My Title"
```

## WebSocket Examples (Real-time Analytics)

### Connect to Real-time Analytics

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: {
    token: 'your-jwt-token'
  }
});

// Subscribe to URL analytics
socket.emit('subscribe-analytics', { urlId: '65a1b2c3d4e5f6789abcdef0' });

// Listen for real-time clicks
socket.on('url-click', (data) => {
  console.log('New click:', data);
  // {
  //   urlId: '65a1b2c3d4e5f6789abcdef0',
  //   timestamp: '2024-01-15T10:30:00.000Z',
  //   country: 'US',
  //   device: 'mobile',
  //   browser: 'Chrome'
  // }
});

// Listen for analytics updates
socket.on('analytics-update', (data) => {
  console.log('Analytics update:', data);
  // {
  //   urlId: '65a1b2c3d4e5f6789abcdef0',
  //   totalClicks: 1524,
  //   todayClicks: 45,
  //   realtimeVisitors: 3
  // }
});
```

## Webhook Examples

### Configure Webhooks

```bash
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{
    "url": "https://your-app.com/webhooks/snapurl",
    "events": ["url.created", "url.clicked", "url.analytics.milestone"],
    "secret": "your-webhook-secret"
  }'
```

### Webhook Payload Examples

**URL Created:**
```json
{
  "event": "url.created",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "id": "65a1b2c3d4e5f6789abcdef0",
    "shortCode": "abc123",
    "originalUrl": "https://example.com",
    "userId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**URL Clicked:**
```json
{
  "event": "url.clicked",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "data": {
    "urlId": "65a1b2c3d4e5f6789abcdef0",
    "shortCode": "abc123",
    "clickData": {
      "country": "US",
      "device": "mobile",
      "browser": "Chrome",
      "referrer": "google.com"
    }
  }
}
```

---

This comprehensive API usage guide provides examples for all major features of the SnapURL API. For more detailed information about specific endpoints, refer to the interactive Swagger documentation at `/docs` when running the application.