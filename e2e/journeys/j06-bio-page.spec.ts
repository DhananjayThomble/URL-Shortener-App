/**
 * Journey 6 — Bio page
 *
 * Create a bio page with a name, publish it, and verify it is live — then
 * confirm a signed-out visitor can load it at /public/bio-pages/:slug and /b/<slug>.
 *
 * Oracles:
 *   - packages/contract — UpsertBioPageInput, PublicBioPage
 *   - bio/page.tsx: placeholder "yourname" / "Acme Growth", button "Create as draft" / "Publish"
 *   - PublicController GET /public/bio-pages/:slug serves a live page unauthenticated (#457)
 *   - Invariant: a live bio page shows status "live" in the API, is reachable
 *     without auth, and its public shape never leaks workspace view/click analytics.
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  registerUser,
  seedAccount,
  API_URL,
  RUN_ID,
} from "./helpers";

test.describe("Journey 6 — Bio page", () => {
  test("create a bio page as draft, publish it, verify live in API", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j6"));
    await seedAccount(page, session);

    /* ---- 1. Navigate to bio page ---- */
    await page.goto("/bio");
    await expect(page).toHaveURL(/\/bio/);

    /* ---- 2. Open the create form ---- */
    // Exact button text from bio/page.tsx line 104
    await page.getByRole("button", { name: "＋ New page" }).click();

    /* ---- 3. Fill in the slug (Back-half) and display name ---- */
    // Exact placeholders from bio/page.tsx lines 137, 145
    const slug = `j6bio${RUN_ID.replace(/[^a-z0-9]/gi, "")}`.slice(0, 20).toLowerCase();

    await page.getByPlaceholder("yourname").fill(slug);
    await page.getByPlaceholder("Acme Growth").fill("J6 Journey Bio");

    /* ---- 4. Create as draft ---- */
    // Exact button text from bio/page.tsx line 152
    await page.getByRole("button", { name: "Create as draft" }).click();

    /* ---- 5. Confirm in the list as Draft ---- */
    const newRow = page.getByRole("row", { name: new RegExp(`/${slug}`) });
    await expect(newRow).toBeVisible({ timeout: 15_000 });
    await expect(newRow.getByText("Draft")).toBeVisible();

    /* ---- 5b. Add a link block in the editor ---- */
    // The editor used to be a static mock: "＋ Add block" had no handler and
    // a block could not be given a URL, so a published page had nothing to
    // click. Oracle: UpsertBioPageInput.blocks[].href (packages/contract).
    await page.getByRole("button", { name: "＋ Add block" }).click();
    await page.getByRole("button", { name: /Link$/ }).click();
    await page.getByLabel("Title", { exact: true }).fill("J6 destination");
    await page.getByLabel("URL", { exact: true }).fill("https://example.com/j6");

    /* ---- 6. Publish it ---- */
    // bio/page.tsx line 244: "Publish" when draft
    const publishBtn = page.getByRole("button", { name: "Publish" });
    await expect(publishBtn).toBeVisible();
    await publishBtn.click();

    /* ---- 7. Status flips to Live in the row ---- */
    await expect(newRow.getByText("Live")).toBeVisible({ timeout: 15_000 });
    // The editor's toggle is now "Unpublish"
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();

    /* ---- 8. Verify via API ---- */
    const bioRes = await fetch(`${API_URL}/bio-pages`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    type ApiBioPage = {
      id: string;
      slug: string;
      status: string;
      views: number;
      blocks: Array<{ id: string; title: string; href?: string | null; metric?: string | null }>;
    };
    const bioPages = await bioRes.json() as ApiBioPage[];
    const bioPage = bioPages.find((p) => p.slug === slug);
    expect(bioPage, "Created bio page should appear in API response").toBeTruthy();
    expect(bioPage?.status, "Bio page should be live after publish").toBe("live");
    // Publishing saves the editor's draft, block and href included.
    expect(bioPage?.blocks.map((b) => [b.title, b.href])).toEqual([["J6 destination", "https://example.com/j6"]]);

    /* ---- 9. Public route serves the published page to a signed-out visitor ---- */
    // #457: a published bio page must be reachable without auth, both at the
    // API (@Public() GET /public/bio-pages/:slug) and at the web route /b/<slug>.
    // Before #457 this step only probed and recorded a finding; now the route
    // exists, so it asserts.

    // 9a. The @Public() API endpoint, called with NO Authorization header.
    const publicApiRes = await fetch(`${API_URL}/public/bio-pages/${slug}`);
    expect(publicApiRes.ok, "GET /public/bio-pages/:slug should serve a live page anonymously").toBe(true);
    const publicPage = (await publicApiRes.json()) as {
      slug: string;
      profile: { name: string };
      views?: unknown;
      clickThrough?: unknown;
    };
    // Oracle: PublicBioPage in packages/contract — profile.name is the display name.
    expect(publicPage.profile.name, "Public API returns the page's display name").toBe("J6 Journey Bio");
    // Oracle: PublicBioPage does not declare workspace analytics — they must not leak.
    expect(publicPage.views, "Public shape must not leak view count").toBeUndefined();
    expect(publicPage.clickThrough, "Public shape must not leak click-through").toBeUndefined();

    // 9b. The web route renders it for a signed-out visitor. Use a fresh,
    // unauthenticated context so no token from seedAccount leaks in.
    const anon = await page.context().browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/b/${slug}`, { waitUntil: "networkidle", timeout: 15_000 });
    await expect(anonPage.getByText("J6 Journey Bio")).toBeVisible({ timeout: 10_000 });

    // The block is a real link to its destination. Clicking it is counted
    // (keepalive POST) before the browser leaves; stub the destination so the
    // test does not depend on the internet.
    await anonPage.route("https://example.com/**", (route) => route.fulfill({ body: "ok" }));
    const link = anonPage.getByRole("link", { name: "J6 destination" });
    await expect(link).toHaveAttribute("href", "https://example.com/j6");
    // Wait on the request, not its response: the page navigates away in the
    // same instant, and the keepalive response is not reported to the page
    // it left. Step 10 checks that it actually landed.
    const clickSent = anonPage.waitForRequest((r) => r.method() === "POST" && /\/blocks\/[^/]+\/click$/.test(r.url()));
    await link.click();
    await clickSent;
    await anonPage.waitForURL("https://example.com/j6");
    await anon.close();

    /* ---- 10. The workspace sees the view and the click ---- */
    // Invariant: one visit is one view; one click on a block is one click on
    // that block. Only counters — the public shape still carries neither.
    await expect
      .poll(async () => {
        const res = await fetch(`${API_URL}/bio-pages`, { headers: { authorization: `Bearer ${session.accessToken}` } });
        const p = ((await res.json()) as ApiBioPage[]).find((x) => x.slug === slug);
        return [p?.views, p?.blocks[0]?.metric];
      })
      .toEqual([1, "1 click"]);
  });
});
