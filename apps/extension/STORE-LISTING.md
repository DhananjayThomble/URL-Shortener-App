# SnapURL — Chrome Web Store listing

Everything needed to submit the SnapURL extension to the Chrome Web Store. Copy
the blocks below into the developer dashboard verbatim; the screenshot and promo
sections are a checklist for the assets you attach.

The build+package step that produces the upload artifact:

```bash
pnpm --filter @snapurl/extension package
# → apps/extension/snapurl-extension-<version>.zip  (manifest.json at the root)
```

---

## Product name

**SnapURL — self-hosted link shortener**

(Store field max 75 chars. The core differentiator — *your own* API — is in the
name because the store audience skews toward self-hosters and privacy buyers.)

## Category

**Productivity**

## Summary (short description — max 132 chars)

> Shorten the current tab against your own SnapURL API — custom alias, domain
> picker, UTM builder, inline QR. No tracking, least-privilege.

## Detailed description (long)

> **SnapURL turns your browser into a one-click front end for your own link
> shortener.** Point it at your SnapURL API, paste a scoped API key, and shorten
> the page you're on without leaving the tab.
>
> **What you can do**
> - **Shorten the active tab** in one click, or from the right-click menu, or a
>   keyboard shortcut.
> - **Custom alias** — pick your own slug instead of a random one.
> - **Domain picker** — choose from the short domains configured on your
>   workspace.
> - **UTM builder** — tag campaign source / medium / campaign / content inline.
> - **Inline QR code** — generate and download a PNG or SVG QR for the new link.
> - **Recent links** — search your workspace's recent links, copy or open them,
>   and glance at click counts.
>
> **Built for people who host their own**
> - **You own the data.** SnapURL never talks to us — it talks only to the API
>   URL *you* configure. Your key lives in your browser's extension storage.
> - **Least privilege.** No access to your browsing. The extension reads only the
>   tab you explicitly shorten (`activeTab`) and asks for no host permissions.
> - **No remote code, no tracking, no analytics.** Everything ships inside the
>   extension (Manifest V3).
>
> **Setup takes a minute.** A guided first-run walks you through your API URL,
> your API key, and — for a production API — adding this extension's origin to
> your API's CORS allowlist, with a built-in "Test connection" that tells you
> exactly what's wrong if it isn't working.
>
> SnapURL is open source. Run the API yourself: https://github.com/DhananjayThomble/URL-Shortener-App

## Privacy practices / permission justifications

The store requires a one-line justification per permission and a data-use
disclosure. Least privilege is a selling point here — say so plainly.

| Permission | Justification (paste into the store field) |
|---|---|
| `activeTab` | "Reads the URL and title of the current tab only when the user clicks the toolbar button, the context-menu item, or the keyboard shortcut, so it can shorten that page. No access to other tabs or browsing history." |
| `storage` | "Stores the user-configured API base URL, the scoped API key, and preferences (default domain, onboarding-complete flag) locally in the browser via `chrome.storage.local`. Nothing is synced or sent to us." |
| `contextMenus` | "Adds a 'Shorten with SnapURL' item to the right-click menu so a page or link can be shortened without opening the popup." |
| `commands` | "Registers a keyboard shortcut (default Ctrl/Cmd+Shift+U) to shorten the active tab." |
| Host permissions | **None.** The extension calls the user-configured API with `fetch`, relying on that API's opt-in CORS allowlist. State this explicitly — it strengthens the review. |

**Data usage disclosures (check these in the dashboard):**
- Does **not** collect or transmit personally identifiable information, health,
  financial, authentication, personal communications, location, web history, or
  user activity **to the developer**. All requests go to the *user's own* API.
- The API key is authentication data the **user** provides and it is stored
  locally and sent only to the user's configured API in the `Authorization`
  header — never to the extension developer.
- No remote code. No third-party analytics.

**Single purpose statement:** "Shorten the current browser tab (and manage recent
links) against a user-configured, self-hostable SnapURL API."

---

## Screenshots (required: 1–5, 1280×800 or 640×400 PNG)

Capture from an unpacked build (`Load unpacked` → `apps/extension/dist`) pointed
at a dev API with a few seeded links. Suggested set, in order:

1. **Popup — shorten form** (`popup` open on a normal page): domain picker,
   custom-alias field, "Add campaign tags" disclosure, primary button.
   *Caption:* "Shorten the current tab — custom alias, domain, and UTM in one place."
2. **Popup — result with QR**: the created short URL, Copy/Open, the QR panel
   with Download PNG/SVG. *Caption:* "Copy, open, or download a QR for every link."
3. **Popup — recent links**: search box + rows with click badges and sparklines.
   *Caption:* "Search your workspace's recent links at a glance."
4. **Options — connection + Test connection**: the Connection section with a
   green verdict, key show/hide, and the extension-origin/CORS block.
   *Caption:* "Guided setup with a real connection test."
5. **Options — dark mode**: the same options page under `prefers-color-scheme:
   dark`. *Caption:* "Light and dark, matched to the SnapURL app."

> Capture note: use the repo's `web-verify` / screenshot flow or Chrome's device
> toolbar at 1280×800. Placeholders live under `store-assets/` until real ones
> are captured (see the checklist there).

## Promotional tiles (optional but recommended)

- **Small promo tile — 440×280 PNG:** SnapURL wordmark + "Your links. Your
  server." on the Cobalt accent (`#1d59c7`) over the light surface, or the dark
  surface (`#10161e`) for a dark variant. No screenshot text.
- **Marquee promo tile — 1400×560 PNG** (only if featured): the popup mockup on
  the left, three feature bullets (Custom alias · UTM builder · Inline QR) on the
  right, least-privilege badge ("No host permissions").
- Keep tiles free of the Chrome logo and of the word "Chrome" (store policy).

## Store icon

Reuse `public/icons/icon-128.png`. A dedicated 128×128 store icon with a small
safe-area margin is recommended if the in-product icon looks tight.

---

## Pre-submission checklist

- [ ] `pnpm --filter @snapurl/extension build` and `… test` and `… type-check` all pass.
- [ ] `pnpm --filter @snapurl/extension package` produces `snapurl-extension-<version>.zip`.
- [ ] Loaded unpacked and smoke-tested against a real API (shorten + follow a link).
- [ ] `manifest.json` version bumped for the release (production feature release = 1.1.0).
- [ ] 1–5 screenshots at 1280×800 attached with captions above.
- [ ] Every permission justification pasted; host-permissions "none" stated.
- [ ] Single-purpose statement and data-usage disclosures completed.
- [ ] Privacy policy URL set (link to the repo's privacy/self-hosting docs).
