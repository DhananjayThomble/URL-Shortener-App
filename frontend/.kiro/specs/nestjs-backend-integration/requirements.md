# Requirements Document

## Introduction

This specification defines the requirements for integrating the existing NestJS backend API with the React frontend in the snapurl-link-orchestrator project. The frontend currently uses Supabase for authentication and data management, which needs to be replaced with API calls to the NestJS backend while maintaining all existing UI functionality.

## Glossary

- **Frontend**: The React.js application in snapurl-link-orchestrator
- **NestJS_Backend**: The production-ready NestJS backend in URL-Shortener-App/nestjs-backend
- **API_Client**: Service layer for making HTTP requests to the NestJS backend
- **Auth_Service**: Authentication service handling JWT tokens and user sessions
- **URL_Service**: Service for URL shortening and management operations
- **Analytics_Service**: Service for retrieving analytics data
- **Bio_Service**: Service for bio page management

## Requirements

### Requirement 1: Authentication Integration

**User Story:** As a user, I want to authenticate using the NestJS backend, so that I can access my account and manage my links securely.

#### Acceptance Criteria

1. WHEN a user registers with email and password, THE Auth_Service SHALL call the NestJS backend registration endpoint
2. WHEN a user logs in with credentials, THE Auth_Service SHALL call the NestJS backend login endpoint and store JWT tokens
3. WHEN JWT tokens expire, THE Auth_Service SHALL automatically refresh tokens using the refresh endpoint
4. WHEN a user logs out, THE Auth_Service SHALL clear stored tokens and call the logout endpoint
5. THE Auth_Service SHALL include JWT tokens in all authenticated API requests
6. WHEN authentication fails, THE Auth_Service SHALL handle errors gracefully and redirect to login

### Requirement 2: URL Management Integration

**User Story:** As a user, I want to create, view, edit, and delete shortened URLs, so that I can manage my link collection effectively.

#### Acceptance Criteria

1. WHEN a user creates a short URL, THE URL_Service SHALL call the NestJS backend URL creation endpoint
2. WHEN a user views their URLs, THE URL_Service SHALL fetch URLs from the NestJS backend with pagination
3. WHEN a user updates URL details, THE URL_Service SHALL call the NestJS backend URL update endpoint
4. WHEN a user deletes a URL, THE URL_Service SHALL call the NestJS backend URL deletion endpoint
5. WHEN a user searches URLs, THE URL_Service SHALL call the NestJS backend with search parameters
6. THE URL_Service SHALL handle URL validation and error responses from the backend

### Requirement 3: Analytics Integration

**User Story:** As a user, I want to view analytics for my URLs, so that I can track performance and engagement.

#### Acceptance Criteria

1. WHEN a user views dashboard analytics, THE Analytics_Service SHALL fetch summary statistics from the NestJS backend
2. WHEN a user views URL-specific analytics, THE Analytics_Service SHALL fetch detailed analytics data
3. WHEN analytics data is displayed, THE Analytics_Service SHALL format data for chart components
4. THE Analytics_Service SHALL support date range filtering for analytics queries
5. WHEN real-time analytics are needed, THE Analytics_Service SHALL handle WebSocket connections

### Requirement 4: Bio Page Integration

**User Story:** As a user, I want to create and manage bio pages, so that I can share multiple links in one place.

#### Acceptance Criteria

1. WHEN a user creates a bio page, THE Bio_Service SHALL call the NestJS backend bio page creation endpoint
2. WHEN a user adds links to bio page, THE Bio_Service SHALL call the NestJS backend bio link management endpoints
3. WHEN a user updates bio page settings, THE Bio_Service SHALL call the NestJS backend bio page update endpoint
4. WHEN a user views public bio pages, THE Bio_Service SHALL fetch bio page data from the NestJS backend
5. THE Bio_Service SHALL handle bio page validation and error responses

### Requirement 5: Tag Management Integration

**User Story:** As a user, I want to organize my URLs with tags, so that I can categorize and filter my links efficiently.

#### Acceptance Criteria

1. WHEN a user creates tags, THE URL_Service SHALL call the NestJS backend tag creation endpoint
2. WHEN a user assigns tags to URLs, THE URL_Service SHALL call the NestJS backend tag assignment endpoints
3. WHEN a user filters URLs by tags, THE URL_Service SHALL include tag filters in API requests
4. THE URL_Service SHALL fetch available tags from the NestJS backend for tag selection

### Requirement 6: Bulk Operations Integration

**User Story:** As a user, I want to import and export URLs in bulk, so that I can manage large collections efficiently.

#### Acceptance Criteria

1. WHEN a user imports URLs from CSV, THE URL_Service SHALL call the NestJS backend bulk import endpoint
2. WHEN a user exports URLs to CSV, THE URL_Service SHALL call the NestJS backend bulk export endpoint
3. WHEN bulk operations are processing, THE URL_Service SHALL poll job status from the NestJS backend
4. THE URL_Service SHALL handle bulk operation progress updates and completion notifications

### Requirement 7: Error Handling and Loading States

**User Story:** As a user, I want clear feedback on API operations, so that I understand the system status and any issues.

#### Acceptance Criteria

1. WHEN API requests are in progress, THE API_Client SHALL show appropriate loading indicators
2. WHEN API requests fail, THE API_Client SHALL display user-friendly error messages
3. WHEN network errors occur, THE API_Client SHALL implement retry logic with exponential backoff
4. THE API_Client SHALL handle different HTTP status codes appropriately
5. WHEN rate limits are exceeded, THE API_Client SHALL show rate limit messages

### Requirement 8: Configuration and Environment Management

**User Story:** As a developer, I want configurable API endpoints, so that the frontend can work with different backend environments.

#### Acceptance Criteria

1. THE API_Client SHALL read backend URL from environment variables
2. THE API_Client SHALL support different API base URLs for development, staging, and production
3. WHEN environment variables are missing, THE API_Client SHALL provide clear error messages
4. THE API_Client SHALL validate API connectivity on application startup

### Requirement 9: Data Type Compatibility

**User Story:** As a developer, I want consistent data types between frontend and backend, so that data flows correctly without transformation errors.

#### Acceptance Criteria

1. THE API_Client SHALL define TypeScript interfaces matching NestJS backend DTOs
2. WHEN API responses are received, THE API_Client SHALL validate response structure
3. THE API_Client SHALL handle date/time formatting consistently with backend expectations
4. WHEN data validation fails, THE API_Client SHALL log detailed error information

### Requirement 10: Performance Optimization

**User Story:** As a user, I want fast API responses and efficient data loading, so that the application feels responsive.

#### Acceptance Criteria

1. THE API_Client SHALL implement request caching for frequently accessed data
2. THE API_Client SHALL use React Query for efficient data fetching and caching
3. WHEN possible, THE API_Client SHALL implement optimistic updates for better UX
4. THE API_Client SHALL batch multiple related API requests when beneficial
5. THE API_Client SHALL implement pagination for large data sets