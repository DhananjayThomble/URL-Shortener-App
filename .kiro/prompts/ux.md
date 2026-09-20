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
6. If you started the web app yourself (e.g. in CI mode, where the staging stack and build are
   already done but nothing serves the built app), record its PID (`echo $! > "$RUN_DIR/web.pid"`
   or similar) when you start it, and stop it **by that PID only** at the end of the run — never
   `pkill -f` / `killall` with a pattern, even one that looks unique. Your own prompt/command line
   contains the same server-start command you'd use as a kill pattern, so a pattern match can hit
   your own session and SIGTERM it before the run finishes (see
   `.kiro/steering/session-hygiene.md` and issue #532). Confirm it's down with `curl` against the
   port, not by re-running the pattern search.
