# SnapURL 2.0 - Testing Guide

> **Comprehensive Testing**: Unit, integration, E2E, and performance testing strategies

## Testing Philosophy

SnapURL follows a comprehensive testing approach:

- **Unit Tests**: Test individual functions and components
- **Integration Tests**: Test module interactions
- **E2E Tests**: Test complete user workflows
- **Performance Tests**: Test scalability and load handling
- **Security Tests**: Test for vulnerabilities

**Target Coverage**: 80%+ code coverage across backend and frontend

## Backend Testing (NestJS)

### Test Structure

```
backend/
├── src/
│   └── modules/
│       └── urls/
│           ├── urls.service.ts
│           ├── urls.service.spec.ts      # Unit tests
│           ├── urls.controller.ts
│           └── urls.controller.spec.ts   # Unit tests
└── test/
    ├── auth.e2e-spec.ts                  # E2E tests
    ├── urls.e2e-spec.ts
    └── jest-e2e.json                     # E2E config
```

### Unit Tests

**Service Testing**:
```typescript
// urls.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UrlsService } from './urls.service';

describe('UrlsService', () => {
  let service: UrlsService;
  let mockUrlModel: any;

  beforeEach(async () => {
    mockUrlModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlsService,
        {
          provide: getModelToken('Url'),
          useValue: mockUrlModel
        }
      ],
    }).compile();

    service = module.get<UrlsService>(UrlsService);
  });

  describe('create', () => {
    it('should create a short URL', async () => {
      const dto = { originalUrl: 'https://example.com' };
      const expectedUrl = {
        shortCode: 'abc123',
        originalUrl: 'https://example.com',
        userId: 'user-id',
        clicks: 0
      };

      mockUrlModel.create.mockResolvedValue(expectedUrl);

      const result = await service.create(dto, 'user-id');

      expect(result).toEqual(expectedUrl);
      expect(mockUrlModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          originalUrl: dto.originalUrl,
          userId: 'user-id'
        })
      );
    });

    it('should throw error for invalid URL', async () => {
      const dto = { originalUrl: 'invalid-url' };

      await expect(service.create(dto, 'user-id'))
        .rejects.toThrow('Invalid URL format');
    });
  });
});
```

**Controller Testing**:
```typescript
// urls.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { UrlsController } from './urls.controller';
import { UrlsService } from './urls.service';

describe('UrlsController', () => {
  let controller: UrlsController;
  let service: UrlsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UrlsController],
      providers: [
        {
          provide: UrlsService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn()
          }
        }
      ],
    }).compile();

    controller = module.get<UrlsController>(UrlsController);
    service = module.get<UrlsService>(UrlsService);
  });

  describe('create', () => {
    it('should create URL and return response', async () => {
      const dto = { originalUrl: 'https://example.com' };
      const mockUrl = { shortCode: 'abc123', ...dto };
      const req = { user: { userId: 'user-id' } };

      jest.spyOn(service, 'create').mockResolvedValue(mockUrl);

      const result = await controller.create(dto, req);

      expect(result).toEqual(mockUrl);
      expect(service.create).toHaveBeenCalledWith(dto, 'user-id');
    });
  });
});
```

### E2E Tests

**Testing Complete Workflows**:
```typescript
// test/urls.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('URLs (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let shortCode: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Login to get access token
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'test@test.com',
        password: 'Test123!'
      });

    accessToken = loginResponse.body.accessToken;
  });

  describe('POST /api/v1/urls', () => {
    it('should create a short URL', () => {
      return request(app.getHttpServer())
        .post('/api/v1/urls')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'https://example.com' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('shortCode');
          expect(res.body.originalUrl).toBe('https://example.com');
          shortCode = res.body.shortCode;
        });
    });

    it('should reject invalid URL', () => {
      return request(app.getHttpServer())
        .post('/api/v1/urls')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ originalUrl: 'not-a-url' })
        .expect(400);
    });

    it('should reject unauthorized request', () => {
      return request(app.getHttpServer())
        .post('/api/v1/urls')
        .send({ originalUrl: 'https://example.com' })
        .expect(401);
    });
  });

  describe('GET /api/v1/urls', () => {
    it('should return user URLs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/urls')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });
  });

  describe('GET /:shortCode', () => {
    it('should redirect to original URL', () => {
      return request(app.getHttpServer())
        .get(`/${shortCode}`)
        .expect(302)
        .expect('Location', 'https://example.com');
    });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

### Running Backend Tests

```bash
cd backend

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run E2E tests
npm run test:e2e

