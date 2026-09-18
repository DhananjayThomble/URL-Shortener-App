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
    const bioPages = await bioRes.json() as Array<{
      id: string;
      slug: string;
      status: string;
    }>;
    const bioPage = bioPages.find((p) => p.slug === slug);
    expect(bioPage, "Created bio page should appear in API response").toBeTruthy();
    expect(bioPage?.status, "Bio page should be live after publish").toBe("live");

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
    await anon.close();
  });
});
