# SnapURL 2.0 - Development Guide

> **Developer-Friendly**: Complete workflow with copy-pasteable commands and real examples

## Development Environment Setup

### Prerequisites

Ensure you have the following installed:

| Tool | Minimum Version | Recommended | Purpose |
|------|----------------|-------------|---------|
| **Node.js** | 18.0.0 | 20.x LTS | Runtime environment |
| **npm** | 9.0.0 | 10.x | Package manager |
| **Git** | 2.30.0 | Latest | Version control |
| **Docker** | 20.10 | Latest | Container runtime (optional) |
| **PostgreSQL** | 15.0 | 15.x | User database (if not using Docker) |
| **MongoDB** | 6.0 | 6.x | URL database (if not using Docker) |
| **Redis** | 7.0 | 7.x | Cache (if not using Docker) |

### Setup Decision Tree

```
┌─────────────────────────────────────┐
│  Choose Your Development Method     │
└─────────────────────────────────────┘
              │
      ┌───────┴───────┐
      │               │
   ┌──▼──┐        ┌───▼────┐
   │Cloud│        │ Local  │
   └──┬──┘        └───┬────┘
      │               │
      │          ┌────┴─────┐
      │          │          │
   ┌──▼─────┐  ┌─▼───┐  ┌──▼────┐
   │Codespace│ │Docker│  │Manual │
   └─────────┘  └──────┘  └───────┘

Recommended: Codespaces (fastest)
Alternative: Docker (full control)
Advanced: Manual (custom setup)
```

### Option 1: GitHub Codespaces (Recommended)

**One-click setup - No local installation required!**

1. Click the badge in [README.md](../README.md)
2. Wait 90 seconds for automatic setup
3. Start coding immediately

**See**: [.devcontainer/README.md](../.devcontainer/README.md) for complete Codespaces guide.

### Option 2: Docker Setup (Recommended for Local)

**Full stack with one command:**

```bash
# Clone repository
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App

# Start backend with all databases
cd backend
docker-compose up -d
cd ..

# Start frontend
cd frontend
npm install
npm run dev
```

**Access services:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Swagger Docs: http://localhost:3000/docs
- PostgreSQL: localhost:5432
- MongoDB: localhost:27017
- Redis: localhost:6379

### Option 3: Manual Setup

#### Step 1: Install Dependencies

```bash
# Root directory - installs both frontend and backend
npm install

# Or install separately
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

#### Step 2: Setup PostgreSQL

```bash
# Install PostgreSQL
# macOS
brew install postgresql@15
brew services start postgresql@15

# Ubuntu/Debian
sudo apt update
sudo apt install postgresql-15
sudo systemctl start postgresql

# Create database
psql -U postgres
CREATE DATABASE url_shortener;
CREATE USER snapurl WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE url_shortener TO snapurl;
\q
```

#### Step 3: Setup MongoDB

```bash
# Install MongoDB
# macOS
brew tap mongodb/brew
brew install mongodb-community@6.0
brew services start mongodb-community@6.0

# Ubuntu/Debian
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt update
sudo apt install -y mongodb-org
sudo systemctl start mongod

# Create database
mongosh
use url_shortener
db.createUser({
  user: "snapurl",
  pwd: "your_password",
  roles: ["readWrite"]
})
```

#### Step 4: Setup Redis

```bash
# Install Redis
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt install redis-server
sudo systemctl start redis-server

# Test connection
redis-cli ping
# Should return: PONG
```

#### Step 5: Configure Environment

**Backend (.env):**
```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```bash
# Database
DATABASE_URL=postgresql://snapurl:your_password@localhost:5432/url_shortener
MONGODB_URI=mongodb://snapurl:your_password@localhost:27017/url_shortener
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters-long
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Email (Gmail example)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-specific-password
EMAIL_FROM=noreply@snapurl.in

# URLs
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:3000
SHORT_URL_BASE=http://localhost:3000

# Environment
NODE_ENV=development
PORT=3000
```

