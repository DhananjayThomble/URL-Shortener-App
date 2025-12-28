# Frontend Documentation

## Overview

This is a **URL Shortener & Link-in-Bio** application built with modern React technologies.

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.3.x | UI Framework |
| Vite | Latest | Build Tool |
| TypeScript | Latest | Type Safety |
| Tailwind CSS | Latest | Styling |
| Shadcn/UI | Latest | Component Library |
| React Router | 6.x | Routing |
| React Query | 5.x | Server State Management |
| Supabase JS | 2.x | Backend Client |
| Framer Motion | 12.x | Animations |
| Recharts | 2.x | Analytics Charts |

---

## Project Structure

```
src/
├── components/
│   ├── ui/                    # Shadcn UI components
│   ├── dashboard/             # Dashboard-specific components
│   │   ├── AnalyticsCharts.tsx
│   │   ├── BioPageEditor.tsx
│   │   ├── BulkImportExport.tsx
│   │   ├── DashboardLayout.tsx
│   │   ├── DashboardSidebar.tsx
│   │   ├── LinkShortener.tsx
│   │   ├── StatsCards.tsx
│   │   └── TagsManager.tsx
│   ├── landing/               # Landing page sections
│   │   ├── CTASection.tsx
│   │   ├── FeaturesSection.tsx
│   │   ├── Footer.tsx
│   │   ├── HeroSection.tsx
│   │   └── PricingSection.tsx
│   ├── Navbar.tsx
│   ├── NavLink.tsx
│   └── QRCodeGenerator.tsx
├── hooks/
│   ├── useAuth.tsx            # Authentication context & hooks
│   ├── useLinks.tsx           # Link CRUD operations
│   ├── useTags.tsx            # Tag management
│   ├── useAnalytics.tsx       # Analytics data fetching
│   ├── useBioPage.tsx         # Bio page management
│   └── use-mobile.tsx         # Mobile detection
├── pages/
│   ├── Index.tsx              # Landing page
│   ├── Auth.tsx               # Login/Signup
│   ├── Dashboard.tsx          # Main dashboard
│   ├── PublicBioPage.tsx      # Public bio page view
│   ├── RedirectPage.tsx       # Short URL redirect handler
│   └── NotFound.tsx           # 404 page
├── integrations/
│   └── supabase/
│       ├── client.ts          # Supabase client instance
│       └── types.ts           # Auto-generated DB types
├── lib/
│   └── utils.ts               # Utility functions
├── App.tsx                    # Main app with routing
├── main.tsx                   # Entry point
└── index.css                  # Global styles & design tokens
```

---

## Core Features

### 1. Authentication (`useAuth.tsx`)

Provides authentication context for the entire app.

```typescript
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}
```

**Usage:**
```typescript
const { user, signIn, signOut, loading } = useAuth();
```

### 2. Link Management (`useLinks.tsx`)

Handles all link CRUD operations.

```typescript
interface Link {
  id: string;
  user_id: string;
  original_url: string;
  short_code: string;
  custom_alias: string | null;
  title: string | null;
  is_active: boolean;
  expires_at: string | null;
  // UTM Parameters
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  // Device-specific URLs
  ios_url: string | null;
  android_url: string | null;
  // Tracking pixels
  google_analytics_id: string | null;
  meta_pixel_id: string | null;
  tiktok_pixel_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateLinkParams {
  originalUrl: string;
  customAlias?: string;
  title?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  iosUrl?: string;
  androidUrl?: string;
  expiresAt?: string;
  tagIds?: string[];
}
```

**Usage:**
```typescript
const { links, loading, createLink, updateLink, deleteLink, refetch } = useLinks();
```

### 3. Tags Management (`useTags.tsx`)

```typescript
interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}
```

**Usage:**
```typescript
const { tags, loading, createTag, updateTag, deleteTag, refetch } = useTags();
```

### 4. Analytics (`useAnalytics.tsx`)

```typescript
interface Stats {
  totalLinks: number;
  totalClicks: number;
  activeLinks: number;
  avgClicksPerLink: number;
}

interface DailyClicks {
  date: string;
  clicks: number;
}
```

**Usage:**
```typescript
const { stats, dailyClicks, loading, refetch } = useAnalytics();
```

### 5. Bio Pages (`useBioPage.tsx`)

