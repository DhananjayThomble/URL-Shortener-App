# SnapURL Frontend - Next.js 15

A modern, responsive frontend for the SnapURL URL shortener built with Next.js 15, TypeScript, Material-UI v7, and Tailwind CSS.

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

- Node.js 18+
- npm or yarn
- Running SnapURL NestJS backend (see backend documentation)

## 🚀 Getting Started

### 1. Clone and Install

```bash
# Navigate to the frontend directory
cd nextjs-frontend

# Install dependencies
npm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env.local

# Edit environment variables
# Update API_URL to match your backend configuration
```

### 3. Start Development Server

```bash
# Start the development server
npm run dev

# The app will be available at http://localhost:3001
```

## 📁 Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Authentication pages
│   ├── (dashboard)/       # Dashboard pages
│   ├── (public)/          # Public pages
│   ├── admin/             # Admin pages
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # Reusable components
│   ├── ui/               # Base UI components
│   ├── forms/            # Form components
│   ├── charts/           # Analytics charts
│   ├── layout/           # Layout components
│   ├── auth/             # Authentication components
│   ├── urls/             # URL management components
│   ├── analytics/        # Analytics components
│   └── qr/               # QR code components
├── lib/                  # Utilities and configurations
│   ├── api/              # API client and types
│   ├── auth/             # Authentication utilities
│   ├── theme/            # Theme configuration
│   ├── utils/            # Helper functions
│   ├── validations/      # Zod schemas
│   └── constants/        # App constants
├── stores/               # Zustand stores
├── hooks/                # Custom React hooks
├── types/                # TypeScript definitions
└── styles/               # Additional styles
```

## 🔧 Available Scripts

```bash
# Development
npm run dev              # Start development server
npm run build           # Build for production
npm run start           # Start production server

# Code Quality
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint errors
npm run format          # Format code with Prettier
npm run format:check    # Check code formatting
npm run type-check      # Run TypeScript type checking
```

## 🌐 Environment Variables

| Variable                            | Description               | Default                        |
| ----------------------------------- | ------------------------- | ------------------------------ |
| `NEXT_PUBLIC_API_URL`               | Backend API URL           | `http://localhost:3000/api/v1` |
| `NEXT_PUBLIC_APP_URL`               | Frontend app URL          | `http://localhost:3001`        |
| `NEXT_PUBLIC_ENVIRONMENT`           | Environment name          | `development`                  |
| `NEXT_PUBLIC_APP_NAME`              | Application name          | `SnapURL`                      |
| `NEXT_PUBLIC_ENABLE_ANALYTICS`      | Enable analytics features | `true`                         |
| `NEXT_PUBLIC_ENABLE_QR_CODES`       | Enable QR code features   | `true`                         |
| `NEXT_PUBLIC_ENABLE_CUSTOM_DOMAINS` | Enable custom domains     | `true`                         |
| `NEXT_PUBLIC_ENABLE_PWA`            | Enable PWA features       | `true`                         |

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
   ```

2. **Module not found errors**

   ```bash
   # Clear node_modules and reinstall
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **TypeScript errors**

   ```bash
   # Run type checking
   npm run type-check
   ```

4. **Build errors**
   ```bash
   # Clear Next.js cache
   rm -rf .next
   npm run build
   ```

## 📝 Contributing

1. Follow the existing code style and conventions
2. Write TypeScript for all new code
3. Add proper error handling and loading states
4. Test components thoroughly
5. Update documentation as needed

## 📄 License

This project is licensed under the MIT License - see the main project LICENSE file for details.

## 🆘 Support

For support and questions:

- Check the [main project documentation](../README.md)
- Create an issue in the repository
- Review the troubleshooting guide above
