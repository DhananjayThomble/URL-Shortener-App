import { expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#791, BUG-043): the top-bar search's keyboard shortcut.

   The search used to show a hard-coded "⌘K" hint and nothing listened for it, so
   Ctrl+K did nothing on Linux/Windows (and Cmd+K did nothing on Mac either).
   Oracle: the issue's acceptance criteria — Ctrl+K (non-Mac) and ⌘K (Mac) both
   focus the search, and the hint shows the platform-appropriate key — plus
   WAI-ARIA `aria-keyshortcuts` (Control+K / Meta+K) for assistive tech.

   Browser platform is emulated with an init script (navigator.platform and
   navigator.userAgentData), because Playwright cannot change it per context.
   "No hydration mismatch" is asserted on the Mac emulation, the case where the
   server-rendered neutral state and the client's answer differ: React reports a
   mismatch as a console error / page error (minified in a production build, so
   the check is "no console errors and no page errors at all").

   Pure matching rules (extra modifiers, IME, editable targets…) are unit-tested in
   web/src/lib/search-shortcut.test.ts. Runs on Desktop Chrome and Pixel 7. */

const SEARCH = "Search links, slugs, destinations, tags";

async function installApi(page: Page) {
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": {
      status: 200,
      body: [{ id: "dom_1", domain: "snap.to", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null, shared: true }],
    },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
  });
}

/** Pretend to be a given OS. `userAgentData` is removed so the `navigator.platform` fallback is what answers. */
async function emulatePlatform(page: Page, platform: string) {
  await page.addInitScript((p) => {
    Object.defineProperty(navigator, "platform", { get: () => p, configurable: true });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined, configurable: true });
  }, platform);
}

/** Fire the shortcut as a raw event and report whether the page called preventDefault on it (i.e. kept it from the browser). */
async function dispatchPrevented(page: Page, init: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): Promise<boolean> {
  return page.evaluate((i: { key?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }) => {
    const e = new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true, ...i });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  }, init);
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe("search shortcut (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "desktop-only: the search is hidden on phones, see the mobile block below");
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Linux/Windows: hint reads Ctrl K and Ctrl+K focuses the search; Cmd+K does not", async ({ page }) => {
    await installApi(page);
    await emulatePlatform(page, "Linux x86_64");
    const errors = watchErrors(page);
    await page.goto("/links");

    const search = page.getByRole("combobox", { name: SEARCH });
    await expect(search).toBeVisible();
    await expect(page.locator("kbd", { hasText: "Ctrl K" })).toBeVisible();
    await expect(page.locator("kbd", { hasText: "⌘K" })).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");
    // The hint is decorative for AT (aria-keyshortcuts carries it) and out of the input's name.
    await expect(page.locator("kbd", { hasText: "Ctrl K" })).toHaveAttribute("aria-hidden", "true");

    await page.locator("main, body").first().click({ position: { x: 5, y: 5 } });
    await expect(search).not.toBeFocused();

    await page.keyboard.press("Meta+k");
    await expect(search).not.toBeFocused();

    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("Mac: hint reads ⌘K and Cmd+K focuses the search; Ctrl+K does not; no hydration error", async ({ page }) => {
    await installApi(page);
    await emulatePlatform(page, "MacIntel");
    const errors = watchErrors(page);
    await page.goto("/links");

    const search = page.getByRole("combobox", { name: SEARCH });
    await expect(page.locator("kbd", { hasText: "⌘K" })).toBeVisible();
    await expect(page.locator("kbd", { hasText: "Ctrl K" })).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+K");

    await page.keyboard.press("Control+k");
    await expect(search).not.toBeFocused();

    await page.keyboard.press("Meta+k");
    await expect(search).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("the shortcut is kept from the browser (address-bar jump) and re-selects what was typed", async ({ page }) => {
    await installApi(page);
    await emulatePlatform(page, "Win32");
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: SEARCH });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");

    expect(await dispatchPrevented(page, { ctrlKey: true })).toBe(true);
    expect(await dispatchPrevented(page, { ctrlKey: true, key: "K" })).toBe(true); // Caps Lock
    // Not ours → must reach the browser untouched.
    expect(await dispatchPrevented(page, { metaKey: true })).toBe(false);
    expect(await dispatchPrevented(page, { ctrlKey: true, shiftKey: true })).toBe(false);
    expect(await dispatchPrevented(page, { ctrlKey: true, altKey: true })).toBe(false);
    expect(await dispatchPrevented(page, {})).toBe(false);

    await search.fill("webinar");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(search).not.toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    expect(await search.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length])).toEqual([0, 7, 7]);

    // Pressed again while already in the search: stays focused and selected.
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
  });

  test("does not steal Ctrl+K from another text field, nor behind an open drawer", async ({ page }) => {
    await installApi(page);
    await emulatePlatform(page, "Linux x86_64");
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: SEARCH });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");

    await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();
    const destination = drawer.getByLabel("Destination URL");
    await destination.click();
    await page.keyboard.press("Control+k");
    await expect(destination).toBeFocused();
    await expect(search).not.toBeFocused();

    // Even with focus on a non-text control inside the modal, the page behind is not reachable.
    await drawer.getByRole("heading", { level: 2 }).click();
    await page.keyboard.press("Control+k");
    await expect(search).not.toBeFocused();
  });

  test("works from a button (keyboard focus) as well as from the page body", async ({ page }) => {
    await installApi(page);
    await emulatePlatform(page, "Linux x86_64");
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: SEARCH });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");

    const newLink = page.getByRole("button", { name: /New link|Create a link/ }).first();
    await newLink.focus();
    await expect(newLink).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
  });
});

test.describe("search shortcut (phone)", () => {
  test.skip(({ isMobile }) => !isMobile, "phone-only: runs on the Pixel 7 project");

  test("the search and its hint are not shown, and Ctrl+K from a hardware keyboard is left to the browser", async ({ page }) => {
    await installApi(page);
    const errors = watchErrors(page);
    await page.goto("/links");

    await expect(page.getByRole("combobox", { name: SEARCH })).toBeHidden();
    await expect(page.locator("kbd:visible")).toHaveCount(0);
    expect(await dispatchPrevented(page, { ctrlKey: true })).toBe(false);
    expect(errors).toEqual([]);
  });
});
