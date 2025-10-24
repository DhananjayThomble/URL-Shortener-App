# SnapURL Frontend - Next.js 15

> **AI-Optimized Documentation**: This README is structured to provide complete project context for coding AI tools, minimizing hallucinations and errors.

A modern, responsive frontend for the SnapURL URL shortener built with Next.js 15, TypeScript, Material-UI v7, and Tailwind CSS. This application provides a full-featured user interface for URL shortening, management, analytics, and administration.

## 📋 Table of Contents

- [Features](#-features)
- [Technology Stack](#️-technology-stack)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Environment Configuration](#-environment-configuration)
- [Project Structure](#-project-structure)
- [API Integration](#-api-integration)
- [Dependencies](#-dependencies)
- [Development Workflow](#-development-workflow)
- [Testing](#-testing)
- [Building & Deployment](#-building--deployment)
- [Component Architecture](#-component-architecture)
- [State Management](#-state-management)
- [Routing](#-routing)
- [Styling](#-styling)
- [Code Quality](#-code-quality)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## 🚀 Features

- **Modern Stack**: Next.js 15 with App Router, TypeScript, Material-UI v7, Tailwind CSS
- **Authentication**: JWT-based authentication with automatic token refresh
- **URL Management**: Create, manage, and analyze shortened URLs
- **Analytics**: Comprehensive analytics with interactive charts and visualizations
- **QR Codes**: Generate and customize QR codes for shortened URLs
- **Responsive Design**: Mobile-first design that works on all devices
- **Dark Mode**: System preference detection with manual toggle
- **PWA Support**: Progressive Web App capabilities with offline functionality
- **Performance**: Optimized with code splitting, lazy loading, and caching
- **Accessibility**: WCAG 2.1 AA compliant with keyboard navigation support

## 🛠️ Technology Stack

### Core Framework

- **Next.js 15** - React framework with App Router
- **React 18** - UI library with concurrent features
- **TypeScript** - Type-safe JavaScript

### UI & Styling

- **Material-UI v7** - React component library
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Animation library

### State Management

- **Zustand** - Lightweight state management
- **TanStack Query** - Server state management and caching

### Forms & Validation

- **React Hook Form** - Performant forms with easy validation
- **Zod** - TypeScript-first schema validation

### Development Tools

- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **Lint-staged** - Run linters on staged files

## 📋 Prerequisites

Before starting, ensure you have:

- **Node.js**: Version 18.0.0 or higher (check with `node --version`)
- **npm**: Version 9.0.0 or higher (comes with Node.js)
- **Running Backend**: The NestJS backend must be running on `http://localhost:3000` (see [nestjs-backend/README.md](../nestjs-backend/README.md))
- **Git**: For version control
- **Text Editor**: VS Code recommended with TypeScript and ESLint extensions

**System Requirements:**
- Memory: Minimum 4GB RAM, 8GB recommended
- Disk Space: Minimum 500MB free space
- OS: Windows 10+, macOS 10.15+, or Linux (Ubuntu 20.04+)

## 🚀 Quick Start

### 1. Clone and Install

```bash
# If you haven't cloned the repository yet
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App

# Navigate to the frontend directory
cd nextjs-frontend

# Install dependencies (this may take 2-3 minutes)
npm install
```

**Note**: The `npm install` command installs all dependencies listed in `package.json`. If you encounter errors, ensure your Node.js version is 18+ and try clearing npm cache with `npm cache clean --force`.

### 2. Environment Setup

```bash
# Create environment file
touch .env.local

# Add the following configuration
echo 'NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_ENVIRONMENT=development
NEXT_PUBLIC_APP_NAME=SnapURL' > .env.local
```

**Important**: Never commit `.env.local` to version control. The `.gitignore` file already excludes it.

### 3. Start Development Server

```bash
# Start the development server with Turbopack (faster builds)
npm run dev

# The app will be available at http://localhost:3001
# API calls will be proxied to http://localhost:3000
```

**Development Server Features:**
- Hot Module Replacement (HMR): Changes appear instantly without full reload
- Turbopack: Next-generation bundler for faster compilation
- Error Overlay: Detailed error messages displayed in browser
- Fast Refresh: Preserves component state during edits

### 4. Verify Setup

Open your browser and navigate to:
- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:3000/api/v1
- **Backend Docs**: http://localhost:3000/docs

If you see the SnapURL landing page, the setup is successful!

## 🌐 Environment Configuration

### Environment Variables

Create a `.env.local` file in the `nextjs-frontend` directory with these variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL | `http://localhost:3000/api/v1` | Yes |
| `NEXT_PUBLIC_APP_URL` | Frontend app URL | `http://localhost:3001` | Yes |
| `NEXT_PUBLIC_ENVIRONMENT` | Environment name (development/staging/production) | `development` | No |
| `NEXT_PUBLIC_APP_NAME` | Application name | `SnapURL` | No |
| `NEXT_PUBLIC_ENABLE_ANALYTICS` | Enable analytics features | `true` | No |
| `NEXT_PUBLIC_ENABLE_QR_CODES` | Enable QR code generation | `true` | No |
| `NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS` | Enable custom domain support | `true` | No |
| `NEXT_PUBLIC_ENABLE_PWA` | Enable Progressive Web App features | `true` | No |

### Example Configuration

**Development (.env.local)**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_ENVIRONMENT=development
NEXT_PUBLIC_APP_NAME=SnapURL
NEXT_PUBLIC_ENABLE_ANALYTICS=true
NEXT_PUBLIC_ENABLE_QR_CODES=true
NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS=true
NEXT_PUBLIC_ENABLE_PWA=true
```

**Production (.env.production)**
```bash
NEXT_PUBLIC_API_URL=https://api.snapurl.in/api/v1
NEXT_PUBLIC_APP_URL=https://app.snapurl.in
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_APP_NAME=SnapURL
NEXT_PUBLIC_ENABLE_ANALYTICS=true
NEXT_PUBLIC_ENABLE_QR_CODES=true
NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS=true
NEXT_PUBLIC_ENABLE_PWA=true
```

**Important Notes:**
- Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser
- Never store secrets or API keys in `NEXT_PUBLIC_` variables
- Environment variables are embedded at build time
- Changes to environment variables require a rebuild (`npm run build`)

## 📁 Project Structure

### Complete Folder Hierarchy

```
nextjs-frontend/
├── public/                     # Static assets served directly
│   ├── icons/                 # App icons and favicons
│   ├── images/                # Static images
│   └── manifest.json          # PWA manifest
│
├── src/
│   ├── app/                   # Next.js App Router pages & layouts
│   │   ├── (auth)/           # Authentication group (shared layout)
│   │   │   ├── login/        # Login page
│   │   │   ├── register/     # Registration page
│   │   │   ├── forgot-password/  # Password reset request
│   │   │   ├── reset-password/   # Password reset form
│   │   │   ├── verify-email/ # Email verification
│   │   │   └── layout.tsx    # Auth layout (centered form)
│   │   │
│   │   ├── (dashboard)/      # Dashboard group (protected routes)
│   │   │   ├── dashboard/    # Main dashboard
│   │   │   │   ├── page.tsx  # Dashboard overview
│   │   │   │   └── loading.tsx  # Loading state
│   │   │   └── layout.tsx    # Dashboard layout (sidebar, header)
│   │   │
│   │   ├── admin/            # Admin pages (role-based access)
│   │   │   ├── users/        # User management
│   │   │   ├── analytics/    # System analytics
│   │   │   ├── audit-logs/   # Audit logs viewer
│   │   │   ├── admins/       # Admin management
│   │   │   └── layout.tsx    # Admin layout
│   │   │
│   │   ├── profile/          # User profile page
│   │   ├── unauthorized/     # 403 Unauthorized page
│   │   ├── globals.css       # Global styles & Tailwind imports
│   │   ├── layout.tsx        # Root layout (providers, theme)
│   │   ├── page.tsx          # Home page (landing)
│   │   └── error.tsx         # Error boundary
│   │
│   ├── components/           # Reusable React components
│   │   ├── ui/              # Base UI components (buttons, inputs)
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── ...
│   │   │
│   │   ├── forms/           # Form components
│   │   │   ├── LoginForm.tsx
│   │   │   ├── RegisterForm.tsx
│   │   │   ├── UrlCreateForm.tsx
│   │   │   └── ...
│   │   │
│   │   ├── charts/          # Analytics & visualization components
│   │   │   ├── LineChart.tsx
│   │   │   ├── BarChart.tsx
│   │   │   ├── PieChart.tsx
│   │   │   └── ...
│   │   │
│   │   ├── layout/          # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── Navigation.tsx
│   │   │
│   │   ├── auth/            # Authentication components
│   │   │   ├── AuthProvider.tsx
│   │   │   ├── ProtectedRoute.tsx
│   │   │   └── RoleGuard.tsx
│   │   │
│   │   ├── urls/            # URL management components
│   │   │   ├── UrlList.tsx
│   │   │   ├── UrlCard.tsx
│   │   │   ├── UrlActions.tsx
│   │   │   └── ...
│   │   │
│   │   ├── analytics/       # Analytics components
│   │   │   ├── AnalyticsDashboard.tsx
│   │   │   ├── StatsCard.tsx
│   │   │   └── ...
│   │   │
│   │   └── qr/             # QR code components
│   │       ├── QRGenerator.tsx
│   │       ├── QRDownloader.tsx
│   │       └── ...
│   │
│   ├── lib/                 # Utilities, configurations, and helpers
│   │   ├── api/            # API client and type definitions
│   │   │   ├── client.ts   # Axios instance with interceptors
│   │   │   ├── endpoints.ts  # API endpoint definitions
│   │   │   └── types.ts    # API request/response types
│   │   │
│   │   ├── auth/           # Authentication utilities
│   │   │   ├── auth.ts     # Auth helper functions
│   │   │   ├── token.ts    # Token management
│   │   │   └── permissions.ts  # Permission checks
│   │   │
│   │   ├── theme/          # Material-UI theme configuration
│   │   │   ├── theme.ts    # Theme definition
│   │   │   └── colors.ts   # Color palette
│   │   │
│   │   ├── utils/          # General utility functions
│   │   │   ├── format.ts   # Formatters (date, number, etc.)
│   │   │   ├── validation.ts  # Validation helpers
│   │   │   └── helpers.ts  # Misc helpers
│   │   │
│   │   ├── validation/     # Zod validation schemas
│   │   │   ├── auth.ts     # Auth form schemas
│   │   │   ├── url.ts      # URL form schemas
│   │   │   └── user.ts     # User form schemas
│   │   │
│   │   └── constants/      # Application constants
│   │       ├── routes.ts   # Route definitions
│   │       ├── config.ts   # App configuration
│   │       └── messages.ts # UI messages
│   │
│   ├── stores/             # Zustand state management stores
│   │   ├── authStore.ts    # Authentication state
│   │   ├── uiStore.ts      # UI preferences (theme, sidebar)
│   │   └── urlStore.ts     # URL management state
│   │
│   ├── hooks/              # Custom React hooks
│   │   ├── useAuth.ts      # Authentication hook
│   │   ├── useApi.ts       # API calling hook
│   │   ├── useDebounce.ts  # Debounce hook
│   │   ├── useLocalStorage.ts  # LocalStorage hook
│   │   └── ...
│   │
│   ├── types/              # TypeScript type definitions
│   │   ├── index.ts        # Main type exports
│   │   ├── user.ts         # User types
│   │   ├── url.ts          # URL types
│   │   └── analytics.ts    # Analytics types
│   │
│   └── __tests__/          # Test files (mirrors src structure)
│       ├── components/     # Component tests
│       ├── hooks/          # Hook tests
│       └── integration/    # Integration tests
│
├── tests/                  # E2E tests (Playwright)
│   ├── auth.spec.ts       # Authentication E2E tests
│   ├── urls.spec.ts       # URL management E2E tests
│   └── admin.spec.ts      # Admin features E2E tests
│
├── .husky/                # Git hooks
│   ├── pre-commit         # Runs lint-staged
│   └── pre-push           # Runs tests
│
├── playwright-report/     # Playwright test reports (gitignored)
├── test-results/          # Test results (gitignored)
│
├── .env.local            # Local environment variables (gitignored)
├── .env.production       # Production environment template
├── .eslintrc.js          # ESLint configuration
├── .prettierrc           # Prettier configuration
├── .prettierignore       # Prettier ignore patterns
├── .gitignore            # Git ignore patterns
├── eslint.config.mjs     # ESLint flat config
├── jest.config.js        # Jest configuration
├── jest.setup.js         # Jest setup file
├── next.config.ts        # Next.js configuration
├── package.json          # Dependencies and scripts
├── playwright.config.ts  # Playwright E2E configuration
├── postcss.config.mjs    # PostCSS configuration
├── tailwind.config.ts    # Tailwind CSS configuration
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

### Key Directory Purposes

**`src/app/`**: Next.js 15 App Router pages. Each folder represents a route. Special files:
- `page.tsx`: Route UI
- `layout.tsx`: Shared layout
- `loading.tsx`: Loading UI
- `error.tsx`: Error boundary
- `not-found.tsx`: 404 page

**`src/components/`**: Reusable React components organized by function. Follow atomic design principles.

**`src/lib/`**: Non-React utilities, configurations, and helper functions. Pure TypeScript/JavaScript.

**`src/stores/`**: Zustand stores for global client state management.

**`src/hooks/`**: Custom React hooks for reusable component logic.

**`src/types/`**: Centralized TypeScript type definitions shared across the app.

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start development server with Turbopack on port 3001
npm run build           # Build optimized production bundle
npm run start           # Start production server (requires build first)

# Code Quality
npm run lint            # Run ESLint to check for code issues
npm run lint:fix        # Automatically fix ESLint errors
npm run format          # Format code with Prettier
npm run format:check    # Check if code matches Prettier rules
npm run type-check      # Run TypeScript compiler in check mode (no output)

# Testing
npm run test            # Run Jest unit tests
npm run test:watch      # Run Jest in watch mode (re-runs on file changes)
npm run test:coverage   # Generate test coverage report
npm run test:integration # Run integration tests only
npm run test:e2e        # Run Playwright E2E tests (headless)
npm run test:e2e:ui     # Run Playwright tests with UI mode
npm run test:e2e:headed # Run Playwright tests in headed mode (visible browser)
npm run test:e2e:debug  # Run Playwright tests in debug mode

# Git Hooks (run automatically)
npm run prepare         # Setup Husky git hooks
```

## 🌐 API Integration

### API Client Configuration

The application uses a centralized Axios client located at `src/lib/api/client.ts`:

```typescript
// src/lib/api/client.ts
import axios from 'axios';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: Add auth token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: Handle token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Attempt token refresh
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry original request
        return apiClient(error.config);
      }
      // Redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### API Endpoints

The backend API follows RESTful conventions at `http://localhost:3000/api/v1`:

#### Authentication (`/api/v1/auth`)
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login and get tokens
- `POST /auth/logout` - Logout user
- `POST /auth/refresh` - Refresh access token
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password with token
- `POST /auth/verify-email` - Verify email address

#### Users (`/api/v1/users`)
- `GET /users/profile` - Get current user profile
- `PUT /users/profile` - Update user profile
- `PUT /users/password` - Change password
- `DELETE /users/account` - Delete account

#### URLs (`/api/v1/urls`)
- `POST /urls` - Create shortened URL
- `GET /urls` - List user's URLs (with pagination)
- `GET /urls/:id` - Get specific URL details
- `PUT /urls/:id` - Update URL (custom alias, etc.)
- `DELETE /urls/:id` - Delete URL
- `GET /urls/:id/analytics` - Get URL analytics
- `POST /urls/:id/qr` - Generate QR code

#### Admin (`/api/v1/admin`)
- `GET /admin/users` - List all users (admin only)
- `PUT /admin/users/:id` - Update user (admin only)
- `DELETE /admin/users/:id` - Delete user (admin only)
- `GET /admin/analytics` - System-wide analytics
- `GET /admin/audit-logs` - View audit logs

### API Response Format

All API responses follow a consistent structure:

**Success Response:**
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation successful"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": []
  }
}
```

### API Usage Example

```typescript
// src/lib/api/urls.ts
import { apiClient } from './client';
import type { CreateUrlDto, Url } from '@/types/url';

export const urlApi = {
  // Create shortened URL
  create: async (data: CreateUrlDto): Promise<Url> => {
    const response = await apiClient.post('/urls', data);
    return response.data.data;
  },

  // Get user's URLs with pagination
  list: async (page = 1, limit = 10): Promise<{ urls: Url[]; total: number }> => {
    const response = await apiClient.get('/urls', {
      params: { page, limit },
    });
    return response.data.data;
  },

  // Get URL analytics
  getAnalytics: async (urlId: string): Promise<Analytics> => {
    const response = await apiClient.get(`/urls/${urlId}/analytics`);
    return response.data.data;
  },

  // Delete URL
  delete: async (urlId: string): Promise<void> => {
    await apiClient.delete(`/urls/${urlId}`);
  },
};
```

### Using TanStack Query

The app uses TanStack Query (React Query) for server state management:

```typescript
// src/hooks/useUrls.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { urlApi } from '@/lib/api/urls';

export const useUrls = () => {
  const queryClient = useQueryClient();

  // Fetch URLs
  const { data, isLoading, error } = useQuery({
    queryKey: ['urls'],
    queryFn: () => urlApi.list(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Create URL mutation
  const createUrl = useMutation({
    mutationFn: urlApi.create,
    onSuccess: () => {
      // Invalidate and refetch urls
      queryClient.invalidateQueries({ queryKey: ['urls'] });
    },
  });

  return {
    urls: data?.urls ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    createUrl: createUrl.mutate,
    isCreating: createUrl.isPending,
  };
};
```

### Error Handling

The app implements comprehensive error handling:

```typescript
// src/lib/api/errorHandler.ts
export const handleApiError = (error: any): string => {
  if (error.response) {
    // Server responded with error
    return error.response.data?.error?.message || 'An error occurred';
  } else if (error.request) {
    // Request made but no response
    return 'Network error. Please check your connection.';
  } else {
    // Something else happened
    return error.message || 'An unexpected error occurred';
  }
};
```

Usage in components:
```typescript
try {
  await urlApi.create(formData);
  toast.success('URL created successfully!');
} catch (error) {
  const message = handleApiError(error);
  toast.error(message);
}
```

## 📦 Dependencies

### Core Dependencies

| Package | Version | Purpose | Documentation |
|---------|---------|---------|---------------|
| `next` | 15.5.6 | React framework with App Router, SSR, and file-based routing | [Next.js Docs](https://nextjs.org/docs) |
| `react` | 19.1.0 | UI library with concurrent features and improved hooks | [React Docs](https://react.dev) |
| `react-dom` | 19.1.0 | React rendering for web browsers | [React DOM](https://react.dev/reference/react-dom) |
| `typescript` | ^5 | Type-safe JavaScript superset | [TypeScript Docs](https://www.typescriptlang.org/docs/) |

### UI & Styling

| Package | Version | Purpose |
|---------|---------|---------|
| `@mui/material` | ^7.0.0-rc.0 | Material-UI component library (buttons, inputs, cards, etc.) |
| `@mui/icons-material` | ^7.0.0-rc.0 | Material Design icons (1000+ icons) |
| `@emotion/react` | ^11.14.0 | CSS-in-JS library (required by MUI) |
| `@emotion/styled` | ^11.14.1 | Styled components for Emotion |
| `tailwindcss` | ^4 | Utility-first CSS framework for custom styling |
| `framer-motion` | ^12.23.24 | Animation library for smooth transitions and gestures |

### State Management & Data Fetching

| Package | Version | Purpose |
|---------|---------|---------|
| `zustand` | ^5.0.8 | Lightweight state management (auth, UI preferences) |
| `@tanstack/react-query` | ^5.90.5 | Server state management, caching, and automatic refetching |

### Forms & Validation

| Package | Version | Purpose |
|---------|---------|---------|
| `react-hook-form` | ^7.65.0 | Performant form management with validation |
| `@hookform/resolvers` | ^5.2.2 | Form validation resolvers (Zod integration) |
| `zod` | ^4.1.12 | TypeScript-first schema validation |

### Charts & Visualization

| Package | Version | Purpose |
|---------|---------|---------|
| `recharts` | ^3.3.0 | Composable charting library (line, bar, pie charts) |
| `@mui/x-date-pickers` | ^8.14.1 | Material-UI date/time pickers for analytics date ranges |
| `date-fns` | ^4.1.0 | Modern date utility library (formatting, parsing) |

### QR Codes & Export

| Package | Version | Purpose |
|---------|---------|---------|
| `qrcode.react` | ^4.2.0 | React component for QR code generation |
| `qrcode` | ^1.5.4 | QR code generation utilities |
| `xlsx` | ^0.18.5 | Excel file generation for URL exports |
| `jszip` | ^3.10.1 | Create ZIP archives (bulk QR downloads) |

### UI Feedback

| Package | Version | Purpose |
|---------|---------|---------|
| `react-hot-toast` | ^2.6.0 | Toast notifications for user feedback |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@playwright/test` | ^1.56.1 | End-to-end testing framework |
| `jest` | ^29.7.0 | Unit testing framework |
| `@testing-library/react` | ^14.2.1 | React component testing utilities |
| `@testing-library/jest-dom` | ^6.4.2 | Custom Jest matchers for DOM |
| `@testing-library/user-event` | ^14.5.2 | Simulate user interactions in tests |
| `eslint` | ^9 | JavaScript/TypeScript linting |
| `eslint-config-next` | 15.5.6 | Next.js-specific ESLint rules |
| `prettier` | ^3.6.2 | Code formatting |
| `husky` | ^9.1.7 | Git hooks (pre-commit, pre-push) |
| `lint-staged` | ^16.2.4 | Run linters on staged files only |
| `msw` | ^1.3.2 | Mock Service Worker for API mocking in tests |

### Why These Dependencies?

**Material-UI v7**: Comprehensive component library with excellent accessibility, theming, and mobile support. Provides 50+ production-ready components.

**Tailwind CSS**: Complements MUI for custom utility classes. Used for layout, spacing, and responsive design where MUI components aren't needed.

**Zustand**: Chosen for its simplicity (100 bytes) and lack of boilerplate compared to Redux. Perfect for client-side state like auth and UI preferences.

**TanStack Query**: Handles server state elegantly with automatic caching, background refetching, and optimistic updates. Eliminates manual loading/error state management.

**React Hook Form**: 2-3x faster than Formik with better TypeScript support. Reduces re-renders significantly.

**Zod**: Type-safe validation that integrates perfectly with TypeScript. Schema can be reused for both validation and type inference.

**Recharts**: Declarative charting library that matches React's component model. Easier to customize than Chart.js.

**Playwright**: More reliable than Cypress for E2E tests with better cross-browser support and parallel execution.

## 🎨 Design System

The application uses a consistent design system with:

- **Colors**: Primary (blue), secondary (purple), success (green), error (red), warning (orange)
- **Typography**: Inter font family with consistent scale
- **Spacing**: 8px base unit with consistent spacing scale
- **Components**: Material-UI components with custom theming
- **Responsive**: Mobile-first breakpoints (sm: 640px, md: 768px, lg: 1024px, xl: 1280px)

## 🔐 Authentication

The app uses JWT-based authentication with:

- Access tokens (15 minutes expiry)
- Refresh tokens (7 days expiry)
- Automatic token refresh
- Secure token storage
- Route protection

## 📊 State Management

- **Zustand**: For client-side state (auth, UI preferences)
- **TanStack Query**: For server state (API data, caching)
- **Local Storage**: For persistence (tokens, preferences)

## 🚀 Performance Optimizations

- **Code Splitting**: Automatic route-based splitting
- **Lazy Loading**: Dynamic imports for heavy components
- **Image Optimization**: Next.js Image component with WebP/AVIF
- **Caching**: TanStack Query for API response caching
- **Bundle Analysis**: Built-in bundle analyzer

## ♿ Accessibility

- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- High contrast support
- Focus management

## 🔧 Development Guidelines

### Code Style

- Use TypeScript for all new code
- Follow ESLint and Prettier configurations
- Use functional components with hooks
- Implement proper error boundaries

### Component Structure

- Keep components small and focused
- Use composition over inheritance
- Implement proper prop types
- Add JSDoc comments for complex components

### State Management

- Use Zustand for client state
- Use TanStack Query for server state
- Avoid prop drilling
- Keep state as local as possible

## 🐛 Troubleshooting

### Common Issues

1. **Port already in use**

   ```bash
   # Kill process on port 3001
   npx kill-port 3001
   
   # Or use a different port
   npm run dev -- --port 3002
   ```

2. **Module not found errors**

   ```bash
   # Clear node_modules and reinstall
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **TypeScript errors**

   ```bash
   # Run type checking to see all errors
   npm run type-check
   
   # Clear Next.js cache
   rm -rf .next
   ```

4. **Build errors**
   ```bash
   # Clear Next.js cache and rebuild
   rm -rf .next
   npm run build
   ```

5. **API connection issues**
   ```bash
   # Verify backend is running
   curl http://localhost:3000/health
   
   # Check environment variables
   cat .env.local
   
   # Ensure NEXT_PUBLIC_API_URL is correct
   ```

6. **Hot reload not working**
   ```bash
   # Restart development server
   # On Windows: Ctrl+C, then npm run dev
   # On Mac/Linux: Cmd+C, then npm run dev
   ```

7. **Authentication errors**
   - Clear browser local storage: DevTools > Application > Local Storage > Clear
   - Check token expiration in browser console
   - Verify backend JWT_SECRET matches

8. **Styling issues**
   ```bash
   # Clear Tailwind cache
   rm -rf .next
   
   # Verify Tailwind is generating classes
   npm run build
   ```

### Debug Mode

Enable debug mode for detailed logging:

```bash
# Add to .env.local
NEXT_PUBLIC_DEBUG=true

# View logs in browser console
```

### Performance Issues

If the app feels slow:

1. Check bundle size: `npm run build` (look for large chunks)
2. Use React DevTools Profiler to identify slow components
3. Verify API responses are being cached (check Network tab)
4. Ensure images are optimized (use Next.js Image component)

### Getting Help

- Check the [main project documentation](../README.md)
- Review [Next.js documentation](https://nextjs.org/docs)
- Search existing [GitHub issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- Create a new issue with:
  - Clear description of the problem
  - Steps to reproduce
  - Error messages or screenshots
  - Environment details (OS, Node version, browser)

## 📝 Contributing

### Development Workflow

1. **Fork and clone** the repository
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Install dependencies**: `npm install`
4. **Make changes** and test thoroughly
5. **Run checks**: `npm run lint && npm run type-check && npm test`
6. **Commit**: `git commit -m "feat: add my feature"`
7. **Push**: `git push origin feature/my-feature`
8. **Open a Pull Request** with a clear description

### Coding Standards

- **TypeScript**: Use proper types, avoid `any`
- **Components**: Keep under 200 lines, split if larger
- **Naming**: Use PascalCase for components, camelCase for functions
- **Comments**: Add JSDoc for complex functions
- **Testing**: Write tests for new features
- **Commits**: Follow conventional commits (feat, fix, docs, etc.)

### Code Review Checklist

Before submitting a PR, ensure:
- [ ] Code follows TypeScript and ESLint rules
- [ ] Components are properly typed
- [ ] Tests are added/updated
- [ ] No console.log statements
- [ ] Changes are documented in code comments
- [ ] PR description explains what and why
- [ ] Screenshots included for UI changes

## 🧪 Testing

### Unit Tests (Jest)

```bash
# Run all tests
npm test

# Run specific test file
npm test -- UrlCard.test.tsx

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

**Test Structure:**
```typescript
// src/components/UrlCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { UrlCard } from './UrlCard';

describe('UrlCard', () => {
  it('renders URL information', () => {
    const url = { shortCode: 'abc123', originalUrl: 'https://example.com' };
    render(<UrlCard url={url} />);
    
    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('calls onDelete when delete button clicked', () => {
    const handleDelete = jest.fn();
    const url = { shortCode: 'abc123', originalUrl: 'https://example.com' };
    render(<UrlCard url={url} onDelete={handleDelete} />);
    
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(handleDelete).toHaveBeenCalledWith('abc123');
  });
});
```

### Integration Tests

```bash
# Run integration tests only
npm run test:integration
```

### End-to-End Tests (Playwright)

```bash
# Run E2E tests (headless)
npm run test:e2e

# Run with visible browser
npm run test:e2e:headed

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run specific test file
npx playwright test tests/auth.spec.ts

# Debug mode
npm run test:e2e:debug
```

**E2E Test Structure:**
```typescript
// tests/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('user can login', async ({ page }) => {
    await page.goto('http://localhost:3001');
    await page.click('text=Login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('text=Welcome')).toBeVisible();
  });
});
```

## 🏗️ Building & Deployment

### Production Build

```bash
# Create optimized production build
npm run build

# Output: .next/ folder with optimized assets
```

**Build Process:**
1. TypeScript compilation
2. Code optimization and minification
3. Static page generation
4. Image optimization
5. Bundle size analysis

### Running Production Build Locally

```bash
# Build first
npm run build

# Start production server
npm start

# Access at http://localhost:3000
```

### Deployment Options

#### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Deploy to production
vercel --prod
```

#### Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Build
npm run build

# Deploy
netlify deploy --dir=.next
```

#### Docker

```dockerfile
# Dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3001
CMD ["npm", "start"]
```

```bash
# Build image
docker build -t snapurl-frontend .

# Run container
docker run -p 3001:3001 \
  -e NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1 \
  snapurl-frontend
```

### Environment Variables for Production

Create `.env.production` file:

```bash
NEXT_PUBLIC_API_URL=https://api.snapurl.in/api/v1
NEXT_PUBLIC_APP_URL=https://app.snapurl.in
NEXT_PUBLIC_ENVIRONMENT=production
NEXT_PUBLIC_APP_NAME=SnapURL
```

### Deployment Checklist

Before deploying to production:

- [ ] Update environment variables in `.env.production`
- [ ] Run production build locally: `npm run build && npm start`
- [ ] Test all critical user flows
- [ ] Check bundle size: Look for large chunks in build output
- [ ] Verify API endpoints are accessible
- [ ] Test authentication flow
- [ ] Check responsive design on mobile
- [ ] Run Lighthouse audit for performance
- [ ] Set up error tracking (Sentry, LogRocket)
- [ ] Configure analytics (Google Analytics, Plausible)
- [ ] Set up monitoring and alerts

### Performance Optimization

To optimize bundle size:

1. **Analyze bundle**: Add to `next.config.ts`:
   ```typescript
   const withBundleAnalyzer = require('@next/bundle-analyzer')({
     enabled: process.env.ANALYZE === 'true',
   });
   
   module.exports = withBundleAnalyzer({
     // your config
   });
   ```
   Run: `ANALYZE=true npm run build`

2. **Dynamic imports** for large components:
   ```typescript
   import dynamic from 'next/dynamic';
   const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
     loading: () => <Skeleton />,
   });
   ```

3. **Optimize images**: Always use Next.js Image component

4. **Remove unused dependencies**: Run `npm prune`

## 🎯 Component Architecture

### Component Types

**1. Page Components** (`src/app/*/page.tsx`)
- Entry points for routes
- Fetch data using async functions
- Pass data to client components
- Keep minimal logic

**2. Layout Components** (`src/app/*/layout.tsx`)
- Wrap pages with shared UI
- Manage metadata
- Provider setup

**3. UI Components** (`src/components/ui/`)
- Reusable, atomic components
- No business logic
- Accept props, emit events
- Fully typed interfaces

**4. Feature Components** (`src/components/[feature]/`)
- Feature-specific components
- Can contain business logic
- Use hooks for data fetching
- Compose UI components

### Example Component Structure

```typescript
// src/components/urls/UrlCard.tsx
import { Card, CardContent, IconButton } from '@mui/material';
import { Delete, Edit } from '@mui/icons-material';
import type { Url } from '@/types/url';

interface UrlCardProps {
  url: Url;
  onEdit?: (url: Url) => void;
  onDelete?: (urlId: string) => void;
  isLoading?: boolean;
}

export const UrlCard: React.FC<UrlCardProps> = ({
  url,
  onEdit,
  onDelete,
  isLoading = false,
}) => {
  return (
    <Card>
      <CardContent>
        <h3>{url.shortCode}</h3>
        <p>{url.originalUrl}</p>
        <div>
          {onEdit && (
            <IconButton onClick={() => onEdit(url)} disabled={isLoading}>
              <Edit />
            </IconButton>
          )}
          {onDelete && (
            <IconButton onClick={() => onDelete(url.id)} disabled={isLoading}>
              <Delete />
            </IconButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
```

### Best Practices

1. **Props**: Define clear interfaces, use TypeScript
2. **Composition**: Build complex UIs from simple components
3. **Separation**: Keep logic in hooks, UI in components
4. **Testing**: Write tests for user interactions
5. **Accessibility**: Include ARIA labels and keyboard support

## 🔄 Routing

### Next.js App Router

The app uses Next.js 15 App Router with file-based routing:

- `app/page.tsx` → `/`
- `app/dashboard/page.tsx` → `/dashboard`
- `app/profile/page.tsx` → `/profile`
- `app/admin/users/page.tsx` → `/admin/users`

### Route Groups

Parentheses create route groups without affecting URL:

- `app/(auth)/login/page.tsx` → `/login`
- `app/(auth)/register/page.tsx` → `/register`
- Both share `app/(auth)/layout.tsx`

### Dynamic Routes

```typescript
// app/urls/[id]/page.tsx
export default function UrlDetailsPage({ params }: { params: { id: string } }) {
  const { id } = params;
  // Fetch URL with id
  return <div>URL Details for {id}</div>;
}
```

### Navigation

```typescript
// Client component
'use client';
import { useRouter } from 'next/navigation';

export function MyComponent() {
  const router = useRouter();
  
  const handleClick = () => {
    router.push('/dashboard');
  };
  
  return <button onClick={handleClick}>Go to Dashboard</button>;
}
```

### Protected Routes

```typescript
// app/(dashboard)/layout.tsx
import { AuthGuard } from '@/components/auth/AuthGuard';

export default function DashboardLayout({ children }) {
  return (
    <AuthGuard requiredRole="user">
      <div>
        <Sidebar />
        <main>{children}</main>
      </div>
    </AuthGuard>
  );
}
```

## 🎨 Styling

### Styling Approaches

The app uses three styling methods:

**1. Material-UI Components** (Primary)
```typescript
import { Button, TextField } from '@mui/material';

<Button variant="contained" color="primary">
  Click Me
</Button>
```

**2. Tailwind Utilities** (Layout & Spacing)
```typescript
<div className="flex items-center justify-between p-4 gap-2">
  <h1 className="text-2xl font-bold">Title</h1>
</div>
```

**3. Emotion Styled Components** (Custom Styles)
```typescript
import styled from '@emotion/styled';

const StyledCard = styled.div`
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;
```

### Theme Configuration

```typescript
// src/lib/theme/theme.ts
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2',
      light: '#42a5f5',
      dark: '#1565c0',
    },
    secondary: {
      main: '#9c27b0',
    },
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
  },
});
```

### Responsive Design

Use Material-UI breakpoints:

```typescript
import { useMediaQuery, useTheme } from '@mui/material';

function MyComponent() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  
  return (
    <div>
      {isMobile ? <MobileView /> : <DesktopView />}
    </div>
  );
}
```

## ✅ Code Quality

### Linting

```bash
# Run ESLint
npm run lint

# Fix auto-fixable issues
npm run lint:fix
```

**ESLint Configuration** (`eslint.config.mjs`):
- Next.js recommended rules
- TypeScript strict rules
- React hooks rules
- Prettier integration

### Formatting

```bash
# Check formatting
npm run format:check

# Format all files
npm run format
```

**Prettier Configuration** (`.prettierrc`):
```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2
}
```

### Type Checking

```bash
# Run TypeScript compiler
npm run type-check
```

### Git Hooks

The project uses Husky for git hooks:

**Pre-commit** (`.husky/pre-commit`):
- Runs lint-staged
- Lints and formats staged files
- Runs type checking

**Pre-push** (`.husky/pre-push`):
- Runs unit tests
- Ensures all tests pass before push

### CI/CD

The project includes GitHub Actions workflows:

- **Lint & Test**: Runs on every push
- **Build**: Ensures production build succeeds
- **Deploy**: Deploys to production on merge to main

## 📚 Additional Resources

### Documentation

- [Next.js Documentation](https://nextjs.org/docs) - Next.js features and API
- [React Documentation](https://react.dev) - React fundamentals
- [Material-UI Documentation](https://mui.com/material-ui/) - Component library
- [Tailwind CSS](https://tailwindcss.com/docs) - Utility classes
- [TypeScript Handbook](https://www.typescriptlang.org/docs/) - TypeScript guide
- [TanStack Query](https://tanstack.com/query/latest) - Data fetching
- [Zustand](https://docs.pmnd.rs/zustand/getting-started/introduction) - State management

### Learning Resources

- [Next.js Learn](https://nextjs.org/learn) - Interactive Next.js tutorial
- [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/) - TypeScript patterns
- [Web.dev](https://web.dev/learn) - Web development best practices

### Tools

- [Next.js DevTools](https://nextjs.org/docs/app/building-your-application/optimizing/devtools) - Development tools
- [React Developer Tools](https://react.dev/learn/react-developer-tools) - Browser extension
- [TypeScript Playground](https://www.typescriptlang.org/play) - Test TypeScript code

## 📄 License

This project is licensed under the MIT License - see the main project [LICENSE](../LICENSE) file for details.

## 🆘 Support

For support and questions:

- **Documentation**: Check the [main project README](../README.md)
- **Issues**: Create an issue in the [GitHub repository](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- **Discussions**: Join the [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)

---

**Note for AI Coding Tools**: This documentation is optimized for AI understanding. Key conventions:
- All file paths are absolute from project root
- Environment variables are explicitly documented with types and defaults
- API endpoints include full request/response examples
- Component patterns include TypeScript interfaces
- Common issues have specific solutions with exact commands
- No assumptions about implicit behavior or "standard" configurations
