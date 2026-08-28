# SnapURL module health report

**Tested:** 2026-08-28  
**Branch:** `fix/auth-session-gate`  
**Scope:** Local module-to-module smoke test from A to Z, using the current source, compiled applications, local Postgres, and the seeded demo account.

## Executive summary

After restarting stale application processes, the core product is operational:

- `pnpm type-check`: passed
- `pnpm build`: passed
- `pnpm test`: 132 tests passed, 27 database-backed tests skipped because the test runner did not have `DATABASE_URL`
- API smoke test: 51/51 passed
- Redirect smoke test: 21/21 passed
- Worker one-shot pass: completed with 0 projection failures and 0 stuck projections
- Web routes: all tested routes returned `200`

Two failures appeared during the first live pass but were caused by stale processes, not a persistent source failure:

1. The old Next.js process returned `500` because it referenced a missing generated `@tanstack/query-core` vendor chunk. Restarting Next.js fixed it.
2. The old API process produced four missing audit assertions. Restarting the API fixed them; the current API smoke suite passes all audit checks.

## A-to-Z coverage

| Area | Result | Evidence / finding |
| --- | --- | --- |
| A. Authentication | Pass | Login, registration, `/auth/me`, unauthorized access, refresh rotation, and logout token reuse protection passed. |
| B. Bio pages | Pass | API read path passed; web `/bio` returned `200`. Full create/edit behavior is covered by build and contract paths, but not by the provided smoke script. |
| C. Conversions | Pass | Conversion report and currency checks passed; analytics conversion totals returned successfully. |
| D. Domains | Pass | Listing, default domain, link count, and protection against disconnecting the shared domain passed. |
| E. Email / invitations | Partial | Invitation logic is exercised through team APIs, but mail uses the outbox stub by default rather than delivering real email. |
| F. Forms | Missing | No form builder, public form URL, response table, or response export module exists. |
| G. Link management | Pass | Create, list, pagination, duplicate/reserved slug validation, edit, delete, expiry, password protection, UTM, and routing checks passed. |
| H. Health / startup | Pass | API and redirect health checks passed. `pnpm dev` can fail when stale processes already occupy service ports; start services individually after clearing old processes. |
| I. Integrations | Partial | API keys, scoped access, webhooks, and conversion ingestion exist. External delivery was not fully verified in this local run. |
| J. Jobs / worker | Pass | One-shot rollup and maintenance completed: 17 events rolled up, 20 projections processed, 6 expiries swept, 0 failures, 0 stuck projections. |
| K. API keys | Pass | Key creation, one-time key response, authentication, and scope enforcement passed. |
| L. Login / logout | Pass | Login succeeded with the seeded account; refresh rotation and family revocation passed. |
| M. Members | Pass | Member listing and default 2FA state passed. Invite/role/remove code is present, but not all mutation paths were included in the live smoke run. |
| N. Navigation / web pages | Pass after restart | All tested dashboard and auth routes returned `200`. |
| O. Observability | Partial | Structured logging and error handling exist. No automated metric/alerting integration was exercised locally. |
| P. Public previews | Pass after restart | Direct preview API, `/p/demo`, and `/p/bf7XBxv` returned successfully after the web restart. |
| Q. QR codes | Pass at build/UI level | QR page returned `200`; SVG/PNG export, color, error correction, and logo controls are implemented. Browser download interaction was not automated here. |
| R. Redirect path | Pass | Health, 302/301 behavior, query forwarding, UTM, country/device routing, expiry fallback, password unlock, preview suffix, and privacy hashing passed 21/21. |
| S. Safe Browsing | Partial | Feature path exists, but without `GOOGLE_SAFE_BROWSING_API_KEY` destinations are marked clean without an external scan. |
| T. Teams / audit | Pass after restart | Team audit assertions passed after restarting the API. The first run exposed stale-process behavior only. |
| U. Workspace settings | Pass | Current workspace, currency, settings contract, retention, privacy toggles, and plan data returned successfully. Billing is display-only. |
| V. Validation / contracts | Pass | Shared Zod contracts, type-check, invalid destination, short password, slug, and routing validation passed. |
| W. Webhooks | Partial | Webhook APIs and worker delivery logic are implemented; no external HTTPS receiver was available for end-to-end delivery confirmation. |
| X. Export / import | Missing or incomplete | Export and bulk-create controls appear in the UI, but complete export, import, and bulk workflows are not implemented. |
| Y. OAuth / social login | Missing | Authentication currently uses email/password; Google and Apple login are not implemented. |
| Z. Billing / subscriptions | Missing | Plan and billing screens exist, but payment, upgrade, downgrade, quota enforcement, and subscription lifecycle are not implemented. |

## Confirmed limitations and risks

### Database test coverage is incomplete locally

The full test command passed, but 27 tests were skipped because database-backed test suites require `DATABASE_URL`. The local live smoke tests covered the main API and redirect flows against Postgres, but they do not replace the skipped unit/integration cases.

### Real email is not configured

`MAIL_TRANSPORT=outbox` writes invitations to `logs/outbox/` rather than sending them. A real mail provider is required to verify delivery behavior.

### Safe Browsing is disabled without a key

The application can report a destination as clean without contacting Google Safe Browsing when the API key is absent. This is documented as a feature flag, but production copy and configuration should remain aligned.

### Production infrastructure is not implemented

The local redirect uses Postgres directly and the worker uses `NoProjection`. The DynamoDB projection adapter, AWS infrastructure, and SQS/EventBridge deployment path are not implemented in this repository yet.

### Lint was not run

Repository instructions state that `pnpm lint` is currently invalid because the web package has no ESLint configuration/dependency. It was intentionally excluded from this health check.

## Commands and checks used

```text
pnpm type-check
pnpm build
pnpm test
scripts/smoke.sh              via Git Bash
scripts/smoke-redirect.sh     via Git Bash
pnpm --filter @snapurl/worker exec node dist/main.js --once
```

The two shell smoke suites could not run through WSL because `/bin/bash` was unavailable; Git Bash was present and produced the results recorded above.
