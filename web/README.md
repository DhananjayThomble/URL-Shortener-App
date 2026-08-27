# SnapURL 2.0 — web

The SnapURL frontend. **This app has no backend.** Every piece of data comes from
the NestJS API over HTTP, and there are deliberately no route handlers under
`src/app/api`. If you need a new endpoint, it belongs in the NestJS service.

## Running it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000.

`.env.local` has two settings:

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Base URL of the NestJS API. Defaults to `http://localhost:3001/api/v1`. |
| `NEXT_PUBLIC_USE_FIXTURES` | `true` serves the UI from in-repo fixtures so the frontend runs before the API exists. Set to `false` to go over the wire. |

## Wiring it to NestJS

Set `NEXT_PUBLIC_USE_FIXTURES=false` and point `NEXT_PUBLIC_API_URL` at the API.
Nothing else changes — the fixture adapter and the real client share one call
signature.

The endpoints the frontend expects, all relative to `NEXT_PUBLIC_API_URL`:

| Method | Path | Returns |
| --- | --- | --- |
| `POST` | `/auth/login` | `AuthSession` |
| `POST` | `/auth/register` | `AuthSession` |
| `POST` | `/auth/refresh` | `{ accessToken, refreshToken }` |
| `GET` | `/auth/me` | `AuthUser` |
| `GET` | `/workspaces/current` | `Workspace` |
| `GET` | `/links` | `{ items: Link[], total: number }` |
| `POST` | `/links` | `Link` |
| `GET` | `/links/:id` | `Link` |
| `DELETE` | `/links/:id` | `204` |
| `GET` | `/analytics?range=&linkId=` | `Analytics` |
| `GET` | `/conversions?range=` | `ConversionsReport` |
| `GET` | `/domains` | `Domain[]` |
| `GET` | `/members` | `Member[]` |
| `GET` | `/audit` | `AuditEntry[]` |
| `GET` | `/api-keys` | `ApiKey[]` |
| `GET` | `/webhooks` | `Webhook[]` |
| `GET` | `/bio-pages` | `BioPage[]` |
| `GET` | `/public/links/:slug/preview` | `PublicLinkPreview` (no auth) |

The exact response shapes are the zod schemas in [`src/lib/api/types.ts`](src/lib/api/types.ts).
They are validated at runtime, so a backend payload that drifts from the
contract fails loudly with the offending fields named rather than rendering
blank.

Auth is a bearer token in `Authorization`, with one transparent
refresh-and-retry on a 401.

## Layout

```
src/
  app/
    (app)/          dashboard routes — shares the sidebar/topbar shell
    (auth)/         login, register
    p/[slug]/       public trust preview, no auth
    page.tsx        marketing landing
  components/
    ui/             owned primitives (button, card, input, table, …)
    app-shell/      sidebar, topbar, page header
    links/          link row with routing chain, create drawer
    charts/         sparkline, area chart, bar list, funnel
    qr/             real QR generation + export
    theme/          the appearance engine
  lib/api/          client, zod contract, TanStack Query hooks, fixtures
```

## Theming

Appearance is a product feature, not a build constant. `ThemeProvider` owns
accent, light/dark, density, corner radius and reduce-motion; Settings →
Appearance drives it, and it persists per-device in `localStorage` (wrapped in
try/catch, so private mode falls back to defaults instead of throwing).

A small inline script in `layout.tsx` applies the saved values before first
paint so the page never flashes the wrong theme.

Everything is styled through CSS custom properties in `globals.css`, which are
also exposed as Tailwind v4 theme tokens. No component hard-codes a colour, so
changing a token restyles the whole app.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 ·
TanStack Query · react-hook-form + zod · Recharts · qrcode

## Checks

```bash
npm run type-check
npm run build
```
