# SnapURL Web Dashboard — Mobile UI/UX Audit

Scope: the `snapurl-web` Next.js dashboard (`web/`). Every authenticated
dashboard route, the auth flow, the marketing pages, and the public
(trust / bio / form) pages were reviewed at a mobile viewport (reference
widths 360px and 375px, iPhone SE / common Android). The review was performed
by reading the components and their Tailwind v4 token classes and tracing how
each layout reflows below the `sm` (640px) and `lg` (1024px) breakpoints.

Guiding constraints for every fix:

- Mobile-first and responsive. Desktop (>= the relevant breakpoint) must look
  and behave exactly as it does today.
- No business-logic, data-flow, hook, or API changes. Styling, layout, and
  responsive structure only.
- Keep using the existing design-token system (`accent`, `ink`, `surface`,
  `line`, `--density`, `--radius`, `tap-target`, etc.). Do not hard-code
  colours or re-introduce fixed pixel widths that cannot shrink.

The app already has meaningful responsive groundwork: a working mobile nav
drawer (`app-shell`), a `tap-target` utility for 44px touch targets below
`lg`, a horizontally scrollable `TableWrap` with a "Scroll →" affordance, and
right-side drawers that are `w-full sm:w-[620px]`. The findings below are the
gaps that remain on top of that groundwork.

---

## Severity key

- **P1** — content is cropped, overflows the viewport, or a control is hard to
  hit / read on a phone.
- **P2** — layout is awkward or cramped but still usable.
- **P3** — polish; small spacing / alignment nits on mobile.

---

## Category A — `PageHead` action clusters overflow on narrow screens

`PageHead` (in `web/src/components/app-shell/index.tsx`) renders:

```
<div className="flex items-start gap-4 mb-5 flex-wrap">
  <div className="min-w-0"> title + sub </div>
  {actions ? <div className="ml-auto flex gap-2 flex-wrap"> actions </div> : null}
</div>
```

The actions block is pushed right with `ml-auto` and wraps as a unit. The
individual action controls do not shrink, so when actions are wide they either
force horizontal overflow or crowd into a thin right-aligned column.

### A1 — Analytics / Conversions date-range control overflows (P1)

- Files: `web/src/app/(app)/analytics/page.tsx`,
  `web/src/app/(app)/conversions/page.tsx`
- The `actions` contain a `Segmented` control with **five** options
  (`24h · 7d · 30d · 90d · 12m`). `Segmented` is `flex gap-[4px]` with
  `flex-1` option buttons that are `whitespace-nowrap`. On Analytics an
  `Export CSV` button sits on the same wrap line.
- At ~347px of usable width (375px viewport minus the `main` padding of
  14px per side) five nowrap segments plus Export CSV do not fit; the row
  overflows horizontally (the segmented strip is squeezed and/or pushes the
  page wider).
- Fix direction: on mobile let the range control take its own full-width row
  under the title (e.g. the actions wrapper becomes `w-full` below `sm` and
  the `Segmented` becomes full width), returning to the inline right-aligned
  layout at `sm`+. Keep desktop identical.

### A2 — Link detail header action buttons crowd / wrap tightly (P1)

- File: `web/src/app/(app)/links/[id]/page.tsx`
- Actions are `Edit`, `Delete`, `Copy link`, and in the delete-confirm state
  `Edit`, `Keep it`, `Delete for good`, `Copy link` (four buttons). With
  `ml-auto` + `flex-wrap` these stack into a narrow right-aligned column on a
  phone, each button only as wide as its label, leaving ragged, hard-to-scan
  controls directly beside a long wrapping title.
- Fix direction: below `sm`, let the action buttons span the full width and
  lay out in a left-aligned wrap (drop the right-pull on mobile) so they read
  as a normal button group; keep the desktop right-aligned cluster.

### A3 — Links page header has four actions (P2)

- File: `web/src/app/(app)/links/page.tsx`
- `Bulk create`, `Import`, `Export CSV` (and `Cancel`/`Cancel import` label
  swaps). Same `ml-auto` crowding as A2 on a phone. Same fix direction.

---

## Category B — Links page filter / toolbar row

File: `web/src/app/(app)/links/page.tsx`

### B1 — Floating vertical divider when the toolbar wraps (P2)

- The toolbar is `flex items-center gap-2 mb-3 flex-wrap` containing: a group
  of six status pills, a `<span className="w-px h-[22px] bg-line" />` vertical
  divider, a search input, three `<select>` chips, an optional Clear button,
  and a right-pushed List/Grid `Tabs`.
- When this wraps on a phone, the 22px-tall vertical divider lands mid-row
  between wrapped groups and reads as a stray tick mark. It is a desktop-only
  separator.
- Fix direction: hide the divider below `sm` (`hidden sm:block`) or convert it
  to a bottom border on the wrapped group; keep it on desktop.

### B2 — Search input and `ml-auto` view toggle fight for the same row (P2)

- The search `Input` is `w-[260px] max-w-full` (good) but the `ml-auto` on the
  List/Grid `Tabs` pulls the toggle to the far right of whatever line it lands
  on, which on a phone can leave it isolated on its own line flush-right while
  the selects sit left. Visually disconnected.