**Frontend (.env.local):**
```bash
cd frontend
cat > .env.local << EOF
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_APP_URL=http://localhost:5173
EOF
```

#### Step 6: Run Database Migrations

```bash
cd backend
npm run migration:run
```

#### Step 7: Start Development Servers

```bash
# Terminal 1: Start backend
cd backend
npm run start:dev

# Terminal 2: Start frontend
cd frontend
npm run dev
```

## Development Workflow

### Branch Strategy

We follow **Git Flow** branching model:

```
main (production)
  ↑
  └─ develop (integration)
       ↑
       ├─ feature/add-custom-domains
       ├─ feature/qr-code-styles
       ├─ bugfix/url-validation
       └─ hotfix/security-patch
```

**Branch Naming Convention:**
- `feature/` - New features (e.g., `feature/add-qr-styles`)
- `bugfix/` - Bug fixes (e.g., `bugfix/fix-redirect-loop`)
- `hotfix/` - Critical production fixes (e.g., `hotfix/security-vulnerability`)
- `refactor/` - Code refactoring (e.g., `refactor/optimize-queries`)
- `docs/` - Documentation updates (e.g., `docs/update-api-guide`)

### Creating a New Feature

```bash
# 1. Update local main branch
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feature/add-custom-domains

# 3. Make changes and commit
git add .
git commit -m "feat: add custom domain support"

# 4. Push and create PR
git push origin feature/add-custom-domains
gh pr create --base main --title "Add custom domain support"
```

### Working with Issues

```bash
# Assign issue to yourself
gh issue develop 123 --checkout

# Link commits to issue
git commit -m "feat: implement feature X (fixes #123)"

# Reference multiple issues
git commit -m "fix: resolve bug Y (fixes #123, refs #456)"
```

### Code Quality Workflow

#### Before Every Commit

```bash
# Backend
cd backend

# 1. Lint code
npm run lint

# 2. Format code
npm run format

# 3. Run tests
npm run test

# 4. Check types
npm run build

# Optional: Run all quality checks
npm run quality:check
```

```bash
# Frontend
cd frontend

# 1. Lint code
npm run lint

# 2. Run tests
npm run test

# 3. Build check
npm run build
```

### Commit Message Convention

We follow **Conventional Commits** specification:

**Format:**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

**Examples:**

```bash
# Feature
git commit -m "feat(urls): add custom domain support"

# Bug fix
git commit -m "fix(auth): resolve token expiration issue"

# Breaking change
git commit -m "feat(api): change URL response format

BREAKING CHANGE: URL response now includes analytics data"

# Multiple changes
git commit -m "feat(urls): add QR code generation

- Add QR code endpoint
- Support multiple formats (PNG, SVG)
- Add size customization
- Update documentation

Closes #123"
```

### Pull Request Process

#### 1. Before Creating PR

**Checklist:**
- [ ] Code is tested locally
- [ ] All tests pass (`npm run test`)
- [ ] Code is linted and formatted
- [ ] Documentation is updated
- [ ] Commit messages follow convention
- [ ] Branch is up-to-date with main

#### 2. Create Pull Request

```bash
# Using GitHub CLI
gh pr create \
  --title "feat: add custom domain support" \
  --body "## Description
Adds support for custom domains for branded short URLs.

## Changes
- Add domain validation logic
- Create domain management endpoints
- Update frontend UI
- Add tests

## Testing
- Unit tests: ✅
- Integration tests: ✅
- Manual testing: ✅

## Screenshots
[Add screenshots for UI changes]

Closes #123" \
  --label "enhancement" \
  --assignee @me
```

#### 3. PR Review Process

**As Author:**
1. Wait for CI checks to pass
2. Address review comments
3. Push updates to same branch
4. Re-request review after changes

**As Reviewer:**
1. Check code quality and logic
2. Verify tests are adequate
3. Test locally if needed
4. Approve or request changes

#### 4. Merge Strategies

**Squash and Merge (Default):**
```bash
# Combines all commits into one
gh pr merge 123 --squash
```

**Regular Merge:**
```bash
# Preserves all commits
gh pr merge 123 --merge
```

