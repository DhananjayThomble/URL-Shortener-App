/**
 * Journey 21 — the seven inert buttons from #706 are wired or gone
 *
 * A user signs in through the real form and works the four pages that carried
 * a <Button> with no handler: /developers, /links/:id, /qr and /team.
 *
 * Oracles (what the PERSON gets, not the implementation; #217 "removed rather
 * than faked", docs/DECISIONS.md):
 *   - "Copy link" on a link's page puts that link's public short URL
 *     (https://<domain>/<slug>) on the clipboard and says so.
 *   - "Read the docs" opens the API reference the API itself serves
 *     (<API_URL>/docs, Swagger UI) in a new tab, and that page loads.
 *   - Controls with no backend behind them are GONE: "Share report" (no share
 *     backend), the per-card "All" (the analytics response carries only the top
 *     rows, no "all" query), "Bulk generate" (no bulk QR generation),
 *     "Audit log" / "Full log" (the Recent activity card already renders the
 *     whole /audit response; there is no separate log page or paged endpoint).
 *   - Every control left on the four pages does something observable
 *     (inventory of buttons/links per page is asserted exactly).
 *
 * One password sign-in (login throttle is 5/min per IP). Requires the local
 * staging stack + web on :3000.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, RUN_PASSWORD, createLink, makeEmail, registerUser } from "./helpers";

const trimmed = (xs: string[]) => xs.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);

test.describe("Journey 21 — dead buttons (#706)", () => {
  let context: BrowserContext;
  let page: Page;
  let link: { id: string; slug: string; domain: string };

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = makeEmail("j21");
    const session = await registerUser(email);
    link = await createLink(session.accessToken, { destination: "https://example.com/j21-target" });
    context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    page = await context.newPage();
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/links$/, { timeout: 20_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("link page: Copy link puts the short URL on the clipboard and confirms it", async () => {
    await page.goto(`/links/${link.id}`);
    const main = page.locator("main");
    await expect(main.getByText("Total clicks")).toBeVisible({ timeout: 15_000 });

    await page.evaluate(() => navigator.clipboard.writeText("sentinel-before-click"));
    const copyBtn = main.getByRole("button", { name: "Copy link", exact: true });
    await copyBtn.click();
    await expect(main.getByRole("button", { name: /Copied/ })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(`https://${link.domain}/${link.slug}`);
    // The confirmation is momentary; the button returns to its label.
    await expect(copyBtn).toBeVisible({ timeout: 6_000 });
  });

  test("link page: Share report and the per-card All are gone; the control inventory is exact", async () => {
    await page.goto(`/links/${link.id}`);
    const main = page.locator("main");
    await expect(main.getByText("Total clicks")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Share report" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Share report" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "All", exact: true })).toHaveCount(0);
    // The four breakdown cards keep their data.
    for (const title of ["Countries", "Cities", "Devices", "Referrers"]) {
      await expect(main.getByRole("heading", { name: title })).toBeVisible();
    }
    // Denominator: exactly these controls exist on the page body.
    const buttons = trimmed(await main.getByRole("button").allInnerTexts());
    expect(buttons.sort()).toEqual(["12m", "24h", "30d", "Copy link", "Delete", "Edit"].sort());
    // Each remaining one: the range tabs fire a request for the new window and flip pressed state.
    for (const range of ["24h", "12m", "30d"]) {
      const btn = main.getByRole("button", { name: range, exact: true });
      const req = range === "30d" ? null : page.waitForRequest((r) => r.url().includes(`range=${range}`), { timeout: 15_000 });
      await btn.click();
      await req;
      await expect(btn).toHaveAttribute("aria-pressed", "true");
    }
    // Edit opens the drawer; Delete asks for confirmation (and Keep it backs out).
    await main.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await main.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(main.getByText(/cannot be undone/)).toBeVisible();
    await main.getByRole("button", { name: "Keep it" }).click();
    await expect(main.getByText(/cannot be undone/)).toHaveCount(0);
  });

  test("developers: Read the docs opens the API's own reference in a new tab and it loads", async () => {
    await page.goto("/developers");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Developers" })).toBeVisible({ timeout: 15_000 });
    const docs = main.getByRole("link", { name: "Read the docs" });
    await expect(docs).toHaveAttribute("href", `${API_URL}/docs`);
    const popupP = context.waitForEvent("page", { timeout: 15_000 });
    await docs.click();
    const popup = await popupP;
    await popup.waitForLoadState("domcontentloaded");
    expect(popup.url()).toMatch(new RegExp(`${API_URL.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/docs`));
    await expect(popup.locator("#swagger-ui")).toBeAttached({ timeout: 20_000 });
    await expect(popup.getByText(/SnapURL/i).first()).toBeVisible({ timeout: 20_000 });
    await popup.close();
  });

  test("developers: the rest of the header and key controls still work", async () => {
    await page.goto("/developers");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Developers" })).toBeVisible({ timeout: 15_000 });
    const nk = main.getByRole("button", { name: /New API key/ });
    await nk.click();
    await expect(main.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await main.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(main.getByRole("button", { name: /New API key/ })).toBeVisible();
  });

  test("qr: Bulk generate is gone; Download still downloads a real PNG", async () => {
    await page.goto("/qr");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "QR studio" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Bulk generate" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Bulk generate" })).toHaveCount(0);
    const dl = main.getByRole("button", { name: "Download", exact: true });
    await expect(dl).toBeEnabled({ timeout: 15_000 });
    const downloadP = page.waitForEvent("download", { timeout: 15_000 });
    await dl.click();
    const download = await downloadP;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const png = Buffer.concat(chunks);
    expect(png.subarray(1, 4).toString("ascii"), "PNG magic").toBe("PNG");
  });

  test("team: Audit log and Full log are gone; Recent activity still lists the audit entries", async () => {
    await page.goto("/team");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Team" })).toBeVisible({ timeout: 15_000 });
    for (const name of ["Audit log", "Full log"]) {
      await expect(page.getByRole("button", { name }), `"${name}" must be removed`).toHaveCount(0);
      await expect(page.getByRole("link", { name }), `"${name}" must be removed`).toHaveCount(0);
    }
    const card = main.getByRole("heading", { name: "Recent activity" }).locator("xpath=../..");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    // Invite is the one header action left, and it opens the invite form.
    await main.getByRole("button", { name: /Invite/ }).first().click();
    await expect(main.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  });
});
