/**
 * Journey 24 — conversions in another currency are not silently dropped (#654)
 *
 * G7 (docs/DECISIONS.md) stays: revenue counts only the workspace currency and
 * converts nothing. The defect was the exclusion being invisible, and the
 * workspace currency being unchangeable in the UI.
 *
 * A person (workspace owner) records sales through an API key, in INR and in
 * USD, then:
 *   1. opens /conversions and SEES that the USD sales were not counted (and
 *      which currency, and how many), while Revenue shows only the INR sale;
 *   2. goes to Settings, changes the workspace currency to USD with the
 *      select, saves, and reloads: the choice persisted;
 *   3. returns to /conversions: Revenue is now the USD sales in $, the INR
 *      sale is the excluded one, and the notice says so.
 * A Viewer in the same workspace opens Settings and cannot change the currency.
 * When nothing is excluded the notice is not on the page at all.
 *
 * Oracles: the issue's acceptance criteria; PATCH /workspaces/current is
 * @Roles("admin"). What the PERSON reads — not the implementation.
 *
 * One password sign-in per person (login throttle is 5/min per IP). Requires
 * the local staging stack + web on :3000.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser, seedAccount } from "./helpers";

const run = promisify(execFile);
const API_CONTAINER = process.env.QA_API_CONTAINER ?? "snapurl-staging-api-1";

const json = { "content-type": "application/json" };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/links$/, { timeout: 20_000 });
}

async function createKey(token: string): Promise<string> {
  const res = await fetch(`${API_URL}/api-keys`, {
    method: "POST",
    headers: { ...json, authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: `j24-${RUN_ID}`, scopes: ["conversions:write"] }),
  });
  expect(res.status, "create the API key").toBe(201);
  return ((await res.json()) as { key: string }).key;
}

async function recordSale(key: string, name: string, valueMinor: number, currency: string, ext: string) {
  const res = await fetch(`${API_URL}/conversions`, {
    method: "POST",
    headers: { ...json, authorization: `Bearer ${key}` },
    body: JSON.stringify({ kind: "sale", name, valueMinor, currency, externalId: `${ext}-${RUN_ID}` }),
  });
  expect(res.status, `record ${name}`).toBe(201);
  expect(((await res.json()) as { recorded: boolean }).recorded).toBe(true);
}

/** The Revenue tile's value as the person reads it. */
async function revenueTile(page: Page): Promise<string> {
  const tile = page.locator("main").locator("xpath=.//div[normalize-space(text())='Revenue']/parent::div").first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  return (await tile.innerText()).replace(/\s+/g, " ");
}

