# Project Structure & Organization

## Repository Layout

This is a monorepo containing multiple related components:

```
├── backend/                   # Legacy Express.js backend
├── nestjs-backend/           # Modern NestJS backend (production-ready)
├── frontend/                 # React.js web application
├── chrome-extension/         # Browser extension
├── designs/                  # UI/UX design assets
├── .github/                  # GitHub workflows and templates
├── .kiro/                    # Kiro AI assistant configuration
└── docs/                     # Project documentation
```

## Backend Structure (NestJS - Preferred)

```
nestjs-backend/src/
├── common/                   # Shared utilities and functionality
│   ├── decorators/          # Custom decorators
│   ├── filters/             # Exception filters
│   ├── guards/              # Auth and authorization guards
│   ├── interceptors/        # Request/response interceptors
│   ├── pipes/               # Validation pipes
│   └── utils/               # Utility functions
├── config/                  # Configuration modules
│   ├── database.module.ts   # Database configuration
│   └── redis.config.ts      # Redis configuration
├── modules/                 # Feature modules
│   ├── auth/                # Authentication module
│   ├── users/               # User management
│   ├── urls/                # URL shortening core
│   ├── admin/               # Admin functionality
│   ├── analytics/           # Analytics and reporting
│   └── domains/             # Custom domain management
├── app.module.ts            # Root application module
└── main.ts                  # Application entry point
```

## Frontend Structure

```
frontend/src/
├── components/              # Reusable UI components
├── pages/                   # Route-based page components
├── hooks/                   # Custom React hooks
├── services/                # API service layer
├── utils/                   # Utility functions
├── contexts/                # React context providers
├── assets/                  # Static assets (images, fonts)
└── styles/                  # Global styles and themes
```

## Legacy Backend Structure (Express.js)

```
backend/
├── controllers/             # Route handlers
├── models/                  # Mongoose schemas
├── routes/                  # Express route definitions
├── middlewares/             # Custom middleware
├── validators/              # Input validation
├── utils/                   # Utility functions
├── views/                   # EJS email templates
├── configs/                 # Configuration files
├── jobs/                    # Scheduled tasks
└── test/                    # Test files
```

## Chrome Extension Structure

```
chrome-extension/
├── manifest.json            # Extension manifest
├── extension.html           # Popup HTML
├── script.js                # Main extension logic
├── history.html             # History page
├── history.js               # History functionality
└── *.png                    # Extension icons
```

## Configuration Files

### Root Level
- `package.json` - Monorepo scripts and dependencies
- `netlify.toml` - Netlify deployment configuration
- `.gitignore` - Git ignore patterns

### Component Level
- Each component has its own `package.json`
- Environment files (`.env`, `.env.example`)
- Build configurations (`vite.config.js`, `nest-cli.json`)
- Code quality configs (`.eslintrc.json`, `.prettierrc`)

## Development Conventions

### File Naming
- **NestJS**: PascalCase for classes, kebab-case for files (`user.service.ts`)
- **React**: PascalCase for components (`UserProfile.jsx`)
- **General**: kebab-case for directories and config files

### Module Organization
- Group related functionality into modules/features
- Keep shared utilities in common directories
- Separate concerns (controllers, services, models)
- Use barrel exports (`index.ts`) for clean imports

### Testing Structure
- Test files alongside source files with `.spec.ts` or `.test.js` suffix
- E2E tests in dedicated `test/` directories
- Mock data and fixtures in `__mocks__/` directories

### Documentation
- README files at component level
- API documentation via Swagger/OpenAPI
- Inline code comments for complex logic
- Architecture decision records in `docs/`

## Deployment Structure

### Production Environments
- **NestJS Backend**: Dockerized on AWS EC2
- **Frontend**: Static build on Netlify
- **Legacy Backend**: PM2 on AWS EC2
- **Chrome Extension**: Chrome Web Store

### Environment Separation
- Development: Local with Docker Compose
- Staging: Similar to production for testing
- Production: Optimized builds with monitoring