```typescript
interface BioPage {
  id: string;
  user_id: string;
  username: string;
  title: string | null;
  bio: string | null;
  avatar_url: string | null;
  theme: string | null;
  background_color: string | null;
  text_color: string | null;
  button_style: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface BioLink {
  id: string;
  bio_page_id: string;
  title: string;
  url: string;
  icon: string | null;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

**Usage:**
```typescript
const { 
  bioPage, 
  bioLinks, 
  loading,
  createBioPage,
  updateBioPage,
  addBioLink,
  updateBioLink,
  deleteBioLink,
  reorderBioLinks
} = useBioPage();
```

---

## Routing Structure

| Route | Component | Access | Description |
|-------|-----------|--------|-------------|
| `/` | `Index.tsx` | Public | Landing page |
| `/auth` | `Auth.tsx` | Public | Login/Signup |
| `/dashboard` | `Dashboard.tsx` | Protected | Main dashboard |
| `/dashboard/links` | `Dashboard.tsx` | Protected | Links management |
| `/dashboard/analytics` | `Dashboard.tsx` | Protected | Analytics view |
| `/dashboard/bio` | `Dashboard.tsx` | Protected | Bio page editor |
| `/dashboard/tags` | `Dashboard.tsx` | Protected | Tags management |
| `/dashboard/import-export` | `Dashboard.tsx` | Protected | Bulk operations |
| `/bio/:username` | `PublicBioPage.tsx` | Public | Public bio page |
| `/:shortCode` | `RedirectPage.tsx` | Public | URL redirect |

---

## Design System

### Color Tokens (HSL)

Located in `src/index.css`:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96.1%;
  --muted: 210 40% 96.1%;
  --accent: 210 40% 96.1%;
  --destructive: 0 84.2% 60.2%;
  --border: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark mode tokens */
}
```

### Usage in Components

```tsx
// ✅ Correct - Use semantic tokens
<div className="bg-background text-foreground border-border">
  <Button className="bg-primary text-primary-foreground" />
</div>

// ❌ Wrong - Don't use direct colors
<div className="bg-white text-black">
```

---

## Component Guidelines

### Creating New Components

1. **Use TypeScript interfaces** for all props
2. **Use semantic color tokens** from the design system
3. **Keep components focused** - single responsibility
4. **Use Shadcn UI** as base components

```tsx
// Example component structure
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MyComponentProps {
  title: string;
  onAction: () => void;
}

export const MyComponent = ({ title, onAction }: MyComponentProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button onClick={onAction}>Action</Button>
      </CardContent>
    </Card>
  );
};
```

---

## State Management

- **Server State**: React Query (via Supabase hooks)
- **Auth State**: React Context (`AuthProvider`)
- **Local State**: React `useState`/`useReducer`

---

## API Integration

All API calls go through `@/integrations/supabase/client`:

```typescript
import { supabase } from "@/integrations/supabase/client";

// Example query
const { data, error } = await supabase
  .from('links')
  .select('*')
  .eq('user_id', userId);
```

---

## Future Improvements

When migrating to NestJS backend:

1. Replace Supabase client calls with REST/GraphQL API calls
2. Update hooks to use React Query's `useQuery`/`useMutation` directly
3. Create API service layer (`src/services/api.ts`)
4. Update authentication to use JWT tokens from NestJS

See `docs/BACKEND.md` for backend migration details.

---

## Current Feature Status

| Feature | Status | Notes |
|---------|--------|-------|
| URL Shortening | ✅ Complete | With custom aliases |
| Device Targeting | ✅ Complete | iOS/Android URLs |
| UTM Parameters | ✅ Complete | Auto-append on redirect |
| Tags Management | ✅ Complete | Color-coded tags |
| Bio Pages | ✅ Complete | Public profile pages |
| QR Codes | ✅ Complete | PNG download |
| Bulk Import/Export | ✅ Complete | CSV support |
| Dark/Light Mode | ✅ Complete | Theme toggle |
| Settings Page | ✅ Complete | Profile editing |
| Password Protection | ✅ Complete | UI ready, needs NestJS hashing |
| Geo-Targeting | ✅ Complete | Country-based routing |
| API Page | ✅ Complete | Documentation, needs NestJS |
| Email Notifications | ⏳ Pending | Requires NestJS |
| API Keys | ⏳ Pending | Requires NestJS |
| Team Workspaces | ⏳ Pending | Requires NestJS |
