/**
 * Journey 782 — the shared SnapURL domain on /domains (#782)  @mobile
 *
 * Oracles (independent of the implementation):
 *   - Issue #782 acceptance criteria: the shared/system domain has no
 *     Disconnect action, and its SSL cell does not contradict its Live status.
 *   - packages/contract `Domain`: `shared` marks the built-in domain; status and
 *     ssl are each live|verifying|failed / active|pending|failed.
 *   - Observed API behaviour: DELETE /domains/:id on the shared row is a 409
 *     ("That's a shared SnapURL domain …"), so the UI must never offer it.
 *
 * Requires the local staging stack + web on :3000.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, makeEmail, registerUser, seedAccount } from "./helpers";

const SHARED_HOST = process.env.QA_DEFAULT_DOMAIN ?? new URL(REDIRECT_URL).host;
const host = `j782-${RUN_ID}.example.com`;
const EVIDENCE = path.resolve(__dirname, "../../.qa-runs/782");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (p: Page, h: string) =>
  p.locator("tbody tr").filter({ has: p.locator("td:first-child", { hasText: new RegExp(`^\\s*${escapeRe(h)}`) }) });

test.describe("Journey 782 — shared domain actions and SSL state", () => {
  test("shared domain: no Disconnect, SSL agrees with Live; custom domain keeps Disconnect @mobile", async ({ page }, testInfo) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-${name}.png`), fullPage: true });

    const session = await registerUser(makeEmail("j782"));
    const add = await fetch(`${API_URL}/domains`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ domain: host }),
    });
    expect(add.status, "POST /domains").toBe(201);

    // What the API says about the shared row (the data the page renders from).
    const list = (await (await fetch(`${API_URL}/domains`, { headers: { authorization: `Bearer ${session.accessToken}` } })).json()) as Array<{
      id: string; domain: string; status: string; ssl: string; shared?: boolean;
    }>;
    const sharedRow = list.find((d) => d.domain === SHARED_HOST);
    expect(sharedRow, `${SHARED_HOST} is listed`).toMatchObject({ shared: true, status: "live", ssl: "active" });

    await seedAccount(page, session);
    await page.goto("/domains");
    await expect(row(page, host)).toBeVisible({ timeout: 15_000 });
    const shared = row(page, SHARED_HOST);
    await expect(shared).toBeVisible();

    // Shared: no Disconnect (nothing to click), a visible reason, SSL consistent with Live.
    await expect(shared.getByRole("button", { name: /disconnect/i })).toHaveCount(0);
    await expect(shared.getByText("Can't be disconnected")).toBeVisible();
    await expect(shared.getByText("Live", { exact: true })).toBeVisible();
    await expect(shared.getByText("Managed by SnapURL")).toBeVisible();
    await expect(shared.getByText("Pending")).toHaveCount(0);
    await shot("domains");

    // The API still refuses it, which is why the control must not exist.
    const del = await fetch(`${API_URL}/domains/${sharedRow!.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(del.status, "DELETE shared domain").toBe(409);

    // Custom domain (verifying): honest status + SSL, and Disconnect still works end to end.
    const own = row(page, host);
    await expect(own.getByText("Verifying DNS")).toBeVisible();
    await expect(own.getByText("Pending", { exact: true })).toBeVisible();
    await own.getByRole("button", { name: "Disconnect" }).click();
    await shot("confirming");
    await own.getByRole("button", { name: "Disconnect" }).click();
    await expect(row(page, host)).toHaveCount(0);
    await expect(row(page, SHARED_HOST)).toBeVisible();
    await shot("after-disconnect");
  });
});
