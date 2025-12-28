# Documentation Index

## Overview

This is a **URL Shortener & Link-in-Bio** platform with analytics, device targeting, and bulk operations.

## Documentation Files

| Document | Description |
|----------|-------------|
| [FRONTEND.md](./FRONTEND.md) | React frontend architecture, components, hooks, routing |
| [BACKEND.md](./BACKEND.md) | Database schema, Supabase setup, NestJS migration guide |

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm or bun
- Supabase account (current backend)

### Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Build
```bash
npm run build
```

---

## Features

- ✅ URL Shortening with custom aliases
- ✅ QR Code generation
- ✅ Click analytics (browser, device, location)
- ✅ Smart device routing (iOS/Android)
- ✅ UTM parameter support
- ✅ Retargeting pixels (GA, Meta, TikTok)
- ✅ Link expiration
- ✅ Tags for organization
- ✅ Bulk import/export (CSV)
- ✅ Link-in-Bio pages
- ✅ User authentication

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│                   (React + Vite + TS)                        │
├─────────────────────────────────────────────────────────────┤
│  Pages        │  Components      │  Hooks                    │
│  - Landing    │  - Dashboard/*   │  - useAuth                │
│  - Auth       │  - Landing/*     │  - useLinks               │
│  - Dashboard  │  - UI/*          │  - useTags                │
│  - Bio Pages  │  - Navbar        │  - useAnalytics           │
│  - Redirect   │  - QRCode        │  - useBioPage             │
└───────────────┴──────────────────┴───────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Supabase)                        │
├─────────────────────────────────────────────────────────────┤
│  Auth          │  Database (PostgreSQL)                      │
│  - Email/Pass  │  - profiles                                 │
│  - Sessions    │  - links                                    │
│                │  - clicks                                   │
│  RLS Policies  │  - tags / link_tags                         │
│  - Row-level   │  - bio_pages / bio_links                    │
│    security    │                                             │
└────────────────┴─────────────────────────────────────────────┘
                              │
                              ▼ (Future)
┌─────────────────────────────────────────────────────────────┐
│                    Backend (NestJS)                          │
│              See BACKEND.md for migration guide              │
└─────────────────────────────────────────────────────────────┘
```

---

## Contributing

1. Follow the coding guidelines in FRONTEND.md
2. Use semantic color tokens from the design system
3. Create focused, single-responsibility components
4. Update documentation when adding new features
