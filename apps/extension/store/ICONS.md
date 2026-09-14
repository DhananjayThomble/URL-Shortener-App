# Icons & store art — status

## Extension icons (in the package) — ✅ present, correct sizes
`public/icons/` ships all four required MV3 icon sizes, referenced by both the
top-level `icons` key and the `action.default_icon`:

| File | Dimensions | Required by |
|---|---|---|
| `icon-16.png` | 16×16 | toolbar/favicon |
| `icon-32.png` | 32×32 | Windows/retina toolbar |
| `icon-48.png` | 48×48 | extensions management page |
| `icon-128.png` | 128×128 | install + store listing icon |

All four are valid PNGs at the exact required dimensions and load without error
(verified in the loadable `dist/`). This satisfies the **functional** icon
requirement for both AMO and the Chrome Web Store.

## Store listing icon / promo art — ⚠️ one design action for the user
The shipped icons are simple/minimal (small solid-mark PNGs). They are valid and
will pass review, but for a polished **store listing** you may want designed art:

- **AMO listing icon:** AMO reuses the 128×128 from the package — no separate
  upload required. A nicer 128 is optional.
- **Chrome Web Store:**
  - Store icon: 128×128 (the package `icon-128.png` is used; a dedicated
    `store-icon-128.png` is optional).
  - **Small promo tile: 440×280 PNG — required for a public CWS listing.** This
    does **not** ship in the package and must be designed. Placeholder spec in
    `store-assets/README.md`.
  - Marquee promo 1400×560 — only if the extension is featured (optional).

**User action:** none required to pass review. Optional: replace the minimal
128×128 with designed art, and create the 440×280 CWS promo tile before making
the Chrome listing public. AMO needs neither.
