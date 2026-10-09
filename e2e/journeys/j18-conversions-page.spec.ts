/**
 * Journey 18 — Conversions page: no dead controls, no NaN/Infinity, no false claim (#662)
 *
 * A user signs in, drives real clicks through the redirect service, and opens
 * /conversions in a workspace that has clicks but no conversions. Then records
 * a sale with no leads or signups before it (a zero previous funnel step).
 *
 * Oracles (what the PERSON sees, not the implementation):
 *   - no "NaN" / "Infinity" anywhere on the page, in either state;
 *   - a zero baseline / zero previous step renders a dash — never "▲ 0.0%",
 *     "▲ 100.0%" or "▼ NaN% drop off";
 *   - the copy no longer claims a click ID travels in the redirect (no click ID
 *     exists: the redirect Location carries only the destination + UTM params —
 *     asserted here against the real redirect response);
 *   - "Define an event", "Install tracking" and "＋ Add" are gone (#217: remove a
 *     control rather than fake what is behind it), and every button that remains
 *     in the page body has an observable effect when clicked.
 *
 * One password sign-in (login throttle is 5/min per IP). Requires the local
 * staging stack + web on :3000.
 */

import { expect, test, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_PASSWORD, RUN_ID, createLink, makeEmail, registerUser } from "./helpers";

const DASH = "—";

async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Everything the person can read on the page body. */
const bodyText = (page: Page) => page.locator("main").innerText();

async function expectNoNumericArtifacts(page: Page, where: string) {
  const text = await bodyText(page);
  expect(text, `${where}: NaN/Infinity on the page`).not.toMatch(/NaN|Infinity/);
  // A zero change or a change from a zero baseline must not be drawn as a direction.
  // (A genuine 100% funnel drop-off is a real number and is allowed.)
  expect(text, `${where}: misleading zero/100% delta`).not.toMatch(/[▲▼]\s*(0\.0|100\.0)%(?! drop off)/);
}

test.describe("Journey 18 — Conversions page (#662)", () => {
  test("clicks but no conversions, then a sale with no earlier funnel steps", async ({ page }) => {
    /* ---- Setup: a workspace with real clicks, no conversions ---- */
    const email = makeEmail("j18");
    const session = await registerUser(email);
    const link = await createLink(session.accessToken, { destination: "https://example.com/j18-target" });

    // Oracle for the click-ID claim: the real redirect carries no click identifier.
    const hop = await fetch(`${REDIRECT_URL}/${link.slug}`, { redirect: "manual" });
    expect([301, 302, 307, 308]).toContain(hop.status);
    const location = hop.headers.get("location") ?? "";
    expect(location).toBe("https://example.com/j18-target");
    expect(location.toLowerCase()).not.toMatch(/click_?id|clid/);
    for (let i = 0; i < 2; i++) await fetch(`${REDIRECT_URL}/${link.slug}`, { redirect: "manual" });

    // Wait for the rollup so the report really has clicks.
    let clicks = 0;
    for (let i = 0; i < 24 && clicks < 3; i++) {
      const r = await api(session.accessToken, "/conversions?range=30d");
      clicks = ((await r.json()) as { totals: { clicks: number } }).totals.clicks;
      if (clicks < 3) await new Promise((res) => setTimeout(res, 5000));
    }
    expect(clicks, "rollup should have counted the 3 driven clicks").toBeGreaterThanOrEqual(3);

    /* ---- 1. Sign in through the real form, open /conversions ---- */
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/links$/, { timeout: 20_000 });

    await page.goto("/conversions");
    const main = page.locator("main");
    await expect(main.getByText("Funnel", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText("Clicks", { exact: true }).first()).toBeVisible();

    /* ---- 2. State A: clicks, zero conversions ---- */
    await expectNoNumericArtifacts(page, "state A");
    // Leads -> Signups and Signups -> Paid both have a zero previous step.
    expect(await main.getByText(`${DASH} drop off`).count(), "two zero-previous funnel steps render a dash").toBe(2);
    // Clicks -> Leads is a real, numeric 100% drop.
    await expect(main.getByText("▼ 100.0% drop off")).toBeVisible();
    // The Clicks tile has a zero previous window: a dash, not "▲ 100.0%".
    const clicksTile = main.locator("xpath=.//div[normalize-space(text())='Clicks']/parent::div").first();
    await expect(clicksTile).toContainText(DASH);
    await expect(clicksTile).not.toContainText("%");

    /* ---- 3. The false click-ID claim is gone ---- */
    const textA = await bodyText(page);
    expect(textA).not.toMatch(/click id/i);
    expect(textA).not.toMatch(/Safari|ad blockers|cross-device|Attribution is server-side/i);

    /* ---- 4. Dead controls are gone; every remaining button has an effect ---- */
    for (const name of ["Define an event", "Install tracking", "＋ Add", "+ Add"]) {
      await expect(page.getByRole("button", { name, exact: true }), `"${name}" must be removed`).toHaveCount(0);
    }
    // The only buttons left in the page body are the five range options.
    const labels = await main.getByRole("button").allInnerTexts();
    expect(labels.map((l) => l.trim())).toEqual(["24h", "7d", "30d", "90d", "12m"]);
    for (const range of ["24h", "7d", "90d", "12m", "30d"]) {
      const btn = main.getByRole("button", { name: range, exact: true });
      // 30d was already fetched on load and is cached client-side (staleTime), so
      // returning to it is a DOM-only effect; every other window must hit the API.
      const req = range === "30d" ? null : page.waitForRequest((r) => r.url().includes(`/conversions?range=${range}`), { timeout: 15_000 });
      await btn.click();
      await req; // network effect
      await expect(btn).toHaveAttribute("aria-pressed", "true"); // DOM effect
      await expect(main.getByRole("button", { pressed: true })).toHaveCount(1);
      await expect(main.getByText("Funnel", { exact: true })).toBeVisible({ timeout: 15_000 });
      await expectNoNumericArtifacts(page, `range ${range}`);
    }

    /* ---- 5. State B: a sale recorded with no leads/signups before it ---- */
    const sale = await api(session.accessToken, "/conversions", {
      method: "POST",
      body: JSON.stringify({
        linkId: link.id,
        kind: "sale",
        name: `J18-Sale-${RUN_ID.slice(0, 8)}`,
        valueMinor: 49900,
        currency: "INR",
        externalId: `j18-${RUN_ID}`,
      }),
    });
    expect(sale.status, "record the sale").toBeLessThan(300);
    expect(((await sale.json()) as { recorded: boolean }).recorded).toBe(true);

    // The person refreshes the page (the client caches each window for 30s).
    await page.reload();
    await expect(main.getByText("Funnel", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText(`J18-Sale-${RUN_ID.slice(0, 8)}`)).toBeVisible({ timeout: 15_000 });

    // Paid = 1 with Signups = 0: the old code drew "▼ -Infinity% drop off" here.
    await expectNoNumericArtifacts(page, "state B");
    expect(await main.getByText(`${DASH} drop off`).count(), "zero-previous steps still render a dash").toBeGreaterThanOrEqual(2);
    // The by-link table has a link with clicks and revenue; the page has not turned into dashes.
    await expect(main.getByText(link.slug)).toBeVisible();
    expect(await bodyText(page)).not.toMatch(/click id/i);
  });
});
