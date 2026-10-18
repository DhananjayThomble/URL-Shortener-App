/**
 * Journey 25 — Password-protected link with public previews turned off (#762)
 *
 * A workspace owner turns "Allow public link previews" off and shares a
 * password-protected link. A visitor follows it: the redirect bounces them to
 * the trust page with ?unlock=1, they type the password, and they land on the
 * destination through the redirect (so the click is recorded).
 *
 * Before #762 the page needed the preview to show the password form, and the
 * preview 403s with previews off, so the visitor got "That didn't load" and no
 * way through.
 *
 * Oracles:
 *   - packages/contract/src/public.ts — PublicLinkLock (not gated by previews,
 *     never the destination), UnlockLinkResult (token, never the URL)
 *   - apps/redirect/src/main.ts — protected link without a valid ?k= → 302 to
 *     /p/<slug>?unlock=1; with one → the destination
 *   - Invariant: no public response carries the destination before the right
 *     password (redirect bounce, preview 403, lock, wrong-password 401).
 *
 * Unlock is throttled to 5/min per client IP, so this journey spends exactly
 * two unlock attempts (one wrong, one right). Run each project in its own
 * invocation at least a minute apart.
 */

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, makeEmail, registerUser } from "./helpers";

test.describe("Journey 25 — previews off, password-protected link @mobile", () => {
  test("visitor unlocks a protected link while previews are off", async ({ page }, testInfo) => {
    /* ---- Setup: owner, previews off, protected link ---- */
    const session = await registerUser(makeEmail(`j25-${testInfo.project.name}`));
    const auth = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };

    const off = await fetch(`${API_URL}/workspaces/current`, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ publicPreviews: false }),
    });
    expect(off.status, "PATCH /workspaces/current publicPreviews=false").toBe(200);
    expect(((await off.json()) as { publicPreviews?: boolean }).publicPreviews).toBe(false);

    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth })).json()) as {
      defaultDomain?: string;
    };
    const marker = `j25-secret-${RUN_ID}-${randomBytes(3).toString("hex")}`;
    const destination = `https://example.com/${marker}`;
    const password = `pw-${randomBytes(6).toString("hex")}`;
    const slug = `j25-${randomBytes(4).toString("hex")}`;
    const created = await fetch(`${API_URL}/links`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ destination, domain: ws.defaultDomain ?? "localhost:3002", slug, password }),
    });
    expect(created.status, `POST /links → ${await created.clone().text()}`).toBe(201);
    expect(((await created.json()) as { passwordProtected?: boolean }).passwordProtected).toBe(true);

    /* ---- 1. The redirect bounces to the unlock page, without the destination ---- */
    const bounce = await fetch(`${REDIRECT_URL}/${slug}`, { redirect: "manual" });
    expect(bounce.status).toBe(302);
    const location = bounce.headers.get("location") ?? "";
    expect(location).toMatch(new RegExp(`/p/${slug}\\?unlock=1$`));
    expect(location + (await bounce.text())).not.toContain(marker);

    /* ---- 2. Every public response before the password withholds it ---- */
    const preview = await fetch(`${API_URL}/public/links/${slug}/preview`);
    expect(preview.status, "preview with previews off").toBe(403);
    expect(await preview.text()).not.toContain(marker);

    const lock = await fetch(`${API_URL}/public/links/${slug}/lock`);
    expect(lock.status).toBe(200);
    const lockText = await lock.text();
    expect(lockText).not.toContain(marker);
    expect(JSON.parse(lockText)).toEqual({ shortUrl: `${ws.defaultDomain}/${slug}`, passwordProtected: true });

    /* ---- 3. The visitor sees the password form (not "That didn't load") ---- */
    await page.goto(location.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByText("This link is password protected")).toBeVisible();
    await expect(page.getByText("That didn't load")).toHaveCount(0);
    expect(await page.content()).not.toContain(marker);
    await page.screenshot({ path: testInfo.outputPath(`j25-${testInfo.project.name}-form.png`), fullPage: true });

    /* ---- 4. A wrong password is refused on the page ---- */
    await page.getByPlaceholder("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Unlock and continue" }).click();
    await expect(page.getByText("That password isn't right.")).toBeVisible();
    expect(await page.content()).not.toContain(marker);
    await page.screenshot({ path: testInfo.outputPath(`j25-${testInfo.project.name}-wrong.png`), fullPage: true });

    /* ---- 5. The right password goes through the redirect to the destination ---- */
    // Stand in for example.com so the final hop is observable and offline.
    await page.route(`${destination}**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>destination reached</h1>" }),
    );
    const viaRedirect = page.waitForRequest((r) => r.url().startsWith(`${REDIRECT_URL}/${slug}?k=`));
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Unlock and continue" }).click();
    await viaRedirect;
    await page.waitForURL((u) => u.href.startsWith(destination));
    await expect(page.getByRole("heading", { name: "destination reached" })).toBeVisible();
  });
});
