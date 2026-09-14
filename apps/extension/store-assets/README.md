# Store assets

Real Chrome Web Store screenshots and promo tiles go here. Until they are
captured, this file is the placeholder + capture checklist. See
[`../STORE-LISTING.md`](../STORE-LISTING.md) for the full listing copy, captions,
and dimensions.

## Screenshots to capture (1280×800 PNG, 1–5)

Load unpacked (`apps/extension/dist`) against a dev API with a few seeded links,
then capture:

- [ ] `01-popup-shorten.png` — popup shorten form (domain picker, alias, UTM disclosure)
- [ ] `02-popup-result-qr.png` — result state with the QR panel + Download PNG/SVG
- [ ] `03-popup-recent.png` — recent links: search box, click badges, sparklines
- [ ] `04-options-test-connection.png` — Connection section, green Test-connection verdict, CORS/origin block
- [ ] `05-options-dark.png` — options page under `prefers-color-scheme: dark`

## Promo tiles (PNG)

- [ ] `promo-small-440x280.png` — wordmark + tagline on Cobalt (`#1d59c7`)
- [ ] `promo-marquee-1400x560.png` — only if featured

## Store icon

- [ ] `store-icon-128.png` — optional dedicated 128×128 (else reuse `public/icons/icon-128.png`)

> Capture with the repo's `web-verify` screenshot flow or Chrome's device
> toolbar. Do not commit oversized raw captures — export at the target
> dimensions.
