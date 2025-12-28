# Backend Documentation

## Current Architecture: Supabase

The backend currently uses **Supabase** as a Backend-as-a-Service (BaaS) solution.

### Supabase Project Details

- **Project ID**: `gqpmsoredwrxqgtkmovu`
- **Region**: Default
- **Database**: PostgreSQL 14+

---

## Database Schema

### Tables Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     profiles    │     │      links      │     │      clicks     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK, FK)     │     │ id (PK)         │     │ id (PK)         │
│ full_name       │     │ user_id (FK)    │────▶│ link_id (FK)    │
│ username        │     │ original_url    │     │ clicked_at      │
│ avatar_url      │     │ short_code      │     │ browser         │
│ bio             │     │ custom_alias    │     │ device          │
│ created_at      │     │ title           │     │ os              │
│ updated_at      │     │ is_active       │     │ country         │
└─────────────────┘     │ expires_at      │     │ city            │
                        │ utm_*           │     │ referrer        │
                        │ ios_url         │     │ ip_hash         │
                        │ android_url     │     └─────────────────┘
                        │ *_pixel_id      │
                        │ created_at      │
                        │ updated_at      │
                        └─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│      tags       │     │    link_tags    │
├─────────────────┤     ├─────────────────┤
│ id (PK)         │◀────│ id (PK)         │
│ user_id         │     │ link_id (FK)    │
│ name            │     │ tag_id (FK)     │
│ color           │     │ created_at      │
│ created_at      │     └─────────────────┘
└─────────────────┘

┌─────────────────┐     ┌─────────────────┐
│    bio_pages    │     │    bio_links    │
├─────────────────┤     ├─────────────────┤
│ id (PK)         │◀────│ id (PK)         │
│ user_id         │     │ bio_page_id(FK) │
│ username        │     │ title           │
│ title           │     │ url             │
│ bio             │     │ icon            │
│ avatar_url      │     │ position        │
│ theme           │     │ is_active       │
│ background_color│     │ created_at      │
│ text_color      │     │ updated_at      │
│ button_style    │     └─────────────────┘
│ is_public       │
│ created_at      │
│ updated_at      │
└─────────────────┘
```

### Detailed Table Schemas

#### `profiles`
Stores user profile information. Created automatically on user signup.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, FK → auth.users | User ID |
| full_name | TEXT | nullable | User's display name |
| username | TEXT | nullable, unique | Unique username |
| avatar_url | TEXT | nullable | Profile picture URL |
| bio | TEXT | nullable | User bio |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |
| updated_at | TIMESTAMPTZ | default: now() | Updated timestamp |

#### `links`
Stores shortened URLs with all metadata.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Link ID |
| user_id | UUID | NOT NULL | Owner user ID |
| original_url | TEXT | NOT NULL | Destination URL |
| short_code | TEXT | NOT NULL, UNIQUE | Short URL code |
| custom_alias | TEXT | nullable, unique | Custom alias |
| title | TEXT | nullable | Link title |
| is_active | BOOLEAN | default: true | Active status |
| expires_at | TIMESTAMPTZ | nullable | Expiration date |
| utm_source | TEXT | nullable | UTM source |
| utm_medium | TEXT | nullable | UTM medium |
| utm_campaign | TEXT | nullable | UTM campaign |
| utm_term | TEXT | nullable | UTM term |
| utm_content | TEXT | nullable | UTM content |
| ios_url | TEXT | nullable | iOS-specific redirect |
| android_url | TEXT | nullable | Android-specific redirect |
| google_analytics_id | TEXT | nullable | GA tracking ID |
| meta_pixel_id | TEXT | nullable | Meta Pixel ID |
| tiktok_pixel_id | TEXT | nullable | TikTok Pixel ID |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |
| updated_at | TIMESTAMPTZ | default: now() | Updated timestamp |
| password_hash | TEXT | nullable | Encrypted password for protected links |
| password_hint | TEXT | nullable | Optional hint for password |

#### `geo_rules`
Country-based redirect rules for links.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Rule ID |
| link_id | UUID | FK → links.id | Associated link |
| country_code | TEXT | NOT NULL | ISO country code (e.g., US, GB) |
| redirect_url | TEXT | NOT NULL | URL to redirect for this country |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |

#### `clicks`
Stores click analytics for each link visit.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Click ID |
| link_id | UUID | FK → links.id | Associated link |
| clicked_at | TIMESTAMPTZ | default: now() | Click timestamp |
| browser | TEXT | nullable | Browser name |
| device | TEXT | nullable | Device type |
| os | TEXT | nullable | Operating system |
| country | TEXT | nullable | Visitor country |
| city | TEXT | nullable | Visitor city |
| referrer | TEXT | nullable | Referrer URL |
| ip_hash | TEXT | nullable | Hashed IP (privacy) |

#### `tags`
User-defined tags for organizing links.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Tag ID |
| user_id | UUID | NOT NULL | Owner user ID |
| name | TEXT | NOT NULL | Tag name |
| color | TEXT | nullable | Tag color (hex) |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |

#### `link_tags`
Junction table for link-tag relationships.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Record ID |
| link_id | UUID | FK → links.id | Link reference |
| tag_id | UUID | FK → tags.id | Tag reference |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |

#### `bio_pages`
Link-in-bio page configurations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Page ID |
| user_id | UUID | NOT NULL | Owner user ID |
| username | TEXT | NOT NULL, UNIQUE | Public URL username |
| title | TEXT | nullable | Page title |
| bio | TEXT | nullable | Page description |
| avatar_url | TEXT | nullable | Profile image |
| theme | TEXT | nullable | Theme name |
| background_color | TEXT | nullable | Background color |
| text_color | TEXT | nullable | Text color |
| button_style | TEXT | nullable | Button style |
| is_public | BOOLEAN | default: true | Public visibility |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |
| updated_at | TIMESTAMPTZ | default: now() | Updated timestamp |

#### `bio_links`
Links displayed on bio pages.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK, default: gen_random_uuid() | Link ID |
| bio_page_id | UUID | FK → bio_pages.id | Parent page |
| title | TEXT | NOT NULL | Link title |
| url | TEXT | NOT NULL | Destination URL |
| icon | TEXT | nullable | Icon name/URL |
| position | INTEGER | nullable | Display order |
| is_active | BOOLEAN | default: true | Active status |
| created_at | TIMESTAMPTZ | default: now() | Created timestamp |
| updated_at | TIMESTAMPTZ | default: now() | Updated timestamp |

---

## Database Functions

### `handle_new_user()`
Trigger function that creates a profile when a new user signs up.

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;
```

