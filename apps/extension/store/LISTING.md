# SnapURL extension — store listing copy (paste-ready)

Copy the blocks below verbatim into AMO (addons.mozilla.org) and the Chrome Web
Store dashboard. Character limits noted per field.

---

## Extension name
`SnapURL — self-hosted link shortener`
*(≤ 45 chars AMO / ≤ 75 chars CWS — this is 37.)*

## Category
- **AMO:** Other / Productivity
- **Chrome Web Store:** Productivity

## Summary / short description
> Shorten the current tab against your own SnapURL API — custom alias, domain picker, UTM builder, inline QR, recent-link search. No tracking, least-privilege.
*(AMO summary ≤ 250 chars — this is 156. CWS short description ≤ 132 chars; use the trimmed version below for CWS.)*

**CWS short (≤ 132):**
> Shorten the current tab against your own SnapURL API — alias, domains, UTM, QR. No tracking, least-privilege.

## Full description
```
SnapURL turns your browser into a one-click front end for your own link shortener. Point it at your SnapURL API, paste a scoped API key, and shorten the page you're on without leaving the tab.

WHAT YOU CAN DO
• Shorten the active tab in one click — from the toolbar, the right-click menu, or a keyboard shortcut (Ctrl+Shift+U / Cmd+Shift+U).
• Custom alias — choose your own slug instead of a random one, with instant validation.
• Domain picker — pick from the short domains configured on your workspace.
• UTM builder — tag source / medium / campaign / term / content inline.
• Inline QR code — generate and download a PNG or SVG QR for the new link.
• Recent links — search your workspace's recent links, copy or open them, and glance at click counts and sparklines.
• Guided setup — a first-run walkthrough for your API URL, key, and (for a production API) the CORS/origin step, with a built-in "Test connection" that tells you exactly what's wrong if it isn't working.

BUILT FOR PEOPLE WHO HOST THEIR OWN
• You own the data. SnapURL never talks to us — only to the API URL you configure. Your key lives in your browser's extension storage.
• Least privilege. No access to your browsing. It reads only the tab you explicitly shorten (activeTab) and requests no host permissions.
• No remote code, no tracking, no analytics. Everything ships inside the extension (Manifest V3, strict CSP).

Open source. Works with any SnapURL instance.
```

## Support / homepage
- **Homepage URL:** `https://snapurl.in`
- **Support email:** `support@snapurl.in`  *(replace with your real address)*
- **Support site / repo:** `https://github.com/DhananjayThomble/URL-Shortener-App`

## Privacy policy URL
`https://app.snapurl.in/extension-privacy`  **← must be hosted before submit (see STORE-SUBMISSION.md).**
The policy text is in `store/PRIVACY-POLICY.md` / `store/privacy-policy.html`.

## Data collection declaration
Both stores: **No data collected / transferred by the extension author.** The
extension stores settings locally and sends data only to the user's own API.
(Matches `gecko.data_collection_permissions.required = ["none"]`.)

---

## Per-permission justifications (match the actual manifest exactly)

Manifest: `permissions: ["activeTab", "storage", "contextMenus"]`,
top-level `commands` key, `host_permissions: []`.

| Permission | Justification string (paste per prompt) |
|---|---|
| **activeTab** | Reads the URL and title of the current tab only when the user explicitly invokes "Shorten" (toolbar click, context-menu item, or keyboard command). No passive or background access to any page. |
| **storage** | Persists the user's SnapURL API base URL, their scoped API key, and an optional default domain in local extension storage. Local only; never transmitted except as the auth header to the user's own API. |
| **contextMenus** | Adds a "Shorten with SnapURL" item to the right-click menu so the user can shorten the current page or a link without opening the popup. |
| **commands** *(top-level key, not a permission)* | Registers the Ctrl+Shift+U / Cmd+Shift+U keyboard shortcut to shorten the active tab. |
| **host_permissions: []** | None requested. The extension reaches the user's API via fetch relying on that API's opt-in CORS; it needs no access to any website's content. |

**Single purpose (CWS "single purpose" field):**
> Shorten the current browser tab into a short link using a SnapURL API instance that the user configures and controls.

---

## Screenshots
See `store/screenshots/` (captured from the real popup/options UI). Filenames and
captions:

| File | Caption | Dimensions |
|---|---|---|
| `01-popup-shorten.png` | One-click shorten: alias, domain picker, UTM builder | 1280×800 |
| `02-popup-result-qr.png` | Result with copy + inline QR (PNG/SVG download) | 1280×800 |
| `03-popup-recent.png` | Recent links: search, click badges, sparklines | 1280×800 |
| `04-options-connection.png` | Options: API URL, key, and "Test connection" | 1280×800 |
| `05-options-dark.png` | Options under dark mode | 1280×800 |

- **AMO** requires at least 1 screenshot; 3–5 recommended. Any reasonable size is
  accepted; 1280×800 is used here.
- **CWS** requires 1280×800 (or 640×400) screenshots — these match.

## Icons / promo tiles
- Extension icons **16/32/48/128** are present in the package (`icons/`) and load
  correctly. See `store/ICONS.md` for the store-art status and the one action
  needed (designed 128 listing icon / optional CWS promo tile).
