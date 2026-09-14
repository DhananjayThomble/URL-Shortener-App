# SnapURL extension — store submission runbook (Firefox first, then Chrome)

Everything needed to publish is **committed under `apps/extension/store/`**. You
should only have to (1) host one privacy-policy file, (2) create the store
account(s), and (3) upload + click submit. This doc is the step-by-step.

**Firefox (AMO) goes first** — free (no developer fee), lighter review, and the
package already passes AMO's own validator (`web-ext lint`: **0 errors**). Chrome
follows.

## The single build artifact (serves both stores)

```bash
pnpm --filter @snapurl/extension build      # → apps/extension/dist/
pnpm --filter @snapurl/extension package     # → apps/extension/snapurl-extension-1.1.0.zip (~307 KiB)
```

The **same `manifest.json`** works on both: Chrome uses
`background.service_worker`; Firefox ignores it and uses the `background.scripts`
fallback. `browser_specific_settings.gecko.*` is Firefox-only (Chrome ignores).
One build, one zip.

> Both stores are **human console actions** — no agent can create the account,
> upload the zip, or submit for review.

## What's in `apps/extension/store/`

| File | What it is |
|---|---|
| `PRIVACY-POLICY.md` / `privacy-policy.html` | The actual privacy policy (host the `.html`). |
| `LISTING.md` | Paste-ready name, summary, full description, category, support, **per-permission justifications**, single-purpose string. |
| `screenshots/01..05*.png` | 5 real 1280×800 screenshots captured from the built UI. |
| `scripts/capture-screenshots.mjs` | Regenerates the screenshots from `dist/` (see below). |
| `ICONS.md` | Icon status (16/32/48/128 present) + the optional CWS promo-tile note. |

Regenerate screenshots any time (serves `dist/` over http, stubs `chrome.*`, drives the real UI):

```bash
pnpm --filter @snapurl/extension build
PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
  node apps/extension/store/scripts/capture-screenshots.mjs
# → apps/extension/store/screenshots/*.png
```

## `web-ext lint` verdict (AMO's own validator)

```
npx web-ext lint --source-dir=./apps/extension/dist   →  Errors: 0   Warnings: 3   Notices: 0
```

The 3 warnings are all expected/benign:
1. `BACKGROUND_SERVICE_WORKER_IGNORED` — intentional: Firefox uses the
   `background.scripts` fallback and ignores the Chrome `service_worker` key.
2. `UNSAFE_VAR_ASSIGNMENT` (×2) — the two `innerHTML` writes are one-time shell
   renders from **hardcoded constant** template strings (`OPTIONS_MARKUP` /
   `POPUP_MARKUP` at `src/options.ts` / `src/popup.ts`), never user/network
   data. AMO accepts these as warnings.

None block submission.

## Manifest deltas that made it Firefox-ready (already merged in this PR)

Additive, manifest-only — no code, no polyfill (`chrome.*` resolves on Firefox MV3):
`gecko.id` (`snapurl@snapurl.in`), `strict_min_version 140` + `gecko_android 142`,
`data_collection_permissions:none`, `background.scripts` fallback, and dropping the
invalid `commands` entry from the `permissions` array.

---

# AMO — Firefox (do this first)

1. **Host the privacy policy.** Publish `store/privacy-policy.html` at a public
   URL — simplest options: serve it from the web app at
   `https://app.snapurl.in/extension-privacy`, or GitHub Pages. **This is the one
   hosting step you must do.** Note the URL.
2. Create/sign in to a free account at https://addons.mozilla.org → **Developer Hub**.
3. **Submit a New Add-on** → distribution: **On this site (listed)** (public
   listing) — recommended; or **self-distribution** (AMO signs the xpi for
   sideloading without a listing).
4. Upload `apps/extension/snapurl-extension-1.1.0.zip`. Expect 0 errors, 3 benign warnings.
5. Fill the listing from `store/LISTING.md` (name, summary ≤250, description,
   category, support). Attach the 5 screenshots from `store/screenshots/`. Set
   the **privacy-policy URL** from step 1. Set **data collection = No** (matches
   `data_collection_permissions:none`). Paste the per-permission justifications.
6. Submit for review.

> **gecko.id is permanent on AMO.** It's currently `snapurl@snapurl.in`. Change
> it in `apps/extension/public/manifest.json` **before** the first upload if you
> want a different id — it cannot change afterward without re-registering.

---

# Chrome Web Store (after Firefox)

1. Register at https://chrome.google.com/webstore/devconsole (Google account),
   pay the one-time **US$5** fee.
2. **New item** → upload the same `snapurl-extension-1.1.0.zip`.
3. **Store listing** tab: copy from `store/LISTING.md`; attach the same 1280×800
   screenshots. (Optionally add a 440×280 promo tile — see `store/ICONS.md`.)
4. **Privacy practices** tab: single purpose + per-permission justifications +
   the **privacy-policy URL** (same one from AMO step 1) + data-usage
   declaration (nothing sold/transferred; key + settings stored locally).
5. Submit for review.

---

## The ONLY things left that require you

1. **Host the privacy policy** at a public URL (`store/privacy-policy.html`) and
   use that URL in both listings. *(The one hosting step.)*
2. **Confirm/replace** the permanent `gecko.id` and the `support@snapurl.in`
   placeholder before first AMO upload.
3. **Create the AMO account** (free) → upload → paste listing → set privacy URL → submit.
4. **Create the Chrome Web Store account** (one-time $5) → upload → paste listing
   → set privacy URL → submit. *(Optional: design a 440×280 CWS promo tile.)*

Everything else — the built zip, all listing copy, permission justifications,
privacy-policy text, and 5 real screenshots — is done and committed.
