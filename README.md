# SnapURL: The Beginner-Friendly URL Shortener

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DhananjayThomble/URL-Shortener-App?quickstart=1)
[![GitHub Stars](https://img.shields.io/github/stars/DhananjayThomble/URL-Shortener-App?style=social)](https://github.com/DhananjayThomble/URL-Shortener-App/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](./CHANGELOG.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

SnapURL is a modern, enterprise-grade URL shortener built with NestJS v10 and React. It simplifies the process of converting long URLs into short, shareable links with advanced analytics and security features.

> **🚀 Quick Start with Codespaces**: Click the badge above for a fully configured development environment in 90 seconds - no local setup required! [Learn more](./.devcontainer/README.md)

## 🏗️ Architecture Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                      SnapURL 2.0 Architecture                      │
└────────────────────────────────────────────────────────────────────┘

 ┌─────────────┐         ┌──────────────┐         ┌─────────────┐
 │   Browser   │ ◄─────► │   Frontend   │ ◄─────► │   Backend   │
 │   Clients   │  HTTPS  │ React + Vite │   API   │  NestJS 10  │
 └─────────────┘         └──────────────┘         └──────┬──────┘
                                                          │
                         ┌────────────────────────────────┤
                         │                │               │
                    ┌────▼─────┐    ┌────▼────┐    ┌────▼────┐
                    │PostgreSQL│    │ MongoDB │    │  Redis  │
                    │  Users   │    │  URLs   │    │  Cache  │
                    └──────────┘    └─────────┘    └─────────┘

Key Components:
• Frontend:  React 19 + Vite + TypeScript + Tailwind CSS
• Backend:   NestJS 10 + TypeScript + Node.js 18+
• Databases: PostgreSQL (users) + MongoDB (URLs) + Redis (cache)
• Deploy:    Netlify (frontend) + AWS EC2 (backend)
```

## 📚 Documentation Hub

### 📖 Core Documentation (`docs/`)

Comprehensive guides for developers and AI coding tools:

| Document | Description |
|----------|-------------|
| **[Architecture](./docs/ARCHITECTURE.md)** | System architecture, component breakdown, data flow |
| **[API Reference](./docs/API.md)** | Complete API endpoints, authentication, rate limits |
| **[Development](./docs/DEVELOPMENT.md)** | Workflow, branch strategy, component-specific guidelines |
| **[Deployment](./docs/DEPLOYMENT.md)** | Production deployment guides (AWS, Netlify, Docker) |
| **[Security](./docs/SECURITY.md)** | Security practices, vulnerability reporting |
| **[Database](./docs/DATABASE.md)** | PostgreSQL, MongoDB, Redis architecture and management |
| **[Testing](./docs/TESTING.md)** | Unit, integration, E2E testing strategies |
| **[Troubleshooting](./docs/TROUBLESHOOTING.md)** | Common issues and solutions |
| **[Chrome Extension](./docs/CHROME_EXTENSION.md)** | Browser extension specification |

### 🎯 Component Documentation

- **[Frontend Documentation](./frontend/README.md)** - Complete React + Vite guide with setup, architecture, and deployment
- **[Backend Documentation](./backend/README.md)** - Complete NestJS 10 guide with API docs, security, and monitoring
- **[Codespaces Guide](./.devcontainer/README.md)** - One-click development environment with full Docker stack

## 📋 Quick Links

| Category | Links |
|----------|-------|
| **Application** | [Live App](https://app.snapurl.in) • [API Docs](https://snapurl.in/doc) |
| **Documentation** | [Architecture](./docs/ARCHITECTURE.md) • [API](./docs/API.md) • [Development](./docs/DEVELOPMENT.md) • [Deployment](./docs/DEPLOYMENT.md) |
| **Community** | [Contributing](./CONTRIBUTING.md) • [Code of Conduct](./CODE_OF_CONDUCT.md) • [Roadmap](./ROADMAP.md) |
| **Resources** | [Security Policy](./SECURITY.md) • [Changelog](./CHANGELOG.md) • [License](./LICENSE) |

## Features

- User signup and login.
- Email verification for added security.
- Password reset via email.
- Robust password hashing with Bcrypt.
- Automated email notifications for account creation and password resets.
- URL shortening with randomly generated 10-character strings.
- Visit count tracking for shortened URLs.
- User-specific lists of generated URLs.
- Deletion of shortened URLs.
- Secure API authentication using JSON Web Tokens (JWT).
- Express Rate Limit for API rate limiting.
- Cross-Origin Resource Sharing (CORS) enabled.
- API documentation powered by Swagger.
- Export Generated URLs to Excel file.
- Chrome extension for URL shortening.

## 🚀 Roadmap

See [ROADMAP.md](./ROADMAP.md) for detailed 2025 quarterly goals and long-term vision.

### 2025 Q1 Highlights
- [ ] Chrome Extension MVP
- [ ] Progressive Web App (PWA)
- [ ] API Rate Limit Dashboard

### 2025 Q2 Highlights
- [ ] Custom Domain Support
- [ ] Bundled URLs
- [ ] Link Expiration
- [ ] Password-Protected URLs

[View Complete Roadmap →](./ROADMAP.md)

## Tech Stack

### 📊 Technology Overview

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19 • Vite • TypeScript • Tailwind CSS • Radix UI • TanStack Query • Zustand |
| **Backend** | NestJS 10 • Node.js 18+ • TypeScript 5 • Passport.js • Winston |
| **Databases** | PostgreSQL 15 • MongoDB 6 • Redis 7 |
| **DevOps** | Docker • Docker Compose • GitHub Actions • PM2 • Nginx |
| **Cloud** | AWS EC2 • Netlify • MongoDB Atlas • Redis Cloud |
| **Monitoring** | Winston • CloudWatch • Prometheus • Health Checks |

### Backend (NestJS)

**Framework & Runtime:**
- NestJS v10 - Progressive Node.js framework
- Node.js v18+ - JavaScript runtime
- TypeScript v5 - Type-safe JavaScript

**Databases:**
- PostgreSQL 15 - User management and authentication
- MongoDB 6 - URL storage and analytics
- Redis 7 - Caching and session management

**Key Libraries:**
- TypeORM - PostgreSQL ORM with migrations
- Mongoose - MongoDB object modeling
- Passport.js - Authentication (JWT, Local)
- bcrypt - Password hashing
- Winston - Logging
- Helmet.js - Security headers
- class-validator - Request validation

**See [Backend README](./backend/README.md) for complete tech stack details.**

### Frontend (Next.js)

**Framework & Libraries:**
- Next.js 15 - React framework with App Router
- React 19 - UI library
- TypeScript v5 - Type-safe development

**UI & Styling:**
- Material-UI v7 - Component library
- Tailwind CSS v4 - Utility-first CSS
- Emotion - CSS-in-JS
- Framer Motion - Animations

**State & Data:**
- Zustand - Client state management
- TanStack Query - Server state & caching
- React Hook Form - Form management
- Zod - Schema validation

**See [Frontend README](./frontend/README.md) for complete tech stack details.**

### Chrome Extension

- Vanilla JavaScript
- Chrome Extension APIs
- Material Design components

## 🏗️ Project Structure

```
URL-Shortener-App/
├── frontend/          # Next.js 15 frontend application
│   ├── src/
│   │   ├── app/             # Next.js App Router pages
│   │   ├── components/      # Reusable React components
│   │   ├── lib/             # Utilities and configurations
│   │   ├── stores/          # Zustand state management
│   │   ├── hooks/           # Custom React hooks
│   │   └── types/           # TypeScript type definitions
│   ├── public/              # Static assets
│   ├── tests/               # E2E tests (Playwright)
│   ├── package.json
│   └── README.md            # 📖 Comprehensive frontend documentation
│
├── backend/           # NestJS 10 backend API
│   ├── src/
│   │   ├── modules/         # Feature modules
│   │   │   ├── auth/       # Authentication (JWT, email verification)
│   │   │   ├── users/      # User management
│   │   │   ├── urls/       # URL shortening
│   │   │   └── admin/      # Admin functionality
│   │   ├── common/         # Shared utilities (guards, filters, interceptors)
│   │   ├── config/         # Configuration modules
│   │   ├── migrations/     # Database migrations
│   │   └── main.ts         # Application entry point
│   ├── test/               # E2E tests
│   ├── docs/               # Additional documentation
│   ├── package.json
│   └── README.md           # 📖 Comprehensive backend documentation
│
├── chrome-extension/         # Chrome browser extension
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   └── background.js
│
├── designs/                  # UI/UX design files
├── .github/                  # GitHub workflows and templates
├── CODE_OF_CONDUCT.md       # Community guidelines
├── CONTRIBUTING.md          # Contributing guidelines
├── LICENSE                  # MIT License
└── README.md               # This file (project overview)
```

### Key Directories

- **`frontend/`**: Complete Next.js frontend with Material-UI, Tailwind, and TypeScript. Includes authentication, URL management, analytics dashboard, and QR code generation.

- **`backend/`**: Enterprise-grade NestJS API with hybrid database architecture (PostgreSQL, MongoDB, Redis). Implements JWT authentication, RBAC, rate limiting, and comprehensive monitoring.

- **`chrome-extension/`**: Browser extension for quick URL shortening directly from any webpage.

For detailed documentation on each component, see their respective README files.

## 🚀 Getting Started

### Choose Your Setup Method

```
Which development environment suits you best?

┌─────────────────────────────────────────────────────┐
│       Do you want cloud-based development?          │
└─────────────────┬───────────────────────────────────┘
                  │
         ┌────────┴─────────┐
         │                  │
        YES                NO
         │                  │
    ┌────▼────┐        ┌────▼─────────────────┐
    │Codespace│        │ Local Development    │
    │(90 sec) │        └──────┬───────────────┘
    └─────────┘               │
         │             ┌──────┴──────┐
         │             │             │
         │        ┌────▼────┐   ┌────▼────┐
         │        │ Docker  │   │ Manual  │
         │        │(5 min)  │   │(15 min) │
         │        └─────────┘   └─────────┘
         │
    [Best Choice]   [Recommended]  [Advanced]
    - Zero setup    - Full control  - Custom setup
    - Cloud IDE     - Local env     - Understanding
    - Auto config   - Reproducible  - Each service
```

### Option 1: GitHub Codespaces (Fastest - Recommended)

**Zero setup required!** Get a fully configured cloud development environment in 90 seconds:

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DhananjayThomble/URL-Shortener-App?quickstart=1)

**What's included:**
- ✅ Full Docker stack (PostgreSQL, MongoDB, Redis, Backend API)
- ✅ All npm dependencies pre-installed
- ✅ VS Code extensions configured
- ✅ Environment files auto-generated
- ✅ Admin tools (pgAdmin, Mongo Express, Redis Commander)

**See the [Codespaces Guide](./.devcontainer/README.md) for complete documentation.**

---

### Option 2: Local Setup

#### Prerequisites

Before you begin, ensure you have:

- **Node.js** v18.0+ and npm v9.0+
- **PostgreSQL** 15+ (for backend user management)
- **MongoDB** 6+ (for backend URL storage)
- **Redis** 7+ (for backend caching)
- **Git** for version control
- **Docker** (optional, for simplified setup)

### Quick Start (Using Docker - Recommended)

The fastest way to get the entire application running locally:

```bash
# Clone the repository
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App

# Start backend with Docker (includes all databases)
cd backend
docker-compose up -d
cd ..

# Install and start frontend
cd frontend
npm install
npm run dev
```

**Access the application:**
- Frontend: http://localhost:3001
- Backend API: http://localhost:3000
- API Documentation: http://localhost:3000/docs

### Manual Setup

If you prefer to set up without Docker:

#### 1. Clone the Repository

```bash
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App
```

#### 2. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
npm run migration:run

# Start backend
npm run start:dev
```

**Backend will run on http://localhost:3000**

See [Backend README](./backend/README.md) for detailed setup instructions.

#### 3. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
echo 'NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1' > .env.local
echo 'NEXT_PUBLIC_APP_URL=http://localhost:3001' >> .env.local

# Start frontend
npm run dev
```

**Frontend will run on http://localhost:3001**

See [Frontend README](./frontend/README.md) for detailed setup instructions.

#### 4. Setup Chrome Extension (Optional)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chrome-extension` directory
5. The extension icon will appear in your toolbar

### Environment Configuration

**Backend (.env):**
```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/url_shortener
MONGODB_URI=mongodb://localhost:27017/url_shortener
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-key
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
FRONTEND_URL=http://localhost:3001
```

**Frontend (.env.local):**
```bash
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

### Verify Installation

Test the backend API:
```bash
curl http://localhost:3000/health
```

You should see a success response with database status.

## 🌐 Deployment

### Production Deployment

The application is deployed on:

- **Frontend**: Netlify - [https://app.snapurl.in](https://app.snapurl.in)
- **Backend**: AWS EC2 (Ubuntu) with PM2 process manager
- **API Documentation**: [https://snapurl.in/doc](https://snapurl.in/doc)

### Deployment Guides

For detailed deployment instructions:

- **Backend Deployment**: See [Backend README - Deployment Section](./backend/README.md#-building--deployment)
  - Docker deployment
  - AWS EC2 setup
  - Heroku deployment
  - DigitalOcean App Platform
  - CI/CD pipeline setup

- **Frontend Deployment**: See [Frontend README - Deployment Section](./frontend/README.md#-building--deployment)
  - Vercel deployment
  - Netlify deployment
  - Docker deployment
  - Build optimization

## 🤝 Contributing

SnapURL welcomes contributions from the community! Whether you're fixing bugs, adding features, improving documentation, or suggesting ideas, we appreciate your help.

### How to Contribute

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch**: `git checkout -b feature/amazing-feature`
4. **Make your changes** following our code style guidelines
5. **Test your changes** thoroughly
6. **Commit your changes**: `git commit -m 'feat: add amazing feature'`
7. **Push to your fork**: `git push origin feature/amazing-feature`
8. **Open a Pull Request** with a clear description

### Contribution Guidelines

- Follow the coding standards outlined in [CONTRIBUTING.md](./CONTRIBUTING.md)
- Write tests for new features
- Update documentation as needed
- Follow conventional commit messages
- Be respectful and follow our [Code of Conduct](./CODE_OF_CONDUCT.md)

### Component-Specific Guidelines

- **Frontend**: See [Frontend Contributing Guide](./frontend/README.md#-contributing)
- **Backend**: See [Backend Contributing Guide](./backend/README.md#-contributing)

### Areas Where You Can Help

- 🐛 Report bugs and issues
- 💡 Suggest new features
- 📝 Improve documentation
- 🧪 Write tests
- 🎨 Improve UI/UX
- 🌐 Add translations
- 🔧 Fix bugs
- ⚡ Optimize performance

## 📚 Additional Resources

- **Documentation**:
  - [Frontend README](./frontend/README.md) - Complete frontend guide
  - [Backend README](./backend/README.md) - Complete backend guide
  - [Wiki](https://github.com/DhananjayThomble/URL-Shortener-App/wiki) - Project wiki
  
- **Development**:
  - [Contributing Guide](./CONTRIBUTING.md) - How to contribute
  - [Code of Conduct](./CODE_OF_CONDUCT.md) - Community guidelines
  - [Milestones](https://github.com/DhananjayThomble/URL-Shortener-App/milestones) - Roadmap
  
- **Live Application**:
  - [Frontend App](https://app.snapurl.in) - Web application
  - [API Documentation](https://snapurl.in/doc) - Interactive API docs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🌟 Show Your Support

If you find SnapURL useful, please consider:
- ⭐ Starring the repository
- 🐦 Sharing on social media
- 📝 Writing a blog post
- 💬 Spreading the word

## 📧 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/DhananjayThomble/URL-Shortener-App/issues)
- **Discussions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
- **Email**: support@snapurl.in

---

**Made with ❤️ by the SnapURL community**

Enjoy your journey with SnapURL! 🚀

