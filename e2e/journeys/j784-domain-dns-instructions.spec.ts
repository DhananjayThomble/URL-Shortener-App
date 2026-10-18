/**
 * Journey 784 — custom-domain DNS setup shows every record, each copyable (#784)  @mobile
 *
 * Oracles (independent of the implementation):
 *   - Issue #784 acceptance criteria: routing record(s) with values appropriate to
 *     the deployment, and a Copy button on every DNS value.
 *   - packages/contract `Domain`: `dns` = TXT ownership proof, `routing` = the
 *     record that points traffic at this deployment.
 *   - The deployment's own redirect host: the shared system domain the API lists
 *     (`shared: true`) IS the host a customer domain must resolve to, so the
 *     routing value must equal that row's host with any port dropped (DNS has
 *     none). Read from the live API, never hard-coded.
 *   - Browser behaviour: after a real click, navigator.clipboard holds the text.
 *
 * Requires the local staging stack + web on :3000.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { API_URL, RUN_ID, makeEmail, registerUser, seedAccount } from "./helpers";

type DnsRecord = { type: string; name: string; value: string; ttl: number };
type ApiDomain = { id: string; domain: string; shared?: boolean; dns?: DnsRecord | null; routing?: DnsRecord | null };

const host = `j784-${RUN_ID}.example.com`;
const EVIDENCE = path.resolve(__dirname, "../../.qa-runs/784");

const call = (token: string, method: string, p: string, body?: unknown) =>
  fetch(`${API_URL}${p}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test.describe("Journey 784 — DNS setup instructions", () => {
  test("a new domain shows the TXT proof AND the routing record, and each value copies @mobile", async ({ page, context }, testInfo) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(EVIDENCE, `${testInfo.project.name}-${name}.png`), fullPage: true });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const owner = await registerUser(makeEmail("j784"));
    const added = await call(owner.accessToken, "POST", "/domains", { domain: host });
    expect(added.status, "POST /domains").toBe(201);
    const dto = (await added.json()) as ApiDomain;

    // The API's own answer: both records, and routing agrees with the live shared host.
    const list = (await (await call(owner.accessToken, "GET", "/domains")).json()) as ApiDomain[];
    const shared = list.find((d) => d.shared);
    expect(shared, "the shared domain is listed").toBeTruthy();
    const targetHost = shared!.domain.replace(/:\d+$/, "").toLowerCase();
    expect(dto.dns, "TXT proof").toMatchObject({ type: "TXT", name: `_snapurl.${host}` });
    expect(dto.routing, "routing record").toMatchObject({ type: "CNAME", name: host, value: targetHost });
    expect(shared!.routing ?? null, "the shared domain needs no routing record").toBeNull();

    await seedAccount(page, owner);
    await page.goto("/domains");
    const card = page.getByRole("region", { name: `Finish setting up ${host}` });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("heading", { name: /step 1.*verify ownership/i })).toBeVisible();
    await expect(card.getByRole("heading", { name: /step 2.*point/i })).toBeVisible();
    await expect(card.getByText("2 records to add")).toBeVisible();
    await shot("setup-card");

    // Each Name and Value: a real click, then the real clipboard.
    const expected: Array<[string, string]> = [
      [`Copy TXT name for ${host}`, dto.dns!.name],
      [`Copy TXT value for ${host}`, dto.dns!.value],
      [`Copy CNAME name for ${host}`, dto.routing!.name],
      [`Copy CNAME value for ${host}`, dto.routing!.value],
    ];
    for (const [label, text] of expected) {
      const btn = card.getByRole("button", { name: label });
      await btn.click();
      await expect(btn, label).toHaveText("Copied");
      expect(await page.evaluate(() => navigator.clipboard.readText()), label).toBe(text);
    }
    await shot("after-copy");

    // The page never scrolls sideways, whatever the viewport.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(0);
  });

  test("another workspace never sees this workspace's domain or its records", async ({ page }) => {
    const a = await registerUser(makeEmail("j784a"));
    const b = await registerUser(makeEmail("j784b"));
    const hostA = `j784a-${RUN_ID}.example.com`;
    expect((await call(a.accessToken, "POST", "/domains", { domain: hostA })).status).toBe(201);
    const theirs = (await (await call(b.accessToken, "GET", "/domains")).json()) as ApiDomain[];
    expect(theirs.some((d) => d.domain === hostA)).toBe(false);

    await seedAccount(page, b);
    await page.goto("/domains");
    await expect(page.getByRole("heading", { name: "Domains" })).toBeVisible();
    await expect(page.getByText(hostA)).toHaveCount(0);
  });
});
