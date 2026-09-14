# SnapURL extension — store submission runbook (Firefox first, then Chrome)

This is the end-to-end runbook for publishing the SnapURL browser extension.
**Firefox (AMO) goes first** — it is free (no developer fee), the review is
lighter, and the extension already passes AMO's own validator (`web-ext lint`:
**0 errors**). The Chrome Web Store follows once the Firefox listing is live.

The single build artifact serves **both** stores:

```bash
pnpm --filter @snapurl/extension build      # → apps/extension/dist/
pnpm --filter @snapurl/extension package     # → apps/extension/snapurl-extension-1.1.0.zip (306.6 KiB)
```

The **same `manifest.json`** works on both browsers: Chrome uses
`background.service_worker`; Firefox ignores that and uses the
`background.scripts` fallback. `browser_specific_settings.gecko.*` is read only
by Firefox and ignored by Chrome. No separate build, no separate zip.

> **Both stores are human console actions.** No agent can create the developer
> account, upload the zip, or submit for review. This doc gets you to the point
> where you upload and click submit.

---

## What changed to make the extension Firefox-ready

These are additive, manifest-only changes shipped in the same PR — no code, no
polyfill. `chrome.*` APIs used (`contextMenus`, `commands`, `storage`, `tabs`,
`action`) all resolve on Firefox MV3 via its built-in `chrome.*` compatibility
alias, so **no `webextension-polyfill` is needed.**

| Change | Why | Chrome impact |
|---|---|---|
| `browser_specific_settings.gecko.id = "snapurl@snapurl.in"` | AMO requires a permanent add-on id for MV3 | Ignored by Chrome |
| `gecko.strict_min_version = "140.0"` | `data_collection_permissions` (below) needs Firefox ≥ 140 | Ignored |
| `gecko_android.strict_min_version = "142.0"` | Same key needs Firefox for Android ≥ 142 | Ignored |
| `gecko.data_collection_permissions.required = ["none"]` | AMO's new data-consent key; the extension collects no data | Ignored |
| `background.scripts = ["background.js"]` added alongside `service_worker` | Firefox loads the background as `scripts` (module), not a service worker | Chrome keeps using `service_worker`, ignores `scripts` |
| Removed `"commands"` from the `permissions` array | `commands` is **not** a valid permission on either browser; it is enabled by the top-level `commands` key. Firefox's validator errored on it. | No change — keyboard command still works |

