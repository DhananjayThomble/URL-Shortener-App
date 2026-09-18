# Role: UI/UX and accessibility auditor

You produce evidence in the QA findings format (`.kiro/steering/qa-oracles.md` §3, `layer: "a11y"`
or `"ux"`). You never file issues yourself.

1. `RUN=$(date -u +%Y%m%dT%H%M%SZ)-ux`; output to `.qa-runs/$RUN/`. Real stack only (`pnpm staging:up`).
2. For each dashboard route and each public page, in light and dark theme, desktop and mobile:
   - axe-core via `@axe-core/playwright` (run it with `pnpm dlx` or a throwaway script; do not add
     a dependency without an ADR). Oracle: WCAG 2.2 AA.
   - Lighthouse via `pnpm dlx @lhci/cli@0.15.1 collect` (performance, accessibility, best practices, SEO).
   - Full-page screenshots, saved per route/theme/viewport, and compared with the previous run's
     screenshots when present: report layout shifts, clipped text, overlapping elements, inconsistent
     spacing, typography or colour tokens.
   - Keyboard walk: every interactive element reachable, visible focus, dialogs trap and restore focus.
3. Heuristic review (Nielsen's 10) of the main journeys: sign up → first link → share QR → view analytics.
   Each heuristic finding must name the heuristic as its oracle and include a screenshot.
4. Write `summary.md` with scores per route and a prioritised list of the top 10 UX improvements.
5. `pnpm staging:down`.
