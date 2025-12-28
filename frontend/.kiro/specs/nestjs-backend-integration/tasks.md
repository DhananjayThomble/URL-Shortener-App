# Implementation Plan: NestJS Backend Integration

## Overview

This implementation plan converts the NestJS backend integration design into a series of coding tasks that will replace the current Supabase integration with comprehensive API services. The implementation follows a modular approach, building core infrastructure first, then implementing each feature module with testing.

## Tasks

- [x] 1. Set up core API infrastructure
  - Create API client base class with Axios configuration
  - Set up environment variable handling for backend URL
  - Implement base error handling and response types
  - Configure TypeScript interfaces for API responses
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ]* 1.1 Write property test for API client configuration
  - **Property 8: Configuration Validation**
  - **Validates: Requirements 8.1, 8.2, 8.4**

- [ ] 2. Implement authentication service
  - [x] 2.1 Create authentication service with JWT token management
    - Implement login, register, logout methods
    - Add token storage and retrieval logic
    - Implement automatic token refresh mechanism
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 Write property test for authentication token inclusion
    - **Property 2: Authentication Token Inclusion**
    - **Validates: Requirements 1.5**

  - [ ]* 2.3 Write property test for token refresh automation
    - **Property 3: Token Refresh Automation**
    - **Validates: Requirements 1.3**

  - [ ] 2.4 Update useAuth hook to use new authentication service
    - Replace Supabase auth calls with NestJS auth service
    - Maintain existing hook interface for compatibility
    - Update error handling for new API responses
    - _Requirements: 1.1, 1.2, 1.4, 1.6_

  - [ ]* 2.5 Write property test for comprehensive error handling
    - **Property 5: Comprehensive Error Handling**
    - **Validates: Requirements 1.6, 2.6, 4.5, 7.2, 7.4, 7.5, 8.3, 9.4**

- [x] 3. Checkpoint - Test authentication integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement URL management service
  - [x] 4.1 Create URL service with CRUD operations
    - Implement createURL, getURLs, getURL, updateURL, deleteURL methods
    - Add search and filtering functionality
    - Implement QR code generation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.2 Write property test for API endpoint mapping
    - **Property 1: API Endpoint Mapping Consistency**
    - **Validates: Requirements 1.1, 1.2, 1.4, 2.1, 2.3, 2.4, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 6.1, 6.2**

  - [ ]* 4.3 Write property test for parameter preservation
    - **Property 4: Parameter Preservation**
    - **Validates: Requirements 2.2, 2.5, 3.4, 5.3, 6.3**

  - [x] 4.4 Update LinkShortener component to use URL service
    - Replace Supabase calls with URL service methods
    - Update form handling and validation
    - Maintain existing UI functionality
    - _Requirements: 2.1, 2.6_

  - [x] 4.5 Update RecentLinks component to use URL service
    - Replace Supabase data fetching with URL service
    - Implement pagination and search
    - Update loading and error states
    - _Requirements: 2.2, 2.5_

- [ ]* 4.6 Write property test for loading state management
  - **Property 6: Loading State Management**
  - **Validates: Requirements 7.1**

- [x] 5. Implement React Query integration
  - [x] 5.1 Set up React Query client with caching configuration
    - Configure query client with appropriate cache settings
    - Set up error handling and retry logic
    - Implement query key management
    - _Requirements: 10.1, 10.2_

  - [ ]* 5.2 Write property test for caching efficiency
    - **Property 11: Caching Efficiency**
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 5.3 Write property test for network resilience
    - **Property 7: Network Resilience**
    - **Validates: Requirements 7.3**

  - [x] 5.4 Update URL service to use React Query hooks
    - Create custom hooks for URL operations (useURLs, useCreateURL, etc.)
    - Implement optimistic updates for better UX
    - Add proper error boundaries and loading states
    - _Requirements: 10.2, 10.3_

  - [ ]* 5.5 Write property test for optimistic updates
    - **Property 12: Optimistic Updates**
    - **Validates: Requirements 10.3**