**Rebase and Merge:**
```bash
# Linear history
gh pr merge 123 --rebase
```

## Component-Specific Guidelines

### Backend Development (NestJS)

#### Creating a New Module

```bash
cd backend

# Generate module with CLI
nest generate module features/custom-domains
nest generate service features/custom-domains
nest generate controller features/custom-domains

# Or use shorthand
nest g mo features/custom-domains
nest g s features/custom-domains
nest g co features/custom-domains
```

#### Adding a New Endpoint

**Controller (custom-domains.controller.ts):**
```typescript
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CreateDomainDto } from './dto/create-domain.dto';

@ApiTags('Custom Domains')
@Controller('api/v1/domains')
export class CustomDomainsController {
  constructor(private readonly domainsService: CustomDomainsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add custom domain' })
  async create(@Body() createDomainDto: CreateDomainDto) {
    return this.domainsService.create(createDomainDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List custom domains' })
  async findAll() {
    return this.domainsService.findAll();
  }
}
```

**DTO (create-domain.dto.ts):**
```typescript
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDomainDto {
  @ApiProperty({
    description: 'Domain name',
    example: 'link.example.com'
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/, {
    message: 'Invalid domain format'
  })
  domain: string;
}
```

#### Writing Tests

**Unit Test (custom-domains.service.spec.ts):**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { CustomDomainsService } from './custom-domains.service';

describe('CustomDomainsService', () => {
  let service: CustomDomainsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomDomainsService],
    }).compile();

    service = module.get<CustomDomainsService>(CustomDomainsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a custom domain', async () => {
      const domain = { domain: 'link.example.com' };
      const result = await service.create(domain);
      
      expect(result).toBeDefined();
      expect(result.domain).toBe(domain.domain);
    });
  });
});
```

**E2E Test (custom-domains.e2e-spec.ts):**
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '@/app.module';

describe('CustomDomainsController (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Login to get token
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'test@test.com', password: 'Test123!' });
    
    accessToken = loginRes.body.accessToken;
  });

  it('/domains (POST)', () => {
    return request(app.getHttpServer())
      .post('/api/v1/domains')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ domain: 'link.example.com' })
      .expect(201)
      .expect((res) => {
        expect(res.body.domain).toBe('link.example.com');
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### Frontend Development (React + Vite)

#### Creating a New Component

```bash
cd frontend/src/components

# Create component directory
mkdir CustomDomainManager
cd CustomDomainManager

# Create component files
touch CustomDomainManager.tsx
touch CustomDomainManager.test.tsx
touch index.ts
```

**Component (CustomDomainManager.tsx):**
```typescript
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';

interface Domain {
  id: string;
  domain: string;
  verified: boolean;
}