test.describe("Journey 24 — conversion currency visibility (#654)", () => {
  test("an off-currency sale is surfaced, and the currency can be changed in Settings", async ({ page }) => {
    const email = makeEmail("j24");
    const session = await registerUser(email);
    const key = await createKey(session.accessToken);

    /* ---- 0. A fresh workspace with no conversions: no notice at all ---- */
    await signIn(page, email);
    await page.goto("/conversions");
    const main = page.locator("main");
    await expect(main.getByText("Funnel", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(main.getByText(/not counted in revenue/i), "no notice when nothing was excluded").toHaveCount(0);

    /* ---- 1. Record: 1 INR sale (100.00), 2 USD sales (49.00 + 10.00) ---- */
    await recordSale(key, "J24 INR sale", 10000, "INR", "j24-inr");
    await recordSale(key, "J24 USD sale A", 4900, "USD", "j24-usd-a");
    await recordSale(key, "J24 USD sale B", 1000, "USD", "j24-usd-b");

    /* ---- 2. /conversions says what was left out ---- */
    await page.reload();
    await expect(main.getByText("J24 INR sale")).toBeVisible({ timeout: 15_000 });
    const notice = main.getByRole("note").filter({ hasText: /not counted in revenue/i });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("2 conversions in other currencies (USD) were not counted in revenue.");
    await expect(notice).toContainText("USD · 2 conversions · $59");
    // Revenue is the INR sale only (G7 unchanged), and it is in ₹.
    expect(await revenueTile(page)).toContain("₹100");
    expect(await revenueTile(page)).not.toContain("$");

    /* ---- 3. The notice points to Settings, and Settings has the control ---- */
    await notice.getByRole("link", { name: /change workspace currency/i }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 15_000 });
    const select = page.getByLabel("Workspace currency");
    await expect(select).toBeVisible({ timeout: 15_000 });
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue("INR");

    /* ---- 4. Change it through the select, save, see the confirmation ---- */
    const saveReq = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith("/workspaces/current"));
    await select.selectOption("USD");
    await page.getByRole("button", { name: "Save changes" }).click();
    const sent = (await saveReq).postDataJSON() as { currency?: string };
    expect(sent.currency, "PATCH body carries the new currency").toBe("USD");
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });

    /* ---- 5. It persisted: reload Settings, the select still says USD ---- */
    await page.reload();
    await expect(page.getByLabel("Workspace currency")).toHaveValue("USD", { timeout: 15_000 });
    const ws = await fetch(`${API_URL}/workspaces/current`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    expect(((await ws.json()) as { currency: string }).currency).toBe("USD");

    /* ---- 6. /conversions now counts the USD sales and excludes the INR one ---- */
    await page.goto("/conversions");
    await expect(main.getByText("Funnel", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => revenueTile(page), { timeout: 15_000 }).toContain("$59");
    expect(await revenueTile(page)).not.toContain("₹");
    const notice2 = main.getByRole("note").filter({ hasText: /not counted in revenue/i });
    await expect(notice2).toContainText("1 conversion in another currency (INR) was not counted in revenue.");
    await expect(notice2).toContainText("INR · 1 conversion · ₹100");

    /* ---- 7. Back to INR: the notice returns to the USD sales ---- */
    await page.goto("/settings");
    await page.getByLabel("Workspace currency").selectOption("INR");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
    await page.goto("/conversions");
    await expect(main.getByRole("note").filter({ hasText: /not counted in revenue/i })).toContainText("(USD)", { timeout: 15_000 });
  });

  test("a Viewer sees the notice but cannot change the currency", async ({ page }, testInfo) => {
    // Owner workspace with one off-currency sale.
    const ownerEmail = makeEmail("j24-owner");
    const owner = await registerUser(ownerEmail);
    const key = await createKey(owner.accessToken);
    await recordSale(key, "J24 viewer USD sale", 2500, "USD", "j24v-usd");

    // The viewer: registers, is invited, verifies, accepts (API plumbing — the
    // surface under test is the Settings page they then see).
    const viewerEmail = makeEmail("j24-viewer");
    const viewer = await registerUser(viewerEmail);
    const inv = await fetch(`${API_URL}/members`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${owner.accessToken}` },
      body: JSON.stringify({ email: viewerEmail, role: "viewer" }),
    });
    expect(inv.status, "invite the viewer").toBe(201);
    const tokenOf = async (path: "/invite" | "/verify-email") =>
      new URL(await mailLink(viewerEmail, path)).searchParams.get("token")!;
    const verify = await fetch(`${API_URL}/auth/email/verify`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: await tokenOf("/verify-email") }),
    });
    expect(verify.status, "verify the viewer's email").toBe(200);
    const accept = await fetch(`${API_URL}/auth/invite/accept`, {
      method: "POST",
      headers: { ...json, authorization: `Bearer ${viewer.accessToken}` },
      body: JSON.stringify({ token: await tokenOf("/invite") }),
    });
    expect(accept.status, "accept the invitation").toBe(200);

    // Enter the joined workspace the way the switcher does (a hinted refresh).
    const wsRes = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ refreshToken: viewer.refreshToken, workspaceId: owner.workspaceId }),
    });
    expect(wsRes.status).toBe(200);
    const joined = (await wsRes.json()) as { accessToken: string; refreshToken: string };
    await seedAccount(page, { ...viewer, accessToken: joined.accessToken, refreshToken: joined.refreshToken });

    await page.goto("/conversions");
    const notice = page.locator("main").getByRole("note").filter({ hasText: /not counted in revenue/i });
    await expect(notice).toContainText("1 conversion in another currency (USD) was not counted in revenue.", { timeout: 15_000 });

    await page.goto("/settings");
    const select = page.getByLabel("Workspace currency");
    await expect(select).toBeVisible({ timeout: 15_000 });
    await expect(select).toBeDisabled();
    await expect(page.getByText(/only (workspace )?owners and admins can change/i)).toBeVisible();
    testInfo.annotations.push({ type: "role", description: "viewer" });
  });
});

/** The newest link of the given kind in the newest mail to `email` (api container outbox, as in j15). */
async function mailLink(email: string, path: "/invite" | "/verify-email"): Promise<string> {
  const sanitized = email.replace(/[^a-z0-9]/gi, "_");
  for (let i = 0; i < 40; i++) {
    try {
      const { stdout } = await run("docker", [
        "exec", API_CONTAINER, "sh", "-c",
        `ls /tmp/snapurl-outbox/ 2>/dev/null | grep -F -- '-${sanitized}.txt' | sort -t- -k1,1 -n -r`,
      ]);
      for (const name of stdout.split("\n").filter(Boolean)) {
        const { stdout: body } = await run("docker", ["exec", API_CONTAINER, "cat", `/tmp/snapurl-outbox/${name}`]);
        const m = body.match(new RegExp(`(https?://\\S+${path}\\?token=[^\\s&]+)`));
        if (m) return m[1]!;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${path} mail for ${email}`);
}
