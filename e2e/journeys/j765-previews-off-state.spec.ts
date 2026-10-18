/**
 * Journey 765 — the "+" page of a link whose owner turned public previews off.
 *
 * QA saw "That didn't load" + Try again (or an empty card with the footer
 * "Anyone can see this page by adding +…") for a link with NO password whose
 * preview the owner had switched off. Retrying cannot help; the page should say
 * previews are off and offer a way on THROUGH the redirect (so the click is
 * counted), never revealing where the link goes.
 *
 * The visitor's way in is the real one: "<short>+" bounces (302) to
 * /p/<slug>?host=…, and the page asks the real API.
 *
 * Oracles:
 *   - apps/api PublicService.preview — 403 with code `previews_off` when the
 *     workspace switch OR the link's own `publicPreview` is off
 *   - packages/contract/src/public.ts — PublicLinkLock (short URL + whether a
 *     password guards it; never the destination)
 *   - apps/redirect/src/main.ts — "<short>+" → /p/<slug>?host=…; the short link
 *     itself → 302 to the destination
 *   - Invariant: no public response or page carries the destination while
 *     previews are off.
 */

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { API_URL, REDIRECT_URL, RUN_ID, makeEmail, registerUser } from "./helpers";

test.describe("Journey 765 — previews off, link without a password @mobile", () => {
  test("the + page says previews are off, continues through the redirect, and recovers when previews are back on", async ({
    page,
  }, testInfo) => {
    /* ---- Setup: owner, previews off, two plain links ---- */
    const session = await registerUser(makeEmail(`j765-${testInfo.project.name}`));
    const auth = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };
    const setPreviews = async (publicPreviews: boolean) => {
      const res = await fetch(`${API_URL}/workspaces/current`, {
        method: "PATCH",
        headers: auth,
        body: JSON.stringify({ publicPreviews }),
      });
      expect(res.status, `PATCH /workspaces/current publicPreviews=${publicPreviews}`).toBe(200);
    };
    await setPreviews(false);

    const ws = (await (await fetch(`${API_URL}/workspaces/current`, { headers: auth })).json()) as {
      defaultDomain?: string;
    };
    const domain = ws.defaultDomain ?? "localhost:3002";
    const marker = `j765-secret-${RUN_ID}-${randomBytes(3).toString("hex")}`;
    const destination = `https://example.com/${marker}`;
    const slug = `j765-${randomBytes(4).toString("hex")}`;
    const created = await fetch(`${API_URL}/links`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ destination, domain, slug }),
    });
    expect(created.status, `POST /links → ${await created.clone().text()}`).toBe(201);
    expect(((await created.json()) as { passwordProtected?: boolean }).passwordProtected).toBe(false);

    // example.com stands in for the owner's page; nothing leaves the machine.
    await page.route("https://example.com/**", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: "<p>landed</p>" }),
    );

    /* ---- 1. The visitor's way in: "<short>+" bounces to the trust page ---- */
    const bounce = await fetch(`${REDIRECT_URL}/${slug}+`, { redirect: "manual" });
    expect(bounce.status).toBe(302);
    const location = bounce.headers.get("location") ?? "";
    expect(location).toContain(`/p/${slug}`);
    expect(location + (await bounce.text())).not.toContain(marker);
    const host = new URL(location).searchParams.get("host") ?? "";
    expect(host, "the bounce carries the resolved host").toBeTruthy();

    /* ---- 2. Every public response withholds the destination; the 403 is
            tagged so the page can tell it from any other 403 ---- */
    const q = `?host=${encodeURIComponent(host)}`;
    const preview = await fetch(`${API_URL}/public/links/${slug}/preview${q}`);
    expect(preview.status, "preview with previews off").toBe(403);
    const previewText = await preview.text();
    expect(previewText).not.toContain(marker);
    expect(JSON.parse(previewText)).toMatchObject({ statusCode: 403, code: "previews_off" });
    const lock = await fetch(`${API_URL}/public/links/${slug}/lock${q}`);
    expect(lock.status).toBe(200);
    const lockText = await lock.text();
    expect(lockText).not.toContain(marker);
    expect(JSON.parse(lockText)).toEqual({ shortUrl: `${domain}/${slug}`, passwordProtected: false });

    /* ---- 3. The page: a deliberate state, not an error ---- */
    await page.goto(location.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toBeVisible();
    await expect(page.getByText(`${domain}/${slug}`, { exact: true })).toBeVisible();
    await expect(page.getByText("That didn't load")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
    await expect(page.getByText("Created by")).toHaveCount(0);
    await expect(page.getByText(/Anyone can see this page/)).toHaveCount(0);
    expect(await page.content()).not.toContain(marker);
    await page.screenshot({ path: testInfo.outputPath(`j765-${testInfo.project.name}-off.png`), fullPage: true });

    /* ---- 4. Continue goes through the short link, then to the destination ---- */
    const cont = page.getByRole("link", { name: `Continue to ${domain}/${slug} →` });
    const href = (await cont.getAttribute("href")) ?? "";
    expect(href).not.toContain(marker);
    expect(new URL(href).pathname).toBe(`/${slug}`);
    const requested: string[] = [];
    page.on("request", (r) => requested.push(r.url()));
    const reached = page.waitForRequest((r) => r.url() === destination);
    await cont.click();
    await reached;
    const viaShortLink = requested.findIndex((u) => u === href);
    expect(viaShortLink, `Continue goes through the short link: ${requested.join(" , ")}`).toBeGreaterThanOrEqual(0);
    expect(requested.indexOf(destination)).toBeGreaterThan(viaShortLink);

    /* ---- 5. Previews back on: a fresh visit shows the real preview again
            (no stale previews-off state after the mutation) ---- */
    await setPreviews(true);
    await page.goto(location.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByText("Created by")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toHaveCount(0);
    await expect(page.getByText(/Anyone can see this page/)).toBeVisible();

    /* ---- 6. A link that opts out itself, while the workspace allows previews,
            is the same state ---- */
    const optOutSlug = `j765-oo-${randomBytes(3).toString("hex")}`;
    const optOut = await fetch(`${API_URL}/links`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ destination, domain, slug: optOutSlug, publicPreview: false }),
    });
    expect(optOut.status, `POST /links → ${await optOut.clone().text()}`).toBe(201);
    await page.goto(`/p/${optOutSlug}?host=${encodeURIComponent(host)}`);
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toBeVisible();
    expect(await page.content()).not.toContain(marker);
    await page.screenshot({ path: testInfo.outputPath(`j765-${testInfo.project.name}-optout.png`), fullPage: true });
  });
});
