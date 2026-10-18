/**
 * Journey 761 — The New link / Edit link drawers ask before throwing typed input away (#761)
 *
 * A real user: signs in -> opens New link -> types a destination, slug and tag -> hits Esc
 * (or clicks the backdrop / the ✕ / Cancel) -> is asked "Discard this link?" -> keeps editing,
 * finishes the form and creates the link -> follows the short link. Then the same on Edit.
 *
 * Oracles:
 *   - GET /links over HTTP (independent of the UI): a discarded draft created NOTHING, an
 *     abandoned edit changed NOTHING, a saved one persisted.
 *   - The redirect service on :3002 for what a visitor gets (3xx + exact Location).
 *   - The drawer itself: values still in the fields after "Keep editing".
 *
 * Requires the local staging stack (api :3001, redirect :3002) and the web app on :3000 —
 * see playwright.journeys.config.ts. Screenshots are viewport-only (a fullPage capture of a
 * tall page can exceed the image limit of the tooling that reads them).
 */

import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, createLink, makeEmail, registerUser, seedAccount, type Session } from "./helpers";

const SHOTS = process.env.QA_761_SHOTS ?? path.resolve(__dirname, "../../.qa-runs/761/shots");
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

const DEST = "https://example.com/j761-draft";
const EDITED = "https://example.com/j761-edited";

const confirm = (page: Page, title: string) => page.getByRole("alertdialog", { name: title });
const destination = (drawer: Locator) => drawer.getByPlaceholder("https://acme.com/collections/spring-2026");

async function listLinks(session: Session) {
  const res = await fetch(`${API_URL}/links?limit=100`, { headers: { authorization: `Bearer ${session.accessToken}` } });
  expect(res.ok, "GET /links").toBe(true);
  const body = (await res.json()) as { items: Array<{ id: string; slug: string; destination: string }> };
  return body.items;
}

async function visit(slug: string) {
  const res = await fetch(`${REDIRECT_URL}/${slug}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36" } });
  return { status: res.status, location: res.headers.get("location") ?? "" };
}

async function openCreate(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  // The real workspace's domain arrives asynchronously; the user sees it in the select.
  await expect(drawer.getByLabel("Short-link domain")).not.toHaveValue("");
  return drawer;
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`Journey 761 — drawer discard confirmation (${scheme})`, () => {
    test.use({ colorScheme: scheme });

    /* One account per describe (and project): the register endpoint is throttled to 5/min. */
    let session: Session;
    test.beforeAll(async ({}, info) => {
      session = await registerUser(makeEmail(`j761-${scheme}-${info.project.name}`));
    });

    test(`create: Esc asks, Keep editing keeps every value, Discard creates nothing, then the form can still be saved @mobile`, async ({ page }, info) => {
      await seedAccount(page, session);
      const slug = `j761-${scheme}-${Date.now().toString(36)}`;

      // 1. Untouched: Esc closes at once.
      let drawer = await openCreate(page);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      // 2. Typed: Esc asks.
      drawer = await openCreate(page);
      await destination(drawer).fill(DEST);
      await drawer.getByPlaceholder("spring-sale").fill(slug);
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard this link?")).toBeVisible();
      await expect(drawer).toBeVisible();
      await shot(page, `create-ask-${scheme}-${info.project.name}`);

      // 3. Keep editing: nothing changed, focus is inside the drawer.
      await confirm(page, "Discard this link?").getByRole("button", { name: "Keep editing" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(destination(drawer)).toHaveValue(DEST);
      await expect(drawer.getByPlaceholder("spring-sale")).toHaveValue(slug);
      expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

      // 4. ✕ asks too; Discard closes and nothing was created.
      await drawer.getByRole("button", { name: "Close" }).click();
      await confirm(page, "Discard this link?").getByRole("button", { name: "Discard", exact: true }).click();
      await expect(drawer).toBeHidden();
      expect((await listLinks(session)).map((l) => l.slug)).not.toContain(slug);

      // 5. The next open is blank, and a form finished after a "Keep editing" still creates the link.
      drawer = await openCreate(page);
      await expect(destination(drawer)).toHaveValue("");
      await destination(drawer).fill(DEST);
      await drawer.getByPlaceholder("spring-sale").fill(slug);
      await page.keyboard.press("Escape");
      await confirm(page, "Discard this link?").getByRole("button", { name: "Keep editing" }).click();
      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      const links = await listLinks(session);
      expect(links.map((l) => l.slug)).toContain(slug);
      expect(links.find((l) => l.slug === slug)!.destination).toBe(DEST);
      // The core journey: the short link actually redirects.
      const hit = await visit(slug);
      expect(hit.status).toBeGreaterThanOrEqual(300);
      expect(hit.status).toBeLessThan(400);
      expect(hit.location).toBe(DEST);
    });

    test(`create: the backdrop asks (desktop), and an emptied-again form closes at once`, async ({ page }, info) => {
      test.skip((page.viewportSize()?.width ?? 0) < 700, "the drawer fills a phone-width screen; there is no backdrop to click");
      await seedAccount(page, session);

      let drawer = await openCreate(page);
      await destination(drawer).fill(DEST);
      await page.mouse.click(20, 300);
      await expect(confirm(page, "Discard this link?")).toBeVisible();
      await confirm(page, "Discard this link?").getByRole("button", { name: "Keep editing" }).click();
      await expect(destination(drawer)).toHaveValue(DEST);

      await destination(drawer).fill("");
      await page.mouse.click(20, 300);
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      drawer = await openCreate(page);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    });

    test(`edit: Esc / Cancel / ✕ ask only after a change; Keep editing, then Save persists @mobile`, async ({ page }, info) => {
      const link = await createLink(session.accessToken, { destination: DEST });
      await seedAccount(page, session);

      await page.goto(`/links/${link.id}`);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: new RegExp(`Edit .+/${link.slug}`) });
      await expect(drawer).toBeVisible();

      // Untouched: closes at once.
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      // Changed: asks, via each route.
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await expect(drawer).toBeVisible();
      await destination(drawer).fill(EDITED);
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard your changes?")).toBeVisible();
      await shot(page, `edit-ask-${scheme}-${info.project.name}`);
      await confirm(page, "Discard your changes?").getByRole("button", { name: "Keep editing" }).click();
      await expect(destination(drawer)).toHaveValue(EDITED);
      await drawer.getByRole("button", { name: "Cancel" }).click();
      await expect(confirm(page, "Discard your changes?")).toBeVisible();
      await confirm(page, "Discard your changes?").getByRole("button", { name: "Keep editing" }).click();

      // Discard: nothing persisted.
      await drawer.getByRole("button", { name: "Close" }).click();
      await confirm(page, "Discard your changes?").getByRole("button", { name: "Discard", exact: true }).click();
      await expect(drawer).toBeHidden();
      expect((await listLinks(session)).find((l) => l.id === link.id)!.destination).toBe(DEST);

      // Save after a Keep editing: persisted and live.
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await destination(drawer).fill(EDITED);
      await page.keyboard.press("Escape");
      await confirm(page, "Discard your changes?").getByRole("button", { name: "Keep editing" }).click();
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect((await listLinks(session)).find((l) => l.id === link.id)!.destination).toBe(EDITED);
      const hit = await visit(link.slug);
      expect(hit.status).toBeGreaterThanOrEqual(300);
      expect(hit.status).toBeLessThan(400);
      expect(hit.location).toBe(EDITED);
    });
  });
}
