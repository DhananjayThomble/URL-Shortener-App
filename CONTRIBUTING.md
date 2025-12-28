# Contributing to SnapURL

Thank you for your interest in contributing to SnapURL! We welcome contributions from the community to make this project better. This guide will help you get started with contributing code, documentation, or ideas.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Component-Specific Guidelines](#component-specific-guidelines)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Issue Guidelines](#issue-guidelines)

## Code of Conduct

Please review our [Code of Conduct](CODE_OF_CONDUCT.md) before participating in our community. We are committed to providing a welcoming and inspiring environment for everyone.

## Getting Started

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/URL-Shortener-App.git
cd URL-Shortener-App

# Add upstream remote
git remote add upstream https://github.com/DhananjayThomble/URL-Shortener-App.git
```

### 2. Choose Your Development Environment

**Option A: GitHub Codespaces (Recommended)**
- Click the "Open in GitHub Codespaces" badge in README
- Everything is pre-configured in 90 seconds

**Option B: Local with Docker**
```bash
cd backend
docker-compose up -d
cd ../frontend
npm install && npm run dev
```

**Option C: Manual Setup**
- See [Development Guide](./docs/DEVELOPMENT.md) for detailed instructions

### 3. Create a Branch

```bash
# Update your local main branch
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/amazing-feature
```

## Development Workflow

### Using GitHub CLI (Recommended)

```bash
# Install GitHub CLI
# macOS: brew install gh
# Windows: winget install GitHub.cli
# Linux: See https://github.com/cli/cli#installation

# Authenticate
gh auth login

# Create issue and branch in one step
gh issue develop 123 --checkout

# Make changes and commit
git add .
git commit -m "feat: add amazing feature"

# Push and create PR
git push origin feature/amazing-feature
gh pr create --fill
```

### Traditional Git Workflow

```bash
# Make changes
git add .
git commit -m "feat: add amazing feature"

# Push changes
git push origin feature/amazing-feature

# Create PR via GitHub web interface
```

## Component-Specific Guidelines

### Backend Development (NestJS)

#### File Structure
```
backend/src/modules/
└── feature-name/
    ├── feature-name.module.ts        # Module definition
    ├── feature-name.controller.ts    # API endpoints
    ├── feature-name.service.ts       # Business logic
    ├── feature-name.service.spec.ts  # Unit tests
    ├── dto/
    │   ├── create-feature.dto.ts     # Input validation
    │   └── update-feature.dto.ts
    └── entities/
        └── feature.entity.ts         # Database schema
```

#### Creating a New Module

```bash
cd backend

# Generate module, service, and controller
nest g module modules/feature-name
nest g service modules/feature-name
nest g controller modules/feature-name
```

#### Code Example

```typescript
// feature-name.controller.ts
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('Feature Name')
@Controller('api/v1/feature-name')
export class FeatureNameController {
  constructor(private readonly service: FeatureNameService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create feature' })
  async create(@Body() dto: CreateFeatureDto) {
    return this.service.create(dto);
  }
}
```

#### Testing Requirements

```typescript
// feature-name.service.spec.ts
describe('FeatureNameService', () => {
  let service: FeatureNameService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [FeatureNameService],
    }).compile();
    
    service = module.get<FeatureNameService>(FeatureNameService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create feature', async () => {
    const dto = { name: 'Test' };
    const result = await service.create(dto);
    expect(result).toBeDefined();
  });
});
```

### Frontend Development (React + Vite)

#### File Structure
```
frontend/src/
├── components/
│   └── FeatureName/
│       ├── FeatureName.tsx           # Component
│       ├── FeatureName.test.tsx      # Tests
│       └── index.ts                  # Exports
├── hooks/
│   └── useFeatureName.ts             # Custom hook
└── stores/
    └── featureNameStore.ts           # Zustand store
```

#### Component Example

```typescript
// FeatureName.tsx
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

interface FeatureNameProps {
  id: string;
}

export const FeatureName: React.FC<FeatureNameProps> = ({ id }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['feature', id],
    queryFn: () => fetchFeature(id)
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{data?.name}</h2>
      <Button onClick={() => handleAction()}>
        Action
      </Button>
    </div>
  );
};
```

#### Testing Example

```typescript
// FeatureName.test.tsx
import { render, screen } from '@testing-library/react';
import { FeatureName } from './FeatureName';

describe('FeatureName', () => {
  it('renders feature name', () => {
    render(<FeatureName id="123" />);
    expect(screen.getByText(/feature/i)).toBeInTheDocument();
  });
});
```

### Chrome Extension Development

See [Chrome Extension Guide](./docs/CHROME_EXTENSION.md) for extension-specific guidelines.

## Code Style

### Backend (NestJS)

**ESLint & Prettier** are configured. Run before committing:

```bash
cd backend

# Lint check
npm run lint

# Auto-fix issues
npm run lint:fix

# Format code
npm run format