### `update_updated_at_column()`
Generic trigger function to update `updated_at` timestamp.

```sql
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

---

## Row Level Security (RLS)

All tables have RLS enabled. Key policies:

### Links
- Users can only CRUD their own links
- Public read for redirect functionality

### Clicks
- Insert allowed for redirect tracking
- Read restricted to link owner

### Tags & Link_Tags
- Users can only manage their own tags

### Bio Pages
- Public read for public pages (`is_public = true`)
- Full CRUD for owner

---

## Authentication

Using Supabase Auth with:
- Email/Password authentication
- Session management via JWT
- Automatic profile creation on signup

---

## API Endpoints (Current - Supabase)

All data access via Supabase JS client:

```typescript
// Example: Get user's links
const { data, error } = await supabase
  .from('links')
  .select('*, clicks(count)')
  .eq('user_id', userId)
  .order('created_at', { ascending: false });
```

---

# Future: NestJS Migration Guide

## Recommended Architecture

```
nestjs-backend/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.module.ts
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   └── roles.guard.ts
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts
│   │   │   └── dto/
│   │   │       ├── login.dto.ts
│   │   │       └── register.dto.ts
│   │   │
│   │   ├── users/
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── users.module.ts
│   │   │   ├── entities/
│   │   │   │   └── user.entity.ts
│   │   │   └── dto/
│   │   │       └── update-user.dto.ts
│   │   │
│   │   ├── links/
│   │   │   ├── links.controller.ts
│   │   │   ├── links.service.ts
│   │   │   ├── links.module.ts
│   │   │   ├── entities/
│   │   │   │   └── link.entity.ts
│   │   │   └── dto/
│   │   │       ├── create-link.dto.ts
│   │   │       └── update-link.dto.ts
│   │   │
│   │   ├── clicks/
│   │   │   ├── clicks.controller.ts
│   │   │   ├── clicks.service.ts
│   │   │   ├── clicks.module.ts
│   │   │   └── entities/
│   │   │       └── click.entity.ts
│   │   │
│   │   ├── tags/
│   │   │   ├── tags.controller.ts
│   │   │   ├── tags.service.ts
│   │   │   ├── tags.module.ts
│   │   │   └── entities/
│   │   │       └── tag.entity.ts
│   │   │
│   │   ├── bio-pages/
│   │   │   ├── bio-pages.controller.ts
│   │   │   ├── bio-pages.service.ts
│   │   │   ├── bio-pages.module.ts
│   │   │   └── entities/
│   │   │       ├── bio-page.entity.ts
│   │   │       └── bio-link.entity.ts
│   │   │
│   │   └── analytics/
│   │       ├── analytics.controller.ts
│   │       ├── analytics.service.ts
│   │       └── analytics.module.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── interceptors/
│   │   └── pipes/
│   │
│   ├── config/
│   │   ├── database.config.ts
│   │   └── jwt.config.ts
│   │
│   ├── app.module.ts
│   └── main.ts
│
├── prisma/ (or typeorm)
│   └── schema.prisma
│
├── test/
├── .env
├── nest-cli.json
├── package.json
└── tsconfig.json
```

---

## NestJS Entity Examples

### Link Entity (TypeORM)

```typescript
// src/modules/links/entities/link.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Click } from '../../clicks/entities/click.entity';

