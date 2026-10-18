/**
 * Journey 764 — the "+" preview says what a visitor following the link gets.
 *
 * QA saw "This link is safe to open" and a Continue button on the "+" preview
 * of an expired link with a country rule. The preview carried no lifecycle, so
 * the page could only speak to Safe Browsing.
 *
 * For each link the journey first asks the REAL redirect what a visitor gets
 * (the oracle: apps/redirect/src/main.ts gateFor), then opens its "+" preview
 * the way a visitor does (through the redirect's "+" bounce) and checks the
 * page says the same thing — and that Continue, when offered, really lands
 * where the redirect sends people.
 *
 * Oracles:
 *   - apps/redirect/src/main.ts — expired: 302 to expiresTo, else 410;
 *     not live yet: 302 to scheduledTo, else 404; archived: 410
 *   - packages/contract/src/public.ts — PublicLinkPreview.state / hasRules /
 *     hasFallback; never the fallback URL or a rule target
 *
 * A reached click limit is not driven here: the counter only moves with the
 * one-minute rollup. It is covered against real Postgres in
 * apps/api/src/public/public.preview-state.integration.test.ts.
 */

import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, makeEmail, registerUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

test.describe("Journey 764 — preview shows the link's state @mobile", () => {
  test("expired, scheduled, archived and rule-routed links each read as what the redirect does", async ({ page }, testInfo) => {
    const session = await registerUser(makeEmail(`j764-${testInfo.project.name}`));
    const auth = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };
    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth })).json()) as {
      defaultDomain?: string;
    };
    const domain = ws.defaultDomain ?? "localhost:3002";
    const tag = `${RUN_ID}-${testInfo.project.name}-${randomBytes(2).toString("hex")}`;
    const url = (what: string) => `https://example.com/j764-${what}-${tag}`;

    async function create(body: Record<string, unknown>) {
      const slug = `j764-${randomBytes(4).toString("hex")}`;
      const res = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ destination: url("dest"), domain, slug, ...body }),
      });
      expect(res.status, `POST /links → ${await res.clone().text()}`).toBe(201);
      return ((await res.json()) as { id: string; slug: string }) ;
    }

    /** The visitor's way in: "<short>+" bounces to /p/<slug>?host=… */
    async function openPreview(p: Page, slug: string) {
      const bounce = await fetch(`${REDIRECT_URL}/${slug}+`, { redirect: "manual" });
      expect(bounce.status).toBe(302);
      const location = bounce.headers.get("location") ?? "";
      expect(location).toContain(`/p/${slug}`);
      await p.goto(location.replace(/^https?:\/\/[^/]+/, ""));
      const html = await p.content();
      // Neither fallback nor rule target is ever on the page.
      expect(html).not.toContain("j764-fallback-");
      expect(html).not.toContain("j764-rule-");
    }

    async function noWayToDestination(p: Page) {
      await expect(p.getByText("This link is safe to open")).toHaveCount(0);
      await expect(p.getByRole("link", { name: /^Continue( anyway)? to (?!the owner's page)/ })).toHaveCount(0);
      await expect(p.locator(`a[href="${url("dest")}"]`)).toHaveCount(0);
    }

    // example.com stands in for the owner's pages; nothing leaves the machine.
    await page.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>landed</p>" }));
    const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`j764-${testInfo.project.name}-${name}.png`), fullPage: true });

    /* ---- 1. QA's case: expired, with a fallback and a country rule ---- */
    const qaFull = await create({
      expiresAt: new Date(Date.now() - DAY).toISOString(),
      expiresTo: url("fallback-expired"),
      rules: [{ id: "r1", when: { country: "IN" }, then: url("rule-in") }],
    });
    const r1 = await fetch(`${REDIRECT_URL}/${qaFull.slug}`, { redirect: "manual" });
    expect(r1.status, "the redirect sends an expired link to its fallback").toBe(302);
    expect(r1.headers.get("location")).toBe(url("fallback-expired"));

    await openPreview(page, qaFull.slug);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText(/the owner sends visitors to a different page/)).toBeVisible();
    await expect(page.getByText("Expired", { exact: true })).toBeVisible();
    await noWayToDestination(page);
    await shot("expired-fallback");
    const landed = page.waitForRequest((r) => r.url() === url("fallback-expired"));
    await page.getByRole("link", { name: "Continue to the owner's page →" }).click();
    await landed;

    /* ---- 2. Expired, no fallback: the redirect answers 410 ---- */
    const dead = await create({ expiresAt: new Date(Date.now() - DAY).toISOString() });
    expect((await fetch(`${REDIRECT_URL}/${dead.slug}`, { redirect: "manual" })).status).toBe(410);
    await openPreview(page, dead.slug);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await expect(page.getByText(/^Nowhere\./)).toBeVisible();
    await noWayToDestination(page);
    await expect(page.getByRole("link", { name: /owner's page/ })).toHaveCount(0);
    await shot("expired");

    /* ---- 3. Not live yet: 404 from the redirect, a start date on the page ---- */
    const soon = await create({ activatesAt: new Date(Date.now() + 3 * DAY).toISOString() });
    expect((await fetch(`${REDIRECT_URL}/${soon.slug}`, { redirect: "manual" })).status).toBe(404);
    await openPreview(page, soon.slug);
    await expect(page.getByRole("heading", { name: "This link isn't live yet" })).toBeVisible();
    await expect(page.getByText("Goes live", { exact: true })).toBeVisible();
    await noWayToDestination(page);
    await shot("scheduled");

    /* ---- 4. Archived: 410 ---- */
    const old = await create({});
    const archived = await fetch(`${API_URL}/links/${old.id}`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ archived: true }),
    });
    expect(archived.status, `PATCH archived → ${await archived.clone().text()}`).toBe(200);
    expect((await fetch(`${REDIRECT_URL}/${old.slug}`, { redirect: "manual" })).status).toBe(410);
    await openPreview(page, old.slug);
    await expect(page.getByRole("heading", { name: "This link is no longer active" })).toBeVisible();
    await noWayToDestination(page);
    await shot("archived");

    /* ---- 5. Live with a device rule: the page says it may vary, and Continue
            goes through the redirect, which applies the rule ---- */
    const routed = await create({ rules: [{ id: "r1", when: { device: "mobile" }, then: url("rule-mobile") }] });
    await openPreview(page, routed.slug);
    await expect(page.getByRole("heading", { name: /safe to open|couldn't fully verify/ })).toBeVisible();
    await expect(page.getByText(/some visitors are sent to a different page/)).toBeVisible();
    await shot("rules");
    const expected = testInfo.project.name === "mobile" ? url("rule-mobile") : url("dest");
    const followed = page.waitForRequest((r) => r.url() === expected);
    await page.getByRole("link", { name: `Continue to ${domain}/${routed.slug} →` }).click();
    await followed;
  });
});
