/**
 * Journey 2 — Link lifecycle  @mobile
 *
 * Create a link, edit its destination, verify the redirect reflects the edit,
 * delete it, confirm it is gone from the list AND no longer redirects.
 *
 * Oracles:
 *   - packages/contract/src/link.ts — UpdateLinkInput, Link
 *   - Invariant: after PATCH /links/:id, redirect service uses new destination.
 *   - Invariant: after DELETE /links/:id, GET /links does not include the link.
 *   - Redirect service returns non-200 or a "not found" page after deletion.
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  registerUser,
  seedAccount,
  createLink,
  REDIRECT_URL,
  API_URL,
} from "./helpers";

const DEST_1 = "https://example.com/j2-original";
const DEST_2 = "https://example.com/j2-edited";

test.describe("Journey 2 — Link lifecycle", () => {
  test("create → edit destination → redirect changes → delete → gone @mobile", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j2"));
    await seedAccount(page, session);

    /* ---- 1. Create a link via the UI ---- */
    const slug = `j2-${Date.now().toString(36)}`;
    await page.goto("/links");
    await expect(page).toHaveURL(/\/links/);

    await page.getByRole("button", { name: /New link|Create a link/i }).first().click();
    const createDrawer = page.getByRole("dialog", { name: /create a link/i });
    await expect(createDrawer).toBeVisible();

    // Exact placeholders from create-link-drawer.tsx
    await createDrawer.getByPlaceholder("https://acme.com/collections/spring-2026").fill(DEST_1);
    await createDrawer.getByPlaceholder("spring-sale").fill(slug);
    await createDrawer.getByRole("button", { name: "Create link" }).click();
    await expect(createDrawer).toBeHidden({ timeout: 15_000 });

    /* ---- 2. Confirm the link appears in the list ---- */
    const copyBtn = page.getByRole("button", { name: new RegExp(`Copy short link .+/${slug}`) });
    await expect(copyBtn).toBeVisible({ timeout: 15_000 });

    /* ---- 3. Verify original redirect ---- */
    const shortUrl = `${REDIRECT_URL}/${slug}`;
    const r1 = await page.context().newPage();
    await r1.goto(shortUrl, { waitUntil: "commit", timeout: 15_000 });
    expect(r1.url()).toContain("j2-original");
    await r1.close();

    /* ---- 4. Open the link detail page and edit the destination ---- */
    // Get the link id from the API so we can navigate to /links/:id
    const listRes = await fetch(`${API_URL}/links?limit=50`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const listData = await listRes.json() as { items?: Array<{ id: string; slug: string }> };
    const foundLink = listData.items?.find((l) => l.slug === slug);
    expect(foundLink, "Link should appear in GET /links response").toBeTruthy();

    await page.goto(`/links/${foundLink!.id}`);

    // The detail page shows an "Edit" button that opens a destination input
    // From apps/api/src/... link detail page.tsx: placeholder="https://example.com/where-it-should-go"
    const editBtn = page.getByRole("button", { name: /Edit destination|Edit/i }).first();
    if (await editBtn.count() > 0) {
      await editBtn.click();
    }
    const destInput = page.getByPlaceholder("https://example.com/where-it-should-go");
    if (await destInput.count() > 0) {
      await destInput.clear();
      await destInput.fill(DEST_2);
      const saveBtn = page.getByRole("button", { name: /Save/i }).first();
      await saveBtn.click();
      await page.waitForTimeout(2000);
    } else {
      // Fall back to API PATCH
      const patchRes = await fetch(`${API_URL}/links/${foundLink!.id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ destination: DEST_2 }),
      });
      expect(patchRes.ok, "PATCH /links/:id should succeed").toBe(true);
    }

    /* ---- 5. Verify redirect now uses new destination ---- */
    // The redirect service has a short TTL cache (LINK_CACHE_TTL_SECONDS=10).
    // Wait for the cache to expire before testing the redirect.
    await page.waitForTimeout(12_000);
    const r2 = await page.context().newPage();
    await r2.goto(shortUrl, { waitUntil: "commit", timeout: 15_000 });
    expect(r2.url()).toContain("j2-edited");
    await r2.close();

    /* ---- 6. Delete the link via API ---- */
    const delRes = await fetch(`${API_URL}/links/${foundLink!.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(delRes.status, "DELETE /links/:id should return 204").toBe(204);

    // Wait for the redirect service's cache to expire (TTL=10s default)
    await page.waitForTimeout(12_000);

    /* ---- 7. Confirm deleted link is gone from the list ---- */
    await page.goto("/links");
    // Re-check the API
    const list2Res = await fetch(`${API_URL}/links?limit=50`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    const list2Data = await list2Res.json() as { items?: Array<{ id: string; slug: string }> };
    const stillExists = list2Data.items?.find((l) => l.slug === slug);
    expect(stillExists, "Deleted link should not appear in GET /links").toBeFalsy();

    // Also confirm on the page
    const slugCopyBtn = page.getByRole("button", { name: new RegExp(`Copy short link .+/${slug}`) });
    await expect(slugCopyBtn).toHaveCount(0, { timeout: 10_000 });

    /* ---- 8. Confirm the redirect no longer goes to the destination ---- */
    const r3 = await page.context().newPage();
    try {
      await r3.goto(shortUrl, { waitUntil: "commit", timeout: 10_000 });
    } catch {
      // Navigation error is acceptable — link is gone
    }
    // Must NOT land on j2-edited
    expect(r3.url()).not.toContain("j2-edited");
    await r3.close();
  });
});
