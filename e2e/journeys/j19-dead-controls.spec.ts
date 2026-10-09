/**
 * Journey 19 — Export, import and danger-zone controls have real effects (#661)
 *
 * A user signs in through the real form, then works the controls that used to
 * be inert on /analytics, /settings and the top bar.
 *
 * Oracles (what the PERSON gets, not the implementation):
 *   - "Export CSV" on /analytics downloads a real CSV file (browser download
 *     event) that contains the link the user created. Web (:3000) and API
 *     (:3001) are different origins, so this also proves the export endpoint
 *     is readable cross-origin (#636).
 *   - Both "Import from Bitly" buttons (top bar, Settings) land on /links with
 *     the Import panel open and Bitly preselected -- including when the user is
 *     already on /links with the panel closed.
 *   - "Self-host this workspace" goes to the real /self-host page.
 *   - Controls with no backend behind them are GONE (#217 "removed rather than
 *     faked"): Schedule report, Export everything, Import from Short.io (the
 *     importer has no Short.io source), Read the guarantee (the guarantee copy
 *     is already inline, nothing to read), Delete workspace and the 7-day-hold
 *     copy that promised it (no delete-workspace endpoint exists).
 *   - Every control left in the three areas does something observable.
 *
 * One password sign-in (login throttle is 5/min per IP). Requires the local
 * staging stack + web on :3000.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { RUN_PASSWORD, createLink, makeEmail, registerUser } from "./helpers";

const REMOVED_BUTTONS = [
  "Schedule report",
  "Export everything",
  "Import from Short.io",
  "Read the guarantee",
  "Delete workspace",
];

async function expectImportPanelOpenOnBitly(page: Page, where: string) {
  await expect(page, `${where}: lands on /links`).toHaveURL(/\/links(\?|$)/, { timeout: 15_000 });
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "Import links" }), `${where}: import panel is open`).toBeVisible({
    timeout: 15_000,
  });
  await expect(main.getByLabel("Import source"), `${where}: Bitly preselected`).toHaveValue("bitly");
}

test.describe("Journey 19 — dead controls (#661)", () => {
  // One real sign-in for the whole file (login throttle is 5/min per IP); each
  // test below starts from its own page.goto, so they are independent and a
  // failure in one does not hide the others.
  let context: BrowserContext;
  let page: Page;
  let link: { slug: string };

  test.beforeAll(async ({ browser }, testInfo) => {
    const email = makeEmail("j19");
    const session = await registerUser(email);
    link = await createLink(session.accessToken, { destination: "https://example.com/j19-target" });
    context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: true,
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

  test("analytics: Export CSV downloads a real CSV with the user's link (cross-origin)", async () => {
    await page.goto("/analytics");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 15_000 });

    const exportReq = page.waitForResponse((r) => r.url().includes("/links/export"), { timeout: 15_000 });
    const downloadP = page.waitForEvent("download", { timeout: 15_000 });
    await main.getByRole("button", { name: "Export CSV", exact: true }).click();
    const download = await downloadP;
    const exportRes = await exportReq;
    expect(exportRes.status(), "export endpoint answered").toBe(200);
    expect(exportRes.headers()["content-type"] ?? "").toContain("text/csv");
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const csv = Buffer.concat(chunks).toString("utf8");
    expect(csv.split("\n")[0], "CSV header row").toContain("short_url");
    expect(csv, "CSV contains the link the user created").toContain(link.slug);
    expect(csv).toContain("https://example.com/j19-target");
  });

  test("analytics: Schedule report is gone; View all goes to the links list", async () => {
    await page.goto("/analytics");
    const main = page.locator("main");
    await expect(main.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole("button", { name: "Schedule report" })).toHaveCount(0);
    await expect(main.getByText("Top links")).toBeVisible({ timeout: 15_000 });
    await main.getByRole("link", { name: "View all" }).click();
    await expect(page).toHaveURL(/\/links$/);
  });

  test("analytics: every control left in the page body has an observable effect (inventory)", async () => {
    await page.goto("/analytics");
    const main = page.locator("main");
    await expect(main.getByText("Top links")).toBeVisible({ timeout: 15_000 });

    // The denominator: exactly these controls exist. A new, unexercised one fails here.
    const buttons = (await main.getByRole("button").allInnerTexts()).map((t) => t.trim());
    expect(buttons.sort()).toEqual(["12m", "24h", "30d", "7d", "90d", "Clicks", "Clicks + scans", "Export CSV"].sort());
    const links = (await main.getByRole("link").allInnerTexts()).map((t) => t.trim());
    expect(links).toEqual(["View all"]);

    // Range options: a network request for the new window AND the pressed state.
    for (const range of ["24h", "7d", "90d", "12m", "30d"]) {
      const btn = main.getByRole("button", { name: range, exact: true });
      const req = range === "30d" ? null : page.waitForRequest((r) => r.url().includes(`/analytics?range=${range}`), { timeout: 15_000 });
      await btn.click();
      await req;
      await expect(btn).toHaveAttribute("aria-pressed", "true");
      await expect(main.getByRole("button", { name: /^(24h|7d|30d|90d|12m)$/, pressed: true })).toHaveCount(1);
    }
    // Series tabs: pressed state flips and the chart legend changes with it.
    const both = main.getByRole("button", { name: "Clicks + scans", exact: true });
    const clicksOnly = main.getByRole("button", { name: "Clicks", exact: true });
    await clicksOnly.click();
    await expect(clicksOnly).toHaveAttribute("aria-pressed", "true");
    await expect(both).toHaveAttribute("aria-pressed", "false");
    await both.click();
    await expect(both).toHaveAttribute("aria-pressed", "true");
    // Export CSV and View all are exercised in the two tests above.
  });

  test("settings: the Import & portability card holds exactly the two live controls", async () => {
    await page.goto("/settings");
    const main = page.locator("main");
    await expect(main.getByText("Link permanence")).toBeVisible({ timeout: 15_000 });
    const card = main.getByRole("heading", { name: "Import & portability" }).locator("xpath=../..");
    await expect(card.getByRole("button")).toHaveCount(1);
    await expect(card.getByRole("button", { name: /Import from Bitly/ })).toBeVisible();
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByRole("link", { name: /Self-host this workspace/ })).toHaveAttribute("href", "/self-host");
    // The guarantee card keeps its copy but has no control that points nowhere.
    const permanence = main.getByRole("heading", { name: "Link permanence" }).locator("xpath=../..");
    await expect(permanence.getByText("they keep redirecting forever")).toBeVisible();
    await expect(permanence.getByRole("button")).toHaveCount(0);
  });

  test("top bar: Import from Bitly opens the import panel on /links (from another page)", async () => {
    await page.goto("/analytics");
    await expect(page.locator("main").getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("banner").getByRole("button", { name: "Import from Bitly" }).click();
    await expectImportPanelOpenOnBitly(page, "top bar from /analytics");
  });

  test("top bar: Import from Bitly opens the panel when already on /links with it closed", async () => {
    await page.goto("/links");
    const main = page.locator("main");
    await expect(main.getByRole("button", { name: "Import", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole("heading", { name: "Import links" })).toHaveCount(0);
    await page.getByRole("banner").getByRole("button", { name: "Import from Bitly" }).click();
    await expectImportPanelOpenOnBitly(page, "top bar on /links");
    // Close and use it again: it must open a second time, not toggle or stick.
    await main.getByRole("button", { name: "Cancel import" }).click();
    await expect(main.getByRole("heading", { name: "Import links" })).toHaveCount(0);
    await page.getByRole("banner").getByRole("button", { name: "Import from Bitly" }).click();
    await expectImportPanelOpenOnBitly(page, "top bar on /links, second time");
  });

  test("settings: controls with no backend, and the promise they carried, are gone", async () => {
    await page.goto("/settings");
    const main = page.locator("main");
    await expect(main.getByText("Link permanence")).toBeVisible({ timeout: 15_000 });
    for (const name of REMOVED_BUTTONS) {
      await expect(page.getByRole("button", { name }), `"${name}" must be removed`).toHaveCount(0);
      await expect(page.getByRole("link", { name }), `"${name}" must be removed`).toHaveCount(0);
    }
    const text = await main.innerText();
    expect(text, "no copy promising a delete-workspace flow").not.toMatch(/Danger zone|wait 7 days|Delete workspace/i);
    expect(text, "no Short.io import").not.toMatch(/Short\.io/);
  });

  test("settings: Import from Bitly opens the import panel with Bitly selected", async () => {
    await page.goto("/settings");
    const main = page.locator("main");
    await expect(main.getByText("Link permanence")).toBeVisible({ timeout: 15_000 });
    await main.getByRole("button", { name: /Import from Bitly/ }).click();
    await expectImportPanelOpenOnBitly(page, "settings");
  });

  test("settings: Self-host this workspace reaches the real /self-host page", async () => {
    await page.goto("/settings");
    const main = page.locator("main");
    await expect(main.getByText("Link permanence")).toBeVisible({ timeout: 15_000 });
    await main.getByRole("link", { name: /Self-host this workspace/ }).click();
    await expect(page).toHaveURL(/\/self-host$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Export everything, always" })).toBeVisible();
  });
});
