# Developer Guide

Welcome to the SnapURL NestJS Backend! This comprehensive guide will help you get started with development, understand the codebase architecture, and contribute effectively to the project.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Development Environment Setup](#development-environment-setup)
3. [Project Architecture](#project-architecture)
4. [Development Workflow](#development-workflow)
5. [Code Standards](#code-standards)
6. [Testing Guide](#testing-guide)
7. [Database Management](#database-management)
8. [API Development](#api-development)
9. [Security Guidelines](#security-guidelines)
10. [Performance Considerations](#performance-considerations)
11. [Troubleshooting](#troubleshooting)
12. [Contributing](#contributing)

## Quick Start

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 18+**: Download from [nodejs.org](https://nodejs.org/)
- **Docker & Docker Compose**: For database services
- **Git**: For version control
- **VS Code** (recommended): With recommended extensions

### One-Command Setup

```bash
# Clone the repository
git clone <repository-url>
cd nestjs-backend

# Run the automated setup script
npm run setup:dev

# Start development server
npm run start:dev
```

The setup script will:
- Install all dependencies
- Set up environment variables
- Start database services with Docker
- Run initial migrations
- Seed development data

### Manual Setup (Alternative)

If you prefer manual setup or the automated script fails:

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start databases with Docker
docker-compose -f docker-compose.dev.yml up -d

# Run migrations
npm run migration:run

# Seed development data
npm run seed:db

# Start development server
npm run start:dev
```

## Development Environment Setup

### Recommended VS Code Extensions

Install these extensions for the best development experience:

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "bradlc.vscode-tailwindcss",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "ms-vscode.vscode-jest",
    "ms-vscode.vscode-json",
    "redhat.vscode-yaml",
    "ms-vscode.vscode-docker",
    "humao.rest-client"
  ]
}
```

### Environment Configuration

The application uses environment variables for configuration. Key variables:

```bash
# Database connections
DATABASE_URL=postgresql://postgres:password@localhost:5432/url_shortener_dev
MONGODB_URI=mongodb://localhost:27017/url_shortener_dev
REDIS_URL=redis://localhost:6379

# JWT secrets (change in production!)
JWT_SECRET=dev-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production

# Email configuration (for development)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-dev-email@gmail.com
EMAIL_PASS=your-app-password

# Application URLs
FRONTEND_URL=http://localhost:3001
BACKEND_URL=http://localhost:3000
```

### Development Scripts

```bash
# Development
npm run start:dev          # Start with hot reload
npm run start:debug        # Start with debugger

# Code Quality
npm run lint               # Run ESLint
npm run format             # Format code with Prettier
npm run quality:check      # Check code quality
npm run quality:fix        # Fix code quality issues

# Testing
npm run test               # Run unit tests
npm run test:watch         # Run tests in watch mode
npm run test:cov           # Run tests with coverage
npm run test:e2e           # Run end-to-end tests

# Database
npm run migration:run      # Run migrations
npm run migration:revert   # Revert last migration
npm run seed:db           # Seed development data

# Utilities
npm run validate:env       # Validate environment variables
npm run db:health         # Check database connections
```

## Project Architecture

### Directory Structure

```
src/
├── common/                 # Shared utilities and components
│   ├── decorators/        # Custom decorators
│   ├── filters/           # Exception filters
│   ├── guards/            # Authentication/authorization guards
│   ├── interceptors/      # Request/response interceptors
│   ├── pipes/             # Validation pipes
│   └── utils/             # Utility functions
├── config/                # Configuration modules
│   ├── database.config.ts # Database configuration
│   ├── redis.config.ts    # Redis configuration
│   └── app.config.ts      # Application configuration
├── modules/               # Feature modules
│   ├── auth/              # Authentication module
│   ├── users/             # User management
│   ├── urls/              # URL shortening
│   ├── analytics/         # Analytics and reporting
│   ├── bio-pages/         # Bio pages feature
│   ├── tags/              # Tag management
│   └── admin/             # Admin functionality
├── migrations/            # Database migrations
├── types/                 # TypeScript type definitions
├── app.module.ts          # Root application module
└── main.ts               # Application entry point
```

### Module Architecture

Each feature module follows NestJS conventions:

```
modules/example/
├── controllers/           # HTTP request handlers
│   └── example.controller.ts
├── services/             # Business logic
│   └── example.service.ts
├── entities/             # Database entities
│   └── example.entity.ts
├── dto/                  # Data transfer objects
│   ├── create-example.dto.ts
│   └── update-example.dto.ts
├── guards/               # Module-specific guards
├── interfaces/           # TypeScript interfaces
├── constants/            # Module constants
└── example.module.ts     # Module definition
```

### Database Architecture

The application uses a hybrid database approach:

- **PostgreSQL**: User management, authentication, admin data
- **MongoDB**: URL data, analytics, bio pages
- **Redis**: Caching, sessions, rate limiting

## Development Workflow

### Git Workflow

We use a feature branch workflow:

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and commit
git add .
git commit -m "feat: add new feature"

# Push and create pull request
git push origin feature/your-feature-name
```

### Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat: add new feature
fix: resolve bug
docs: update documentation
style: format code
refactor: restructure code
test: add tests
chore: update dependencies
```

### Pre-commit Hooks

Husky runs these checks before each commit:

- ESLint for code quality
- Prettier for code formatting
- Unit tests for affected files
- Commit message validation

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Ensure all checks pass
4. Create pull request with description
5. Request code review
6. Address feedback
7. Merge after approval

## Code Standards

### TypeScript Guidelines

```typescript
// Use explicit types
interface CreateUserDto {
  email: string;
  password: string;
  name: string;
}

// Use async/await over promises
async function createUser(dto: CreateUserDto): Promise<User> {
  const hashedPassword = await bcrypt.hash(dto.password, 12);
  return this.userRepository.save({
    ...dto,
    password: hashedPassword,
  });
}

// Use proper error handling
try {
  const user = await this.createUser(dto);
  return { success: true, data: user };
} catch (error) {
  this.logger.error('Failed to create user', error);
  throw new BadRequestException('User creation failed');
}
```

### NestJS Best Practices

```typescript
// Use dependency injection
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly logger: Logger,
  ) {}
}

// Use proper decorators
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  @Get('profile')
  @ApiOperation({ summary: 'Get user profile' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async getProfile(@CurrentUser() user: User): Promise<UserProfileDto> {
    return this.usersService.getProfile(user.id);
  }
}

// Use validation pipes
@Post()
async create(@Body() dto: CreateUserDto): Promise<User> {
  return this.usersService.create(dto);
}
```

### Error Handling

```typescript
// Custom exceptions
export class UserNotFoundException extends NotFoundException {
  constructor(id: string) {
    super(`User with ID ${id} not found`);
  }
}

// Global exception filter
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status = exception instanceof HttpException 
      ? exception.getStatus() 
      : 500;

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        message: exception.message,
        timestamp: new Date().toISOString(),
        path: request.url,
      },
    });
  }
}
```

## Testing Guide

### Unit Testing

```typescript
// users.service.spec.ts
describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useClass: Repository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));
  });

  describe('create', () => {
    it('should create a user successfully', async () => {
      const dto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      const savedUser = { id: '1', ...dto };
      jest.spyOn(repository, 'save').mockResolvedValue(savedUser as User);

      const result = await service.create(dto);
      expect(result).toEqual(savedUser);
    });
  });
});
```

### Integration Testing

```typescript
// users.integration.spec.ts
describe('Users Integration', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    await app.init();
  });

  it('should create user via API', async () => {
    const dto = {
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .send(dto)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(dto.email);
  });
});
```

### Property-Based Testing

```typescript
// users.property.spec.ts
import * as fc from 'fast-check';

describe('Users Property Tests', () => {
  it('should hash passwords consistently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 8, maxLength: 128 }),
        async (password) => {
          const hash1 = await bcrypt.hash(password, 12);
          const hash2 = await bcrypt.hash(password, 12);
          
          // Hashes should be different (salt)
          expect(hash1).not.toBe(hash2);
          
          // But both should verify the original password
          expect(await bcrypt.compare(password, hash1)).toBe(true);
          expect(await bcrypt.compare(password, hash2)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

## Database Management

### Migrations

```bash
# Generate migration
npm run migration:generate -- -n CreateUsersTable

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

### Entity Definition

```typescript
// user.entity.ts
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  @Index()
  email: string;

  @Column()
  password: string;

  @Column()
  name: string;

  @Column({ default: false })
  isEmailVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Url, url => url.user)
  urls: Url[];
}
```

### MongoDB Schemas

```typescript
// url.schema.ts
@Schema({ timestamps: true })
export class Url {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, unique: true })
  shortCode: string;

  @Prop({ required: true })
  originalUrl: string;

  @Prop()
  customAlias?: string;

  @Prop({ default: 0 })
  clickCount: number;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  expiresAt?: Date;
}

export const UrlSchema = SchemaFactory.createForClass(Url);
```

## API Development

### Controller Structure

```typescript
@Controller('users')
@ApiTags('Users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async getProfile(@CurrentUser() user: User): Promise<ApiResponse<UserProfileDto>> {
    const profile = await this.usersService.getProfile(user.id);
    return {
      success: true,
      data: profile,
    };
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<ApiResponse<UserProfileDto>> {
    const updatedProfile = await this.usersService.updateProfile(user.id, dto);
    return {
      success: true,
      data: updatedProfile,
    };
  }
}
```

### DTO Validation

```typescript
// create-user.dto.ts
export class CreateUserDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: 'SecurePassword123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message: 'Password must contain uppercase, lowercase, number and special character',
  })
  password: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
```

### Response Formatting

```typescript
// api-response.interface.ts
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    timestamp: string;
    version: string;
  };
}

// response.interceptor.ts
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data,
        meta: {
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      })),
    );
  }
}
```

## Security Guidelines

### Authentication

```typescript
// jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
```

### Authorization

```typescript
// roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}

// Usage
@Post('admin-only')
@Roles(Role.Admin)
@UseGuards(JwtAuthGuard, RolesGuard)
async adminOnlyEndpoint() {
  // Only admins can access this
}
```

### Input Validation

```typescript
// validation.pipe.ts
@Injectable()
export class ValidationPipe implements PipeTransform<any> {
  async transform(value: any, { metatype }: ArgumentMetadata) {
    if (!metatype || !this.toValidate(metatype)) {
      return value;
    }

    const object = plainToClass(metatype, value);
    const errors = await validate(object);

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: this.formatErrors(errors),
      });
    }

    return value;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }

  private formatErrors(errors: ValidationError[]) {
    return errors.map(error => ({
      field: error.property,
      message: Object.values(error.constraints || {}).join(', '),
    }));
  }
}
```

## Performance Considerations

### Caching

```typescript
// cache.service.ts
@Injectable()
export class CacheService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    return value ? JSON.parse(value) : null;
  }

  async set<T>(key: string, value: T, ttl: number): Promise<void> {
    await this.redis.setex(key, ttl, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

// Usage in service
@Injectable()
export class UsersService {
  constructor(
    private readonly userRepository: Repository<User>,
    private readonly cacheService: CacheService,
  ) {}

  async findById(id: string): Promise<User | null> {
    // Check cache first
    const cached = await this.cacheService.get<User>(`user:${id}`);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const user = await this.userRepository.findOne({ where: { id } });
    if (user) {
      // Cache for 1 hour
      await this.cacheService.set(`user:${id}`, user, 3600);
    }

    return user;
  }
}
```

### Database Optimization

```typescript
// Efficient queries
async findUsersWithUrls(page: number, limit: number): Promise<User[]> {
  return this.userRepository.find({
    relations: ['urls'],
    skip: (page - 1) * limit,
    take: limit,
    order: { createdAt: 'DESC' },
  });
}

// Use select to limit fields
async findUserProfile(id: string): Promise<Partial<User>> {
  return this.userRepository.findOne({
    where: { id },
    select: ['id', 'email', 'name', 'createdAt'],
  });
}

// Use raw queries for complex operations
async getUserStatistics(): Promise<any> {
  return this.userRepository.query(`
    SELECT 
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as new_users,
      COUNT(*) FILTER (WHERE is_email_verified = true) as verified_users
    FROM users
  `);
}
```

## Troubleshooting

### Common Issues

#### Database Connection Issues

```bash
# Check database status
npm run db:health

# Check Docker containers
docker-compose ps

# View database logs
docker-compose logs postgres
docker-compose logs mongodb
docker-compose logs redis
```

#### Environment Variable Issues

```bash
# Validate environment
npm run validate:env

# Check specific variables
echo $DATABASE_URL
echo $JWT_SECRET
```

#### Port Conflicts

```bash
# Check what's using port 3000
lsof -i :3000

# Kill process using port
kill -9 $(lsof -t -i:3000)
```

#### Module Import Issues

```typescript
// Use absolute imports
import { UsersService } from '@/modules/users/services/users.service';

// Instead of relative imports
import { UsersService } from '../../../users/services/users.service';
```

### Debugging

#### VS Code Debugging

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug NestJS",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/src/main.ts",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "runtimeArgs": ["-r", "ts-node/register"],
      "env": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

#### Logging

```typescript
// Use structured logging
this.logger.log('User created', { userId: user.id, email: user.email });
this.logger.error('Failed to create user', { error: error.message, dto });
this.logger.warn('Rate limit exceeded', { ip: request.ip, endpoint: request.url });
```

### Performance Debugging

```bash
# Monitor memory usage
node --inspect dist/main.js

# Profile performance
npm run start:debug
```

## Contributing

### Code Review Checklist

- [ ] Code follows TypeScript and NestJS best practices
- [ ] All tests pass and coverage is maintained
- [ ] API endpoints are properly documented
- [ ] Security considerations are addressed
- [ ] Performance impact is considered
- [ ] Error handling is comprehensive
- [ ] Logging is appropriate
- [ ] Database queries are optimized

### Documentation Updates

When adding new features:

1. Update API documentation (Swagger)
2. Add/update unit and integration tests
3. Update this developer guide if needed
4. Add examples to the API usage guide

### Getting Help

- Check existing documentation first
- Search through GitHub issues
- Ask in team chat/Slack
- Create detailed issue with reproduction steps

## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)
- [TypeORM Documentation](https://typeorm.io/)
- [Mongoose Documentation](https://mongoosejs.com/docs/)
- [Redis Documentation](https://redis.io/documentation)

---

Happy coding! 🚀