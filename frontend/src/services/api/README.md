# API Infrastructure

This directory contains the core API infrastructure for integrating with the NestJS backend.

## Components

### `client.ts`
- Base API client built with Axios
- Automatic authentication token management
- Request/response interceptors
- Error handling and retry logic with exponential backoff
- Token refresh automation

### `config.ts`
- Environment variable validation
- API configuration management
- Support for different environments (dev, staging, production)

### `types.ts`
- Core API types and interfaces
- Error handling types
- Authentication types
- Response wrapper types

### `dto.ts`
- TypeScript interfaces matching NestJS backend DTOs
- Complete type definitions for all API endpoints
- Request/response types for all modules

### `startup.ts`
- API initialization and validation
- Connectivity checks
- Token loading from storage
- Startup error reporting

## Usage

### Basic Setup

```typescript
import { apiClient } from '@/services/api';

// The client is automatically configured and ready to use
const response = await apiClient.get('/health');
```

### Environment Configuration

Add to your `.env` file:

```env
VITE_NESTJS_API_URL="http://localhost:3000/api/v1"
```

### Authentication

```typescript
import { apiClient } from '@/services/api';

// Login
const loginResponse = await apiClient.post('/auth/login', {
  email: 'user@example.com',
  password: 'password'
});

// Tokens are automatically managed
// All subsequent requests will include the auth token
```

### Error Handling

```typescript
const response = await apiClient.get('/urls');

if (!response.success) {
  console.error('API Error:', response.error);
  // Handle error appropriately
}
```

## Features

- ✅ Automatic JWT token management
- ✅ Token refresh on expiration
- ✅ Request retry with exponential backoff
- ✅ Environment variable validation
- ✅ TypeScript type safety
- ✅ Comprehensive error handling
- ✅ Startup validation and connectivity checks
- ✅ Local storage token persistence

## Requirements Satisfied

This implementation satisfies the following requirements:

- **8.1**: Environment variable handling for backend URL
- **8.2**: Support for different API base URLs
- **8.3**: Clear error messages for missing configuration
- **8.4**: API connectivity validation on startup