export const CustomDomainManager: React.FC = () => {
  const [domain, setDomain] = useState('');

  // Fetch domains
  const { data: domains, isLoading } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: async () => {
      const res = await fetch('/api/v1/domains', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });
      return res.json();
    }
  });

  // Add domain mutation
  const addDomain = useMutation({
    mutationFn: async (domain: string) => {
      const res = await fetch('/api/v1/domains', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ domain })
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Domain added successfully' });
      setDomain('');
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="link.example.com"
        />
        <Button onClick={() => addDomain.mutate(domain)}>
          Add Domain
        </Button>
      </div>
      
      {isLoading ? (
        <div>Loading...</div>
      ) : (
        <div className="space-y-2">
          {domains?.map((d) => (
            <div key={d.id} className="p-4 border rounded">
              {d.domain}
              {d.verified ? ' ✓' : ' (unverified)'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

**Test (CustomDomainManager.test.tsx):**
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CustomDomainManager } from './CustomDomainManager';

const queryClient = new QueryClient();

const wrapper = ({ children }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('CustomDomainManager', () => {
  it('renders domain input', () => {
    render(<CustomDomainManager />, { wrapper });
    expect(screen.getByPlaceholderText('link.example.com')).toBeInTheDocument();
  });

  it('adds domain on button click', async () => {
    const user = userEvent.setup();
    render(<CustomDomainManager />, { wrapper });

    await user.type(screen.getByPlaceholderText('link.example.com'), 'test.com');
    await user.click(screen.getByText('Add Domain'));

    await waitFor(() => {
      expect(screen.getByText('test.com')).toBeInTheDocument();
    });
  });
});
```

## Debugging

### Backend Debugging (NestJS)

**VS Code Configuration (.vscode/launch.json):**
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug NestJS",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "start:debug"],
      "cwd": "${workspaceFolder}/backend",
      "console": "integratedTerminal",
      "restart": true,
      "protocol": "inspector",
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

**Debug with Logs:**
```typescript
import { Logger } from '@nestjs/common';

export class UrlsService {
  private readonly logger = new Logger(UrlsService.name);

  async create(dto: CreateUrlDto) {
    this.logger.debug(`Creating URL: ${dto.originalUrl}`);
    // ... logic
    this.logger.log('URL created successfully');
  }
}
```

### Frontend Debugging (React)

**Chrome DevTools:**
1. Open Chrome DevTools (F12)
2. Go to Sources tab
3. Set breakpoints in source files
4. Trigger component render/action

**React DevTools:**
```bash
# Install extension
# Chrome: https://chrome.google.com/webstore/detail/react-developer-tools/
# Firefox: https://addons.mozilla.org/en-US/firefox/addon/react-devtools/
```

**Console Debugging:**
```typescript
// Add debug logs
console.log('Component rendered:', { props, state });
console.table(data); // Table format
console.trace(); // Stack trace
```

## Common Development Tasks

### Adding a Database Migration

```bash
cd backend

# Create migration
npm run migration:create -- src/migrations/AddCustomDomains

# Edit migration file, then run
npm run migration:run

# Revert if needed
npm run migration:revert
```

### Updating Dependencies

```bash
# Check outdated packages
npm outdated

# Update all packages
npm update

# Update specific package
npm update <package-name>

# Update to latest (including breaking changes)
npm install <package-name>@latest
```

### Running Tests

```bash
# Backend
cd backend
npm run test              # All tests
npm run test:watch        # Watch mode
npm run test:cov          # With coverage
npm run test:e2e          # E2E tests only

# Frontend
cd frontend
npm run test              # All tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage
```

### Database Management

```bash
# Backup database
cd backend
npm run db:backup

# Restore database
npm run db:restore

# Seed database with test data
npm run seed:db

# Check database health
npm run db:health
```

## Performance Optimization

### Backend Performance

**Database Query Optimization:**
```typescript
// Bad: N+1 query problem
const urls = await this.urlRepository.find();
for (const url of urls) {
  url.user = await this.userRepository.findOne(url.userId);
}

// Good: Use relations
const urls = await this.urlRepository.find({
  relations: ['user']
});
```

**Caching:**
```typescript
// Cache frequently accessed data
@Injectable()
export class UrlsService {
  async findByShortCode(shortCode: string) {
    // Check cache first
    const cached = await this.cacheService.get(`url:${shortCode}`);
    if (cached) return cached;

    // Query database
    const url = await this.urlRepository.findOne({ shortCode });
    
    // Store in cache
    await this.cacheService.set(`url:${shortCode}`, url, 3600);
    
    return url;
  }
}
```

### Frontend Performance

**Code Splitting:**
```typescript
// Lazy load routes
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Analytics = lazy(() => import('./pages/Analytics'));

<Routes>
  <Route path="/dashboard" element={
    <Suspense fallback={<Loading />}>
      <Dashboard />
    </Suspense>
  } />
</Routes>
```

**Memoization:**
```typescript
// Memoize expensive calculations
const expensiveValue = useMemo(() => {
  return computeExpensiveValue(data);
}, [data]);

// Memoize callbacks
const handleClick = useCallback(() => {
  doSomething(id);
}, [id]);
```

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## Cross-References

- **API Documentation**: [API.md](./API.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Testing Guide**: [TESTING.md](./TESTING.md)
- **Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
