# SnapURL vs InApp: competitive gap analysis

**Compared:** 2026-08-28  
**Reference:** InApp public landing page and pricing page at https://app.inapp.app/ and https://app.inapp.app/pricing

This is a product-surface comparison, not a security or performance review. InApp's capabilities below are based on claims visible without signing in. SnapURL's status is based on the current contracts, API, database, and web UI.

## Priority gaps

| InApp capability | SnapURL status | Notes |
| --- | --- | --- |
| Custom forms | Missing | No form builder, shareable form URL, response table, or CSV response export. |
| Native-app deep linking | Partial | SnapURL has a `deepLink` flag, but no app-specific routing, app fallback configuration, or supported-app integrations. InApp advertises YouTube, Spotify, Instagram, X, Amazon, TikTok, WhatsApp, Facebook, SoundCloud, and Etsy. |
| City-level analytics | Present | Resolved from CloudFront's edge header, so no IP is stored to produce it, and cities below a five-click floor are folded into "Other cities" rather than named. The reasoning is in [DECISIONS.md](./DECISIONS.md). |
| Tracking pixels | **Declined** | Not a gap. Delivering one needs an HTML interstitial in place of the 302, needs EU/UK consent before it may run, and contradicts three public claims. `POST /conversions` plus webhooks already serve the attribution need server-side. Reasoning in [DECISIONS.md](./DECISIONS.md). |
| Scheduled activation | Missing | SnapURL supports expiry dates and expiry fallbacks, but not a future activation/start date. |
| Bulk link creation | UI gap | The Links page shows a `Bulk create` action, but no complete bulk-create workflow or contract is implemented. |
| CSV export | UI gap | The Links page shows `Export`, and settings mention export/import, but no complete export endpoint/workflow is implemented. |
| Link cloning | Missing | No clone operation is exposed in the link contract or API. |
| Google and Apple login | Missing | SnapURL currently implements email/password authentication. InApp exposes Google and Apple sign-in. |
| Billing and subscriptions | UI/demo gap | SnapURL displays plan and billing controls, but there is no implemented payment, upgrade, downgrade, or subscription lifecycle. |

## Partial or parity features

### Bio pages

SnapURL has working bio pages with profiles and block types (`header`, `link`, `embed`, `email`, and `social`). InApp advertises six premium templates, including product cards, leaderboard, carousel, bento, and boutique layouts. SnapURL's current UI includes a `Templates` action, but the visible implementation is a basic block editor rather than a template catalog.

Evidence: [web/src/app/(app)/bio/page.tsx](../web/src/app/(app)/bio/page.tsx), [packages/contract/src/workspace.ts](../packages/contract/src/workspace.ts)

### Geo redirects

SnapURL supports conditional routing by country, device, and language, plus weighted A/B routing. This provides the core routing capability InApp calls geo redirects, although SnapURL does not appear to provide city-level targeting or an equivalent plan entitlement system.

Evidence: [packages/domain/src/routing.ts](../packages/domain/src/routing.ts), [packages/contract/src/link.ts](../packages/contract/src/link.ts)

### QR codes

Both products provide QR codes. SnapURL currently offers SVG and PNG export, foreground color choices, error-correction levels, and an optional center logo.

Evidence: [web/src/app/(app)/qr/page.tsx](../web/src/app/(app)/qr/page.tsx)

### Custom domains

Both products support custom domains. SnapURL includes DNS verification, SSL state, root redirects, and not-found redirects. Local development is HTTP-only; production SSL issuance is represented in the domain model but requires deployment infrastructure.

Evidence: [web/src/app/(app)/domains/page.tsx](../web/src/app/(app)/domains/page.tsx), [packages/contract/src/workspace.ts](../packages/contract/src/workspace.ts)

### Analytics and conversions

SnapURL is already broader than InApp's public summary in several areas: cookieless unique visitors, QR scans, browser/device/referrer breakdowns, tags, top links, conversion events, funnels, and revenue attribution. The primary reported gap is city-level analytics.

Evidence: [apps/api/src/analytics/analytics.service.ts](../apps/api/src/analytics/analytics.service.ts), [web/src/app/(app)/analytics/page.tsx](../web/src/app/(app)/analytics/page.tsx), [web/src/app/(app)/conversions/page.tsx](../web/src/app/(app)/conversions/page.tsx)

## Already covered by SnapURL

- Short links and custom aliases
- Password protection
- Link expiry and expiry fallback destinations
- Tags and folders
- UTM metadata
- Country, device, and language routing
- Weighted A/B routing
- Analytics dashboards
- QR generation and downloads
- Bio pages
- Team roles and invitations
- API keys and webhooks
- Conversion tracking and revenue attribution
- Data retention controls
- Public link previews

Evidence: [packages/contract/src/link.ts](../packages/contract/src/link.ts), [packages/contract/src/workspace.ts](../packages/contract/src/workspace.ts), [packages/contract/src/analytics.ts](../packages/contract/src/analytics.ts), [docs/BACKEND.md](BACKEND.md)

## Suggested order of consideration

1. Finish the already-advertised export and bulk-create actions, then add link cloning.
2. Add scheduled activation to the link model and redirect gate.
3. Turn `deepLink` into a complete app-routing feature with explicit fallback behavior.
4. Build forms and response export as a separate product module.
5. Add city-level analytics only after choosing a privacy-preserving geo data source.
6. Add OAuth and billing once account and commercial requirements are defined.
7. Tracking pixels are declined, not deferred — see [DECISIONS.md](./DECISIONS.md). If that is ever reversed, the order is marketing copy first, preview-page disclosure second, code last.
