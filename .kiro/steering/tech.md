# Technology Stack & Build System

## Backend Technologies

### Legacy Backend (Express.js)
- **Runtime**: Node.js with ES modules
- **Framework**: Express.js v4
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Passport.js + JWT + bcrypt
- **Security**: CORS, express-rate-limit, express-validator
- **Documentation**: Swagger UI Express + YAML
- **Email**: Nodemailer with EJS templates
- **Utilities**: nanoid, winston logging, node-cron

### Modern Backend (NestJS) - Production Ready
- **Framework**: NestJS v10 with TypeScript
- **Databases**: PostgreSQL (TypeORM) + MongoDB (Mongoose) + Redis
- **Authentication**: Passport.js strategies + JWT + bcrypt
- **Security**: Helmet, throttling, class-validator, RBAC
- **Caching**: Redis with connection pooling
- **Monitoring**: Winston logging, health checks, metrics
- **Testing**: Jest with comprehensive test coverage
- **Build**: TypeScript compilation with path mapping

## Frontend Technologies
- **Framework**: React.js v18
- **Build Tool**: Vite with SWC plugin
- **UI Libraries**: Material-UI, React Bootstrap
- **State Management**: React hooks and context
- **HTTP Client**: Axios
- **Routing**: React Router DOM v6
- **Forms**: Formik + Yup validation
- **Notifications**: React Toastify
- **Utilities**: QR code generation, file-saver, Lottie animations

## Chrome Extension
- **Manifest**: Version 3
- **Permissions**: activeTab only
- **Architecture**: Popup-based with vanilla JavaScript

## Development Tools
- **Code Quality**: ESLint, Prettier, Husky git hooks
- **Testing**: Jest (backend), React Testing Library (frontend)
- **Containerization**: Docker with multi-stage builds
- **CI/CD**: GitHub Actions ready

## Common Build Commands

### Root Level (Monorepo)
```bash
npm install                    # Install all dependencies
npm start                      # Start both frontend and backend
npm run install-frontend       # Install frontend deps only
npm run install-backend        # Install backend deps only
npm run build-frontend         # Build frontend for production
```

### NestJS Backend
```bash
npm run start:dev              # Development with hot reload
npm run start:prod             # Production server
npm run build                  # Build TypeScript to dist/
npm run test                   # Run Jest tests
npm run test:cov               # Test coverage report
npm run test:e2e               # End-to-end tests
npm run lint                   # ESLint check
npm run format                 # Prettier formatting
npm run migration:run          # Run database migrations
npm run validate:env           # Validate environment variables
```

### Legacy Backend
```bash
npm start                      # Start with nodemon
npm run dev                    # Development mode
npm run format                 # Prettier formatting
npm test                       # Mocha tests
```

### Frontend
```bash
npm run dev                    # Vite dev server
npm run build                  # Production build
npm run preview                # Preview production build
npm run lint                   # ESLint check
npm run format                 # Prettier formatting
```

## Environment Configuration
- **Development**: `.env` files for each component
- **Production**: Environment variables via deployment platform
- **Required Variables**: Database URLs, JWT secrets, email config, API endpoints