- Fix direction: below `sm`, drop `ml-auto` so the view toggle flows inline
  with the filters (or group filters into a full-width stack). Desktop keeps
  the right-aligned toggle.

---

## Category C — Dense data rows

### C1 — `LinkRow` header packs too many fixed items on a phone (P2)

- File: `web/src/components/links/link-row.tsx`
- The row header is a single `flex items-center gap-[14px]` with: 32px
  favicon, a flex-1 title/destination block, (md+) tags, (md+) 96px
  sparkline, a `min-w-[74px]` right-aligned clicks block, and a chevron. Tags
  and sparkline are already `hidden md:*` (good).
- On a phone the title line wraps the slug, three text action buttons
  (`⧉ copy`, `⧉⧉ duplicate`, `⤵ archive`), and the status chip onto multiple
  lines. The actions are `row-action` (forced visible on touch), so they are
  always present and consume two+ lines beside a `min-w-[74px]` clicks column,
  making each row tall and busy. Nothing is cropped, but the hierarchy breaks
  down.
- Fix direction: tighten the touch layout — e.g. allow the action buttons to
  wrap under the slug as a compact group and ensure the clicks block / chevron
  stay aligned. Styling only; do not change what the buttons do.

### C2 — Wide tables rely on horizontal scroll (acknowledged, verify) (P2)

- Files: Team, Developers, Domains, Reports, Conversions, Bio (all use
  `TableWrap` + `Table` with `min-w-[440–560px]`).
- `TableWrap` already provides a focusable horizontal scroller plus a mobile
  "Scroll →" fade affordance, so columns are reachable, not cropped. This is
  the intended pattern and should be preserved.
- Action: confirm during browser verification that no table cell forces the
  page itself to scroll sideways (the global `.flex > * / .grid > * {
  min-width: 0 }` reset plus `TableWrap`'s own `overflow-x-auto` should
  contain it). No code change expected unless a regression is found.

---

## Category D — Landing / marketing hero

File: `web/src/app/page.tsx`

### D1 — Hero "trust row" spacing on very narrow screens (P3)

- The three trust badges use `flex justify-center gap-[26px] flex-wrap`. On a
  360px screen the 26px gap plus three items wrap to three lines with large
  gaps. Minor; a smaller gap below `sm` tightens it.
- The hero shorten box is already `flex-col sm:flex-row` (good). The feature
  grid uses `auto-fit minmax(238px,1fr)` which collapses to one column on a
  phone (good).

---

## Category E — Items verified OK (no change needed)

Documented so verification covers them and so no fix accidentally regresses
them:

- **App shell mobile nav**: hamburger opens a `w-[272px] max-w-[85vw]` drawer
  with body-scroll lock, Escape close, and overlay; reuses the desktop nav
  list. Topbar is `h-14` with `px-[14px] sm:px-[22px]`. Search is
  `hidden sm:flex` (intentionally desktop/tablet only).
- **Create-link / Edit-link / Form drawers**: `w-full sm:w-[620px]`, so they
  fill the phone screen rather than overflowing; internal tab strip is
  `overflow-x-auto`; footer actions are `ml-auto flex gap-2`.
- **Auth pages** (`AuthShell`): `max-w-[400px]`, centred, `px-6` — fine on
  mobile.
- **Public trust page** (`/p/[slug]`): `max-w-[560px]`, `break-all` on the
  destination URL — fine.
- **QR studio**: `grid-cols-1 lg:grid-cols-[1fr_260px]` — single column on
  mobile.
- **Settings**: `grid-cols-1 lg:grid-cols-2` and inner
  `grid-cols-1 sm:grid-cols-2` — single column on mobile.
- **Two-factor enrol**: `flex-col sm:flex-row` — QR stacks above the fields on
  mobile.
- **Stat-tile grids** (`auto-fit minmax(178px,1fr)`): collapse to 1–2 columns
  on a phone; acceptable.
- **Marketing site header**: has its own `md:hidden` mobile menu with a
  `tap-target` toggle.

---

## Verification plan (requires a real browser at a mobile viewport)

The following must be driven by browser automation (Playwright / agent-browser
at 375x667 and 390x844), signing in via fixtures mode
(`NEXT_PUBLIC_USE_FIXTURES=true` in `web/.env.local`, `pnpm dev:web`):

1. For every route, confirm `document.scrollingElement.scrollWidth <=
   window.innerWidth` (no horizontal page overflow) — before and after fixes.
2. Analytics and Conversions: confirm the five-way range control plus Export
   fit on their own rows with no clipped segment (A1).
3. Link detail in both normal and delete-confirm states: confirm all action
   buttons are fully visible and tappable (A2).
4. Links page toolbar: confirm no stray divider and the view toggle reads as
   part of the toolbar (B1, B2).
5. `LinkRow`: confirm the row is legible and the clicks value / chevron are
   not pushed off-screen (C1).
6. All table screens: confirm tables scroll inside their own container and the
   "Scroll →" cue appears, with no page-level sideways scroll (C2).

## Regression gates (host, no browser needed)

- `pnpm --filter snapurl-web type-check`
- `pnpm --filter snapurl-web test`
- Production build with fixtures OFF:
  `cd web && NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 pnpm build`
  (a fixtures-on production build is intentionally rejected).
