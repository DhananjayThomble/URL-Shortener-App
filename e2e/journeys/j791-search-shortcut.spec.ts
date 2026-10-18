/**
 * Journey 791 — The search shortcut works on the platform you are on (#791)  @mobile
 *
 * The top-bar search showed a hard-coded "⌘K" hint and nothing listened for it, so
 * Ctrl+K did nothing on Linux/Windows. Real stack, real API.
 *
 * Oracles:
 *   - the issue's acceptance criteria: Ctrl+K (non-Mac) and ⌘K (Mac) both focus the
 *     search; the hint is platform-appropriate
 *   - WAI-ARIA aria-keyshortcuts: Control+K / Meta+K
 *   - the search is desktop/tablet only (DC5): a phone shows neither it nor a hint
 *
 * Platform is emulated with an init script (navigator.platform / userAgentData).
 */

import { expect, test, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { API_URL, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const COMBOBOX = "Search links, slugs, destinations, tags";

async function createLinkVia(session: Session) {
  const wsRes = await fetch(`${API_URL}/workspaces/current`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  const ws = (await wsRes.json()) as { defaultDomain?: string };
  const slug = `sk-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      destination: "https://example.com/search-shortcut-target",
      domain: ws.defaultDomain ?? "localhost:3002",
      slug,
    }),
  });
  if (!res.ok) throw new Error(`createLinkVia: POST /links → ${res.status}`);
  return { slug };
}

async function emulatePlatform(page: Page, platform: string) {
  await page.addInitScript((p) => {
    Object.defineProperty(navigator, "platform", { get: () => p, configurable: true });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined, configurable: true });
  }, platform);
}

async function shoot(page: Page, name: string) {
  const dir = process.env.QA_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

test.describe("Journey 791 — search shortcut", () => {
  test("Linux/Windows: Ctrl+K focuses the search, and typing then opens a result", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "top-bar search is desktop/tablet only (DC5)");
    const session = await registerUser(makeEmail("j791a"));
    const link = await createLinkVia(session);
    await emulatePlatform(page, "Linux x86_64");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

    await seedAccount(page, session);
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");
    await expect(page.locator("kbd", { hasText: "Ctrl K" })).toBeVisible();
    await shoot(page, "desktop-linux-hint");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(search).not.toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    await shoot(page, "desktop-linux-focused");

    // The point of the shortcut: straight into typing, then straight to the link.
    await page.keyboard.type(link.slug);
    const option = page.getByRole("listbox", { name: "Link results" }).getByRole("option", { name: new RegExp(link.slug) });
    await expect(option).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/links\/[^/]+$/);

    // Still works from the next page (the listener lives in the shell, not the page).
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("Mac: ⌘K hint and Cmd+K focuses the search (Ctrl+K does not)", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "top-bar search is desktop/tablet only (DC5)");
    const session = await registerUser(makeEmail("j791b"));
    await emulatePlatform(page, "MacIntel");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await seedAccount(page, session);
    await page.goto("/links");
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    await expect(page.locator("kbd", { hasText: "⌘K" })).toBeVisible();
    await shoot(page, "desktop-mac-hint");

    await page.keyboard.press("Control+k");
    await expect(search).not.toBeFocused();
    await page.keyboard.press("Meta+k");
    await expect(search).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("phone: no search and no hint @mobile", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "phone viewport only");
    const session = await registerUser(makeEmail("j791c"));
    await seedAccount(page, session);
    await page.goto("/links");
    await expect(page.getByRole("combobox", { name: COMBOBOX })).toBeHidden();
    await expect(page.locator("kbd:visible")).toHaveCount(0);
    await shoot(page, "mobile-no-hint");
  });
});