# Run specific test file
npm test -- urls.service.spec.ts

# Run tests matching pattern
npm test -- --testNamePattern="should create"
```

### Coverage Requirements

**Minimum Coverage Targets**:
- Statements: 80%
- Branches: 75%
- Functions: 80%
- Lines: 80%

**Coverage Report**:
```bash
npm run test:cov
# Opens coverage/lcov-report/index.html
```

## Frontend Testing (React + Vite)

### Test Structure

```
frontend/
├── src/
│   └── components/
│       └── UrlShortener/
│           ├── UrlShortener.tsx
│           └── UrlShortener.test.tsx
└── tests/
    └── e2e/
        └── url-shortening.spec.ts       # Playwright E2E
```

### Unit/Component Tests

**React Component Testing**:
```typescript
// UrlShortener.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UrlShortener } from './UrlShortener';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('UrlShortener', () => {
  it('renders input field and button', () => {
    render(<UrlShortener />, { wrapper: createWrapper() });
    
    expect(screen.getByPlaceholderText('Enter URL to shorten')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shorten/i })).toBeInTheDocument();
  });

  it('shortens URL on form submit', async () => {
    const user = userEvent.setup();
    render(<UrlShortener />, { wrapper: createWrapper() });

    const input = screen.getByPlaceholderText('Enter URL to shorten');
    const button = screen.getByRole('button', { name: /shorten/i });

    await user.type(input, 'https://example.com');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/snapurl.in/)).toBeInTheDocument();
    });
  });

  it('displays error for invalid URL', async () => {
    const user = userEvent.setup();
    render(<UrlShortener />, { wrapper: createWrapper() });

    const input = screen.getByPlaceholderText('Enter URL to shorten');
    const button = screen.getByRole('button', { name: /shorten/i });

    await user.type(input, 'invalid-url');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/invalid url/i)).toBeInTheDocument();
    });
  });
});
```

**Hook Testing**:
```typescript
// useUrlShortener.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUrlShortener } from './useUrlShortener';

const createWrapper = () => {
  const queryClient = new QueryClient();
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

describe('useUrlShortener', () => {
  it('creates short URL', async () => {
    const { result } = renderHook(() => useUrlShortener(), {
      wrapper: createWrapper()
    });

    result.current.createUrl('https://example.com');

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toHaveProperty('shortCode');
    });
  });
});
```

### E2E Tests (Playwright)

**Full User Workflow Testing**:
```typescript
// tests/e2e/url-shortening.spec.ts
import { test, expect } from '@playwright/test';

test.describe('URL Shortening', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('http://localhost:5173/login');
    await page.fill('input[name="email"]', 'test@test.com');
    await page.fill('input[name="password"]', 'Test123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  });

  test('should shorten a URL', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('http://localhost:5173/dashboard');

    // Fill URL form
    await page.fill('input[placeholder*="Enter URL"]', 'https://example.com');
    await page.click('button:has-text("Shorten")');

    // Wait for success message
    await expect(page.locator('text=/shortened successfully/i')).toBeVisible();

    // Verify short URL is displayed
    await expect(page.locator('text=/snapurl.in/i')).toBeVisible();
  });

  test('should copy short URL to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    
    await page.goto('http://localhost:5173/dashboard');
    await page.fill('input[placeholder*="Enter URL"]', 'https://example.com');
    await page.click('button:has-text("Shorten")');

    // Click copy button
    await page.click('button[aria-label="Copy"]');

    // Verify clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('snapurl.in');
  });

  test('should display analytics', async ({ page }) => {
    await page.goto('http://localhost:5173/analytics');

    // Wait for analytics to load
    await page.waitForSelector('text=/Total Clicks/i');

    // Verify analytics elements
    await expect(page.locator('text=/Total URLs/i')).toBeVisible();
    await expect(page.locator('text=/Total Clicks/i')).toBeVisible();
  });
});
```

### Running Frontend Tests

```bash
cd frontend

# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run E2E tests
npx playwright test

# Run E2E tests in UI mode
npx playwright test --ui

# Run specific test file
npm test -- UrlShortener.test.tsx
```

## Performance Testing

### Load Testing

**Using Artillery**:
```yaml
# artillery-config.yml
config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100
      name: "Peak load"

scenarios:
  - name: "Create and redirect URL"
    flow:
      - post:
          url: "/api/v1/urls"
          headers:
            Authorization: "Bearer {{token}}"
          json:
            originalUrl: "https://example.com"
          capture:
            - json: "$.shortCode"
              as: "shortCode"
      - get:
          url: "/{{shortCode}}"
          followRedirect: false
```

**Run Load Test**:
```bash
# Install Artillery
npm install -g artillery

# Run test
artillery run artillery-config.yml

# Generate report
artillery run --output report.json artillery-config.yml
artillery report report.json
```

### Benchmark Testing

**API Response Time**:
```typescript
// backend/test/benchmark.spec.ts
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

describe('Performance Benchmarks', () => {
  it('should handle URL creation in < 100ms', async () => {
    const start = Date.now();
    
    await request(app.getHttpServer())
      .post('/api/v1/urls')
      .set('Authorization', `Bearer ${token}`)
      .send({ originalUrl: 'https://example.com' });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);
  });

  it('should handle redirects in < 50ms (cached)', async () => {
    const start = Date.now();
    
    await request(app.getHttpServer())
      .get('/abc123')
      .expect(302);
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(50);
  });
});
```

## Security Testing

### Automated Security Scans

**npm audit**:
```bash
# Check for vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix

# Force fix (may have breaking changes)
npm audit fix --force
```

**OWASP ZAP**:
```bash
# Pull Docker image
docker pull owasp/zap2docker-stable

# Run baseline scan
docker run -t owasp/zap2docker-stable zap-baseline.py \
  -t http://localhost:3000 \
  -r zap-report.html
```

### Manual Security Testing

**Test Cases**:
1. SQL Injection attempts
2. XSS payload injection
3. CSRF token validation
4. Rate limiting enforcement
5. Authentication bypass attempts
6. Authorization escalation

## Test Data Management

### Test Database Setup

**PostgreSQL Test Database**:
```bash
# Create test database
createdb url_shortener_test

# Run migrations
NODE_ENV=test npm run migration:run
```

**Seeding Test Data**:
```typescript
// backend/test/seed-data.ts
export const seedTestData = async () => {
  const testUser = await userRepository.save({
    email: 'test@test.com',
    password: await bcrypt.hash('Test123!', 12),
    username: 'testuser',
    emailVerified: true
  });

  const testUrl = await urlModel.create({
    shortCode: 'test123',
    originalUrl: 'https://example.com',
    userId: testUser.id
  });

  return { testUser, testUrl };
};
```

## CI/CD Testing

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Run Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      
      mongodb:
        image: mongo:6
        
      redis:
        image: redis:7

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: cd backend && npm ci
      
      - name: Run tests
        run: cd backend && npm run test:ci
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          MONGODB_URI: mongodb://localhost:27017/test
          REDIS_URL: redis://localhost:6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/lcov.info

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: cd frontend && npm ci
      
      - name: Run tests
        run: cd frontend && npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/lcov.info
```

## Best Practices

### Test Organization
- One test file per source file
- Group related tests with `describe`
- Use descriptive test names
- Follow AAA pattern (Arrange, Act, Assert)

### Test Independence
- Tests should not depend on each other
- Clean up after each test
- Use fresh test data
- Mock external dependencies

### Performance
- Run unit tests frequently
- Run E2E tests before commits
- Use test databases
- Parallelize when possible

## Troubleshooting Tests

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#testing-issues) for common test failures and solutions.

## Cross-References

- **Development Guide**: [DEVELOPMENT.md](./DEVELOPMENT.md)
- **API Documentation**: [API.md](./API.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0  
**Maintainer**: SnapURL Team
