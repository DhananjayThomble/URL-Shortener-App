/**
 * Journey 849 — the per-domain bio route with a percent-encoded domain
 *
 * Next 15.5 hands catch-all segments back still percent-encoded, so
 * /b/localhost%3A3002/<slug> used to be encoded a second time on its way to the
 * API ("localhost%253A3002") and answered 404 for a page that exists. Any
 * domain carrying a port hit it (the staging/local system domain is
 * localhost:3002).
 *
 * Oracles:
 *   - GET /public/bio-pages/by-domain/:domain/:slug serves the page when the
 *     domain is encoded ONCE (observed, and asserted below against the API).
 *   - A page that does not exist, and an address that is not decodable, are a
 *     real HTTP 404 — never a 500.
 */

import { expect, test } from "@playwright/test";
import { API_URL, RUN_ID, makeEmail, registerUser } from "./helpers";

const NAME = "J849 Encoded Domain";

test.describe("Journey 849 — /b/<encoded-domain>/<slug>", () => {
  test("renders for a percent-encoded domain; unknown and undecodable addresses 404 @mobile", async ({ browser }, testInfo) => {
    /* ---- Setup: a published page on the workspace's default domain ---- */
    const session = await registerUser(makeEmail("j849"));
    const auth = { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };

    const wsRes = await fetch(`${API_URL}/workspaces/current`, { headers: auth });
    expect(wsRes.ok).toBe(true);
    const domain = ((await wsRes.json()) as { defaultDomain?: string }).defaultDomain ?? "";
    expect(domain, "the workspace has a default domain").not.toBe("");

    const slug = `j849-${RUN_ID.replace(/[^a-z0-9]/gi, "").toLowerCase()}`.slice(0, 24);
    const saved = await fetch(`${API_URL}/bio-pages`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        domain,
        slug,
        status: "live",
        profile: { name: NAME, bio: "" },
        blocks: [{ kind: "link", title: "J849 destination", subtitle: null, locked: false, href: "https://example.com/j849" }],
      }),
    });
    expect(saved.ok, `PUT /bio-pages should publish the page (got ${saved.status})`).toBe(true);

    // Anchor: the API itself serves it with the domain encoded once.
    const api = await fetch(`${API_URL}/public/bio-pages/by-domain/${encodeURIComponent(domain)}/${slug}`);
    expect(api.ok, "the API serves the page at the once-encoded address").toBe(true);

    const ctx = await browser.newContext(testInfo.project.use);
    const page = await ctx.newPage();
    try {
      /* ---- 1. The encoded domain renders — and is probed/fetched ONCE-encoded ---- */
      const apiPaths: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/public/bio-pages/")) apiPaths.push(new URL(r.url()).pathname);
      });
      const resp = await page.goto(`/b/${encodeURIComponent(domain)}/${slug}`, { waitUntil: "networkidle" });
      expect(resp?.status(), "an encoded domain is a real page, not a 404").toBe(200);
      await expect(page.getByText(NAME)).toBeVisible();
      await expect(page.getByRole("link", { name: "J849 destination" })).toBeVisible();
      expect(apiPaths.length, "the client fetched the page from the API").toBeGreaterThan(0);
      for (const p of apiPaths) {
        expect(p, `no API call double-encodes the domain (${p})`).not.toMatch(/%25/);
      }
      await page.screenshot({
        path: testInfo.outputPath(`encoded-domain-${testInfo.project.name}.png`),
        fullPage: false,
      });

      /* ---- 2. Decoded exactly once: an encoded slug character resolves too ---- */
      // "-" -> %2D. Decoding twice would turn nothing here, but decoding zero
      // times would look up "j849%2D…" and 404.
      const encodedSlug = slug.replace(/-/g, "%2D");
      expect(encodedSlug).not.toBe(slug);
      const alias = await page.goto(`/b/${encodeURIComponent(domain)}/${encodedSlug}`, { waitUntil: "domcontentloaded" });
      expect(alias?.status(), "an encoded back-half resolves to the same page").toBe(200);

      /* ---- 3. A literal colon (browsers send it unencoded) still works ---- */
      const literal = await page.goto(`/b/${domain}/${slug}`, { waitUntil: "domcontentloaded" });
      expect(literal?.status(), "an unencoded domain is unaffected").toBe(200);

      /* ---- 4. A page that does not exist is still a real 404 ---- */
      const missing = await page.goto(`/b/${encodeURIComponent(domain)}/no-such-page-${RUN_ID}`, { waitUntil: "domcontentloaded" });
      expect(missing?.status(), "an unknown back-half on an encoded domain is 404").toBe(404);

      /* ---- 5. An undecodable address is a client error, never a 500 ---- */
      // Next's own router rejects a malformed escape with 400 before the page
      // runs, so the page-level "malformed -> notFound()" guard is defence in
      // depth (unit-tested in route-segments.test.ts). What must never happen
      // is a 5xx, or a 200 shell for an address that is not decodable.
      for (const bad of [`/b/${encodeURIComponent(domain)}/%E0%A4%A`, "/b/%/x", `/b/%zz`, `/b/${encodeURIComponent(domain)}/${slug}%`]) {
        const r = await page.goto(bad, { waitUntil: "domcontentloaded" });
        expect([400, 404], `${bad} is a client error, not a server error (got ${r?.status()})`).toContain(r?.status());
      }
    } finally {
      await ctx.close();
    }
  });

  test("the public form route does not double-encode its slug @mobile", async ({ browser }, testInfo) => {
    // /f/<slug> reads the segment with useParams, which is still percent-encoded
    // too. "café" must reach the API as caf%C3%A9 (encoded once), not caf%25C3%25A9.
    const ctx = await browser.newContext(testInfo.project.use);
    const page = await ctx.newPage();
    try {
      const seen: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/public/forms/")) seen.push(new URL(r.url()).pathname);
      });
      const resp = await page.goto("/f/caf%C3%A9", { waitUntil: "networkidle" });
      expect(resp?.status(), "a form address that does not exist renders the in-page empty state").toBeLessThan(500);
      await expect(page.getByRole("heading", { name: "There's no form here" })).toBeVisible();
      expect(seen.length).toBeGreaterThan(0);
      for (const p of seen) {
        expect(p, "the form slug is encoded exactly once").toMatch(/\/public\/forms\/caf%C3%A9$/);
      }

      // A malformed escape never reaches the page (Next answers 400): not a crash.
      const bad = await page.goto("/f/%E0%A4%A", { waitUntil: "domcontentloaded" });
      expect([400, 404], `an undecodable form address is a client error (got ${bad?.status()})`).toContain(bad?.status());
    } finally {
      await ctx.close();
    }
  });
});