@Entity('links')
export class Link {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, user => user.links)
  user: User;

  @Column()
  originalUrl: string;

  @Column({ unique: true })
  shortCode: string;

  @Column({ nullable: true })
  customAlias: string;

  @Column({ nullable: true })
  title: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  expiresAt: Date;

  // UTM Parameters
  @Column({ nullable: true })
  utmSource: string;

  @Column({ nullable: true })
  utmMedium: string;

  @Column({ nullable: true })
  utmCampaign: string;

  @Column({ nullable: true })
  utmTerm: string;

  @Column({ nullable: true })
  utmContent: string;

  // Device-specific URLs
  @Column({ nullable: true })
  iosUrl: string;

  @Column({ nullable: true })
  androidUrl: string;

  // Tracking
  @Column({ nullable: true })
  googleAnalyticsId: string;

  @Column({ nullable: true })
  metaPixelId: string;

  @Column({ nullable: true })
  tiktokPixelId: string;

  @OneToMany(() => Click, click => click.link)
  clicks: Click[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### Links Service

```typescript
// src/modules/links/links.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Link } from './entities/link.entity';
import { CreateLinkDto } from './dto/create-link.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import { nanoid } from 'nanoid';

@Injectable()
export class LinksService {
  constructor(
    @InjectRepository(Link)
    private linksRepository: Repository<Link>,
  ) {}

  async create(userId: string, createLinkDto: CreateLinkDto): Promise<Link> {
    const shortCode = createLinkDto.customAlias || nanoid(7);
    
    const link = this.linksRepository.create({
      ...createLinkDto,
      userId,
      shortCode,
    });

    return this.linksRepository.save(link);
  }

  async findAllByUser(userId: string): Promise<Link[]> {
    return this.linksRepository.find({
      where: { userId },
      relations: ['clicks'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByShortCode(shortCode: string): Promise<Link> {
    const link = await this.linksRepository.findOne({
      where: [
        { shortCode },
        { customAlias: shortCode },
      ],
    });

    if (!link) {
      throw new NotFoundException('Link not found');
    }

    return link;
  }

  async update(id: string, userId: string, updateLinkDto: UpdateLinkDto): Promise<Link> {
    const link = await this.linksRepository.findOne({
      where: { id, userId },
    });

    if (!link) {
      throw new NotFoundException('Link not found');
    }

    Object.assign(link, updateLinkDto);
    return this.linksRepository.save(link);
  }

  async remove(id: string, userId: string): Promise<void> {
    const result = await this.linksRepository.delete({ id, userId });
    
    if (result.affected === 0) {
      throw new NotFoundException('Link not found');
    }
  }
}
```

### Links Controller

```typescript
// src/modules/links/links.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { LinksService } from './links.service';
import { CreateLinkDto } from './dto/create-link.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('links')
@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  create(@Req() req, @Body() createLinkDto: CreateLinkDto) {
    return this.linksService.create(req.user.id, createLinkDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  findAll(@Req() req) {
    return this.linksService.findAllByUser(req.user.id);
  }

  @Get(':shortCode')
  findByShortCode(@Param('shortCode') shortCode: string) {
    return this.linksService.findByShortCode(shortCode);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  update(@Req() req, @Param('id') id: string, @Body() updateLinkDto: UpdateLinkDto) {
    return this.linksService.update(id, req.user.id, updateLinkDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  remove(@Req() req, @Param('id') id: string) {
    return this.linksService.remove(id, req.user.id);
  }
}
```

---

## API Endpoints (NestJS)

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login user |
| POST | `/auth/refresh` | Refresh token |
| POST | `/auth/logout` | Logout user |

### Links
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/links` | Get all user links |
| POST | `/links` | Create new link |
| GET | `/links/:id` | Get link by ID |
| PUT | `/links/:id` | Update link |
| DELETE | `/links/:id` | Delete link |
| GET | `/r/:shortCode` | Redirect (public) |

### Tags
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tags` | Get all user tags |
| POST | `/tags` | Create new tag |
| PUT | `/tags/:id` | Update tag |
| DELETE | `/tags/:id` | Delete tag |

### Bio Pages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/bio` | Get user's bio page |
| POST | `/bio` | Create bio page |
| PUT | `/bio` | Update bio page |
| GET | `/bio/:username` | Get public bio page |
| POST | `/bio/links` | Add bio link |
| PUT | `/bio/links/:id` | Update bio link |
| DELETE | `/bio/links/:id` | Delete bio link |
| PUT | `/bio/links/reorder` | Reorder bio links |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics/summary` | Get summary stats |
| GET | `/analytics/clicks` | Get click data |
| GET | `/analytics/links/:id` | Get link analytics |

---

## Frontend Migration Steps

When migrating to NestJS backend:

1. **Create API Service Layer**
```typescript
// src/services/api.ts
const API_URL = import.meta.env.VITE_API_URL;

export const api = {
  async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_URL}${endpoint}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    return response.json();
  },
  // ... post, put, delete methods
};
```

2. **Update Hooks**
```typescript
// src/hooks/useLinks.tsx (updated)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