# Run all quality checks
npm run quality:check
```

**Style Guidelines:**
- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Follow SOLID principles
- Use dependency injection
- Prefer composition over inheritance

**Example:**
```typescript
/**
 * Service for managing URL shortening operations
 */
@Injectable()
export class UrlsService {
  constructor(
    @InjectModel(Url.name) private urlModel: Model<Url>,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Creates a shortened URL
   * @param dto - URL creation data
   * @param userId - ID of the user creating the URL
   * @returns The created URL with short code
   */
  async create(dto: CreateUrlDto, userId: string): Promise<Url> {
    // Implementation
  }
}
```

### Frontend (React)

**ESLint** is configured. Run before committing:

```bash
cd frontend

# Lint check
npm run lint

# Auto-fix issues
npm run lint -- --fix
```

**Style Guidelines:**
- Use functional components with hooks
- TypeScript interfaces for props
- Destructure props in component signature
- Use semantic HTML
- Accessible components (ARIA labels)

**Example:**
```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  variant = 'primary',
  disabled = false
}) => {
  return (
    <button
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {label}
    </button>
  );
};
```

## Testing Requirements

### Backend Tests

**Required Coverage**: 80% for new code

```bash
cd backend

# Run tests
npm test

# Run tests with coverage
npm run test:cov

# Run E2E tests
npm run test:e2e
```

**Test Checklist:**
- [ ] Unit tests for services
- [ ] Unit tests for controllers
- [ ] E2E tests for new endpoints
- [ ] Test error cases
- [ ] Test edge cases

### Frontend Tests

```bash
cd frontend

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

**Test Checklist:**
- [ ] Component rendering tests
- [ ] User interaction tests
- [ ] API integration tests (mocked)
- [ ] Error state tests

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style (formatting, no logic change)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks
- **ci**: CI/CD changes

### Examples

```bash
# Simple feature
git commit -m "feat(urls): add custom alias validation"

# Bug fix with issue reference
git commit -m "fix(auth): resolve token refresh issue

Fixes issue where refresh tokens were not being properly validated.

Closes #123"

# Breaking change
git commit -m "feat(api): change URL response format

BREAKING CHANGE: URL endpoints now return analytics data by default.
Use ?analytics=false to exclude analytics."

# Multiple changes
git commit -m "feat(dashboard): add analytics charts

- Add click trend chart
- Add device breakdown pie chart
- Add referrer table
- Update dashboard layout

Closes #45"
```

## Pull Request Process

### 1. Before Creating PR

**Checklist:**
- [ ] Code builds successfully
- [ ] All tests pass
- [ ] Code is linted and formatted
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] Branch is up-to-date with main

```bash
# Update your branch
git checkout main
git pull upstream main
git checkout feature/amazing-feature
git rebase main

# Run checks
cd backend && npm run quality:check && cd ..
cd frontend && npm run lint && npm test && cd ..
```

### 2. Create Pull Request

```bash
# Push to your fork
git push origin feature/amazing-feature

# Create PR with GitHub CLI
gh pr create \
  --title "feat: add amazing feature" \
  --body "## Description
Adds amazing feature that does X.

## Changes
- Added feature X
- Updated documentation
- Added tests

## Testing
- [x] Unit tests pass
- [x] E2E tests pass
- [x] Manual testing completed

## Screenshots
[Add screenshots for UI changes]

Closes #123" \
  --label "enhancement"
```

### 3. PR Template

When creating a PR, include:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Code follows style guidelines
- [ ] All tests pass
- [ ] No breaking changes (or documented)

## Related Issues
Closes #123
```

### 4. Review Process

- Wait for automated checks (CI) to pass
- Address reviewer comments
- Request re-review after changes
- Squash commits if requested
- Merge when approved

## Issue Guidelines

### Reporting Bugs

Use the bug report template and include:

```markdown
**Describe the Bug**
Clear description of what the bug is.

**To Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected Behavior**
What you expected to happen.

**Screenshots**
If applicable.

**Environment:**
- OS: [e.g., macOS 12]
- Browser: [e.g., Chrome 95]
- Version: [e.g., 2.0.0]

**Additional Context**
Any other context about the problem.
```

### Feature Requests

```markdown
**Is your feature request related to a problem?**
Description of the problem.

**Describe the solution you'd like**
Clear description of what you want to happen.

**Describe alternatives you've considered**
Other solutions you've thought about.

**Additional context**
Mockups, examples, etc.
```

### Claiming Issues

```bash
# Using GitHub CLI
gh issue develop 123 --checkout

# Or comment on the issue
# "I'd like to work on this"
```

## Getting Help

- **Documentation**: [docs/](./docs/)
- **Discussions**: [GitHub Discussions](https://github.com/DhananjayThomble/URL-Shortener-App/discussions)
- **Discord**: [Join our Discord](https://discord.gg/snapurl) (coming soon)
- **Email**: support@snapurl.in

## Recognition

Contributors are recognized in:
- [CHANGELOG.md](./CHANGELOG.md)
- GitHub Contributors page
- Annual contributor spotlight

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

**Thank you for contributing to SnapURL!** 🚀