- [x] 6. Checkpoint - Test URL management integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement analytics service
  - [x] 7.1 Create analytics service with data fetching methods
    - Implement getURLAnalytics, getDashboardAnalytics methods
    - Add real-time analytics with WebSocket support
    - Implement data formatting for chart components
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 7.2 Write property test for WebSocket connection management
    - **Property 14: WebSocket Connection Management**
    - **Validates: Requirements 3.5**

  - [x] 7.3 Update dashboard analytics components
    - Update StatsCards to use analytics service
    - Update ClicksChart and TopLinksChart with new data source
    - Implement real-time updates for analytics
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 8. Implement bio page service
  - [ ] 8.1 Create bio page service with CRUD operations
    - Implement createBioPage, getBioPage, updateBioPage methods
    - Add bio link management methods
    - Implement public bio page fetching
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 8.2 Update BioPageEditor component to use bio service
    - Replace Supabase calls with bio service methods
    - Update form handling and validation
    - Maintain existing UI functionality
    - _Requirements: 4.1, 4.3, 4.5_

  - [ ] 8.3 Update PublicBioPage component to use bio service
    - Replace Supabase data fetching with bio service
    - Update loading and error states
    - _Requirements: 4.4_

- [ ] 9. Implement tag management service
  - [ ] 9.1 Create tag service and integrate with URL service
    - Implement createTags, getTags methods
    - Add tag assignment and filtering to URL service
    - Update TagsManager component
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 9.2 Update URL components to support tag filtering
    - Add tag filtering to URL listing
    - Update search functionality to include tags
    - _Requirements: 5.3_

- [ ] 10. Implement bulk operations service
  - [ ] 10.1 Create bulk operations service
    - Implement bulk import and export methods
    - Add job status polling functionality
    - Handle file upload and download
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 10.2 Write property test for bulk operation status tracking
    - **Property 15: Bulk Operation Status Tracking**
    - **Validates: Requirements 6.3, 6.4**

  - [ ] 10.3 Update BulkImportExport component
    - Replace existing bulk operations with new service
    - Update progress tracking and status display
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 11. Implement data validation and type safety
  - [ ] 11.1 Create TypeScript interfaces matching backend DTOs
    - Define all request and response types
    - Implement runtime validation with Zod schemas
    - Add date/time formatting utilities
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 11.2 Write property test for data type consistency
    - **Property 9: Data Type Consistency**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [ ]* 11.3 Write property test for response validation
    - **Property 10: Response Validation**
    - **Validates: Requirements 9.2**

- [ ] 12. Implement pagination support
  - [ ] 12.1 Add pagination utilities and hooks
    - Create usePagination hook
    - Implement pagination controls component
    - Update all list components to support pagination
    - _Requirements: 10.5_

  - [ ]* 12.2 Write property test for pagination consistency
    - **Property 13: Pagination Consistency**
    - **Validates: Requirements 10.5**

- [ ] 13. Update redirect and public pages
  - [ ] 13.1 Update RedirectPage to use NestJS backend
    - Replace Supabase redirect logic with API calls
    - Handle click tracking and analytics
    - _Requirements: 2.1, 3.1_

  - [ ] 13.2 Ensure all public routes work with new backend
    - Test public bio page access
    - Verify redirect functionality
    - _Requirements: 4.4_

- [ ] 14. Final integration and testing
  - [ ] 14.1 Remove Supabase dependencies
    - Remove Supabase client and types
    - Clean up unused imports and code
    - Update environment variable documentation

  - [ ] 14.2 Add comprehensive error boundaries
    - Implement error boundaries for all major components
    - Add fallback UI for API failures
    - _Requirements: 7.2_

  - [ ] 14.3 Performance optimization
    - Implement request batching where beneficial
    - Optimize caching strategies
    - Add loading skeletons for better UX
    - _Requirements: 10.4_

- [ ] 15. Final checkpoint - Complete integration testing
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The implementation maintains existing UI functionality while replacing the data layer