export const useLinks = () => {
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ['links'],
    queryFn: () => api.get<Link[]>('/links'),
  });

  const createLink = useMutation({
    mutationFn: (data: CreateLinkParams) => api.post('/links', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['links'] }),
  });

  // ... other mutations
};
```

3. **Update Auth Provider**
   - Replace Supabase auth with JWT-based auth
   - Store tokens in httpOnly cookies or secure storage
   - Implement token refresh logic

---

## Recommended NestJS Packages

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "typeorm": "^0.3.0",
    "pg": "^8.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.0",
    "bcrypt": "^5.0.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.0",
    "nanoid": "^5.0.0"
  }
}
```

---

## Environment Variables (NestJS)

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/urlshortener

# JWT
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=7d

# App
PORT=3000
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:5173

# Geo-IP Service (optional, for geo-targeting)
GEOIP_API_KEY=your-geoip-api-key
```

---

## NestJS Backend Requirements (Future Implementation)

### High Priority Features

#### 1. Password Protection for Links
- **Endpoint**: `POST /api/v1/links/:id/verify-password`
- **Implementation**:
  - Use bcrypt for password hashing (never store plain text)
  - Hash password on link creation/update
  - Verify password before redirect
  ```typescript
  // password.service.ts
  import * as bcrypt from 'bcrypt';
  
  @Injectable()
  export class PasswordService {
    async hash(password: string): Promise<string> {
      return bcrypt.hash(password, 12);
    }
    
    async verify(password: string, hash: string): Promise<boolean> {
      return bcrypt.compare(password, hash);
    }
  }
  ```

#### 2. Geo-Targeting
- **Endpoint**: Integrated in redirect logic
- **Implementation**:
  - Use MaxMind GeoIP2 or similar service
  - Cache geo-lookups for performance
  - Fallback to default URL if country not matched
  ```typescript
  // geo.service.ts
  @Injectable()
  export class GeoService {
    async getCountryFromIP(ip: string): Promise<string | null> {
      // Use MaxMind or ipapi.co
      const response = await fetch(`https://ipapi.co/${ip}/country/`);
      return response.ok ? response.text() : null;
    }
  }
  ```

#### 3. API Key Management
- **Endpoints**:
  - `POST /api/v1/api-keys` - Generate API key
  - `GET /api/v1/api-keys` - List user's API keys
  - `DELETE /api/v1/api-keys/:id` - Revoke API key
- **Implementation**:
  - Generate secure random keys with prefix (e.g., `sk_live_...`)
  - Store hashed keys, return plain key only once
  - Implement rate limiting per API key

#### 4. Email Notifications
- **Service**: Use SendGrid, AWS SES, or Resend
- **Triggers**:
  - Click milestones (100, 1000, 10000 clicks)
  - Weekly analytics digest
  - Link expiration warnings (7 days, 1 day before)
  ```typescript
  // notifications.service.ts
  @Injectable()
  export class NotificationsService {
    async sendClickMilestone(userId: string, linkId: string, clicks: number) {
      // Queue email job
    }
    
    @Cron('0 9 * * 1') // Every Monday at 9am
    async sendWeeklyDigest() {
      // Generate and send weekly reports
    }
  }
  ```

#### 5. Account Management
- **Endpoints**:
  - `PUT /api/v1/users/password` - Change password
  - `DELETE /api/v1/users` - Delete account
  - `PUT /api/v1/users/profile` - Update profile
- **Implementation**:
  - Require current password for sensitive changes
  - Cascade delete all user data on account deletion
  - Send confirmation email for critical actions

### Medium Priority Features

#### 6. A/B Testing
- Split traffic between multiple destination URLs
- Track conversion rates per variant
- Statistical significance calculation

#### 7. Workspace/Team Features
- Create workspaces
- Invite team members
- Role-based permissions (admin, editor, viewer)

#### 8. Custom Domains
- Allow users to use their own domains
- SSL certificate provisioning
- DNS verification

#### 9. Webhooks
- Notify external services on link events
- Configurable event types (click, created, updated)
- Retry logic for failed deliveries

### API Rate Limiting

```typescript
// rate-limit.guard.ts
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: Redis) {}
  
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = request.user?.id || request.ip;
    
    const current = await this.redis.incr(`rate:${key}`);
    if (current === 1) {
      await this.redis.expire(`rate:${key}`, 60); // 1 minute window
    }
    
    if (current > 100) { // 100 requests per minute
      throw new HttpException('Rate limit exceeded', 429);
    }
    
    return true;
  }
}
```

### Caching Strategy

```typescript
// cache.module.ts
@Module({
  imports: [
    CacheModule.register({
      store: redisStore,
      host: 'localhost',
      port: 6379,
      ttl: 300, // 5 minutes default
    }),
  ],
})
export class AppCacheModule {}

// In service
@Injectable()
export class LinksService {
  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}
  
  async findByShortCode(code: string): Promise<Link> {
    const cached = await this.cache.get<Link>(`link:${code}`);
    if (cached) return cached;
    
    const link = await this.linksRepository.findOne({ where: { shortCode: code } });
    await this.cache.set(`link:${code}`, link, 300);
    return link;
  }
}
```

---

## Security Checklist for NestJS

- [ ] Use helmet for HTTP security headers
- [ ] Implement CORS properly
- [ ] Use bcrypt for password hashing (cost factor 12+)
- [ ] Store secrets in environment variables
- [ ] Validate all inputs with class-validator
- [ ] Sanitize URLs before storing
- [ ] Rate limit all endpoints
- [ ] Log security events
- [ ] Use HTTPS in production
- [ ] Implement proper error handling (don't leak stack traces)