Guarded by `src/manifest.test.ts` ("is Firefox/AMO ready", "does not list
'commands' as a permission") so it can't silently drift. Test count: **121/121**.

### `web-ext lint` verdict (AMO's own validator)

```
npx web-ext lint --source-dir=./apps/extension/dist
→ Errors: 0   Warnings: 3   Notices: 0
```

The 3 remaining warnings are all expected/benign:

1. `BACKGROUND_SERVICE_WORKER_IGNORED` — **intentional.** Firefox ignores the
   Chrome `service_worker` key and uses the `background.scripts` fallback. This
   is the dual-key design working; it is the price of one manifest for both
   stores. (Removing `service_worker` would break Chrome.)
2. `UNSAFE_VAR_ASSIGNMENT` (×2, in bundled `options.js`/`popup.js`) — the two
   `innerHTML` assignments are `root.innerHTML = OPTIONS_MARKUP` /
   `POPUP_MARKUP` in `src/options.ts:369` / `src/popup.ts:558`: a **one-time
   shell render from a hardcoded constant template string**, never user or
   network data. AMO accepts these as warnings. Safe to explain in review if
   asked.

None of the three block AMO submission.

---

# AMO — Firefox (do this first)

**Cost:** free. **Review:** automated + light human; static-analysis pass on the
zip. Self-hosted extensions can also be signed for sideloading.

### The upload artifact

`apps/extension/snapurl-extension-1.1.0.zip` (the exact same zip as Chrome). AMO
accepts the zip directly — `manifest.json` is at the zip root.

### Listing fields (addons.mozilla.org)

| Field | Value |
|---|---|
| **Name** | SnapURL — self-hosted link shortener |
| **Summary** | Shorten the current tab against your own SnapURL API — custom alias, domain picker, UTM builder, inline QR. No tracking, least-privilege. |
| **Description** | See the long description in [`STORE-LISTING.md`](./STORE-LISTING.md) (verbatim). |
| **Categories** | Bookmarks / Other (AMO), Productivity-equivalent |
| **Tags** | url-shortener, self-hosted, productivity, qr, utm |
| **Support email / site** | your SnapURL support address / https://snapurl.in |
| **License** | match the repo license |
| **Privacy policy URL** | **⚠️ REQUIRED — does not exist yet.** See "Privacy policy" below. |
| **Screenshots** | 1–5 PNG; capture list in [`store-assets/README.md`](./store-assets/README.md). **⚠️ not captured yet.** |

### Data collection / consent

Set the AMO "data collection" answer to **No data collected** — matches
`gecko.data_collection_permissions.required = ["none"]`. The extension sends
data only to the API URL *the user* configures; nothing goes to us or Mozilla.

### Permission justifications (match the actual manifest exactly)

Manifest permissions are `["activeTab", "storage", "contextMenus"]`,
`host_permissions: []`.

- **activeTab** — reads the URL/title of the tab only when the user explicitly
  invokes "Shorten" (click, context menu, or keyboard command). No passive
  browsing access.
- **storage** — persists the user's API base URL, scoped API key, and default
  domain in extension storage. Local only.
- **contextMenus** — the "Shorten with SnapURL" right-click item.
- **commands** (top-level key, not a permission) — the `Ctrl+Shift+U` /
  `Cmd+Shift+U` shortcut.
- **No `host_permissions`** — the extension never requests access to page
  content on any site. It reaches the user's API via `fetch` relying on that
  API's opt-in CORS.

### Submit flow (addons.mozilla.org)

1. Create/sign in to a free Firefox account at https://addons.mozilla.org and
   open the **Developer Hub**.
2. **Submit a New Add-on** → choose distribution:
   - **On this site (listed)** — public on AMO, gets a listing page. Recommended.
   - **On your own (self-distribution)** — AMO signs the xpi for sideloading
     but doesn't list it. Use only if you don't want a public listing.
3. Upload `snapurl-extension-1.1.0.zip`. AMO runs the same validator; expect the
   3 benign warnings, 0 errors.
4. Fill listing fields (table above), attach screenshots, set the privacy
   policy URL, answer data-collection = none.
5. Submit for review. Listed MV3 add-ons typically clear automated review fast;
   a human spot-check may follow.
6. Because `gecko.id` is `snapurl@snapurl.in`, that id is **permanent** for this
   add-on on AMO — decide the id before first upload (see note below).

> **gecko.id note:** I set `snapurl@snapurl.in` (you own `snapurl.in`). It is an
> arbitrary but permanent identifier — if you'd rather use a different form
> (e.g. a GUID, or `{...}` UUID), change it in
> `apps/extension/public/manifest.json` **before** the first AMO upload. After
> the first upload it cannot change without re-registering as a new add-on.

---

# Chrome Web Store (after Firefox)

**Cost:** one-time **US$5** developer registration fee (Google account).
**Review:** automated + human; MV3 policy review can take days.

### The upload artifact

Same `apps/extension/snapurl-extension-1.1.0.zip`.

### Listing fields

Everything is already written in [`STORE-LISTING.md`](./STORE-LISTING.md) —
product name, category (Productivity), short + long description, permission
justifications, screenshot captions/dimensions. Copy verbatim.

### Permission justifications

Same as the AMO list above (Chrome dashboard asks for a justification per
permission and for a "single purpose" description — the single purpose is
"shorten the current tab against a user-configured SnapURL API").

### Submit flow (Chrome Developer Dashboard)

1. Go to https://chrome.google.com/webstore/devconsole, sign in with a Google
   account, pay the **one-time $5** fee if not already registered.
2. **New item** → upload `snapurl-extension-1.1.0.zip`.
3. Fill the Store listing tab from `STORE-LISTING.md`; attach 1–5 screenshots
   (1280×800) from `store-assets/`.
4. **Privacy practices** tab: declare data usage (none sold/transferred; API key
   + settings stored locally), justify each permission, set the **privacy
   policy URL** (required for any extension handling user data — the API key).
5. Submit for review.

---

## Privacy policy — REQUIRED, does not exist yet ⚠️

Both stores require a privacy-policy URL because the extension stores a
user-supplied API key. There is **no privacy policy in the repo or hosted
anywhere** today. Minimum content:

- What is stored: API base URL, scoped API key, default domain — in the
  browser's local extension storage only.
- What is transmitted: only to the API URL the user configures; nothing to the
  extension authors, Mozilla, or Google.
- No analytics, no tracking, no remote code, no third parties.

Host it at a stable URL (e.g. `https://snapurl.in/extension-privacy` or a
GitHub Pages/README section) and use that URL in both store listings.

---

## Checklist of USER (human console) actions

**Firefox / AMO (first):**
- [ ] Create a free Firefox/AMO developer account.
- [ ] Decide/confirm the permanent `gecko.id` (currently `snapurl@snapurl.in`).
- [ ] Write + host a privacy policy; get its URL.
- [ ] Capture 1–5 screenshots (see `store-assets/README.md`).
- [ ] Upload `snapurl-extension-1.1.0.zip`, fill listing, submit for review.

**Chrome Web Store (after):**
- [ ] Register a Chrome Web Store developer account and pay the one-time $5 fee.
- [ ] Reuse the privacy-policy URL + screenshots.
- [ ] Upload the same zip, fill the Store listing + Privacy practices tabs, submit.
