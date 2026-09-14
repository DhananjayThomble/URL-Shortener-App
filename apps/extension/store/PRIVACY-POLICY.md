# SnapURL Browser Extension — Privacy Policy

**Last updated:** 2026-09-14

SnapURL is a browser extension that shortens the current tab against **your own**
SnapURL API. It is built for self-hosting: you point it at an API base URL you
control and authenticate with a key you issue. This policy describes exactly what
data the extension handles, where it goes, and what it never does.

## Summary

- The extension talks **only** to the SnapURL API URL **you** configure. It does
  not talk to the extension authors, Mozilla, Google, or any third party.
- It stores your API base URL, your API key, and an optional default domain in
  your browser's local extension storage. Nothing is uploaded to us.
- It has **no analytics, no tracking, no telemetry, and no advertising.**
- It requests **no access to your browsing.** It reads a page's URL and title
  only when you explicitly ask it to shorten that page.
- Nothing is ever sold or shared.

## What data the extension handles

**1. Settings you enter (stored locally):**

- **API base URL** — the address of your SnapURL instance (e.g.
  `https://api.example.com`).
- **API key** — a scoped SnapURL key (`snap_live_…`) you generate. It is a
  secret; the extension stores it and never logs it.
- **Default domain** *(optional)* — a short domain to use by default.

These are stored using `chrome.storage.local` (browser extension storage) on
your device. They are never transmitted anywhere except as the `Authorization`
header on requests to the API base URL you configured.

**2. Data you choose to act on (transmitted to your API):**

- When you shorten a page, the extension sends that page's **URL** (and, when
  you supply them, a custom alias and UTM parameters) to
  `POST <your-api-base>/api/v1/links`.
- When you search or view recent links, it sends a **search query** to
  `GET <your-api-base>/api/v1/links`.
- When you pick a domain, it reads your configured domains from
  `GET <your-api-base>/api/v1/domains`.

Every one of these requests goes **only** to the API base URL you set, carrying
your API key as a Bearer token. The extension makes no other network requests.

## What the extension does NOT do

- It does **not** read, monitor, or collect your browsing history or the content
  of pages you visit. It has **no** host permissions (`host_permissions: []`) and
  no `<all_urls>` access. It reads only the tab you explicitly shorten, via the
  `activeTab` permission granted per-invocation.
- It does **not** send any data to the extension developers or to any analytics,
  advertising, or tracking service.
- It does **not** contain remote code. All logic ships inside the extension
  (Manifest V3, strict content-security-policy, no `eval`).

## Permissions and why

- **activeTab** — to read the URL/title of the current tab, only when you invoke
  "Shorten" (toolbar button, right-click menu, or keyboard shortcut).
- **storage** — to save your API URL, API key, and default domain locally.
- **contextMenus** — to add the "Shorten with SnapURL" right-click item.
- **commands** *(top-level manifest key)* — the `Ctrl+Shift+U` / `Cmd+Shift+U`
  shortcut.
- **No host permissions.**

## Data retention and deletion

Your settings live in your browser's extension storage until you clear them (via
the extension's options page, by removing the extension, or by clearing browser
data). The extension keeps no server-side copy — it has no server of its own.
Links you create live in **your** SnapURL instance, governed by your instance's
own retention.

## Data sharing and sale

None. The extension shares data with no one and sells nothing. The only network
destination is the SnapURL API you configure and control.

## Children

The extension is a developer/productivity tool and is not directed at children.

## Changes

Material changes to this policy will be reflected here with an updated "Last
updated" date.

## Contact

Questions about this policy: **support@snapurl.in** *(replace with your real
support address before publishing)*.
