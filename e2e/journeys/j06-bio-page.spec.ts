/**
 * Journey 6 — Bio page
 *
 * Create a bio page with a name, publish it, and verify it is live.
 *
 * Oracles:
 *   - packages/contract — UpsertBioPageInput
 *   - bio/page.tsx: placeholder "yourname" / "Acme Growth", button "Create as draft" / "Publish"
 *   - Invariant: a live bio page shows status "live" in the API.
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

    /* ---- 9. Check public route ---- */
    // Bio pages may be served at /b/<slug> or another route in the web app.
    // We probe and record what happens — no assertion that it MUST be served
    // (the public bio route depends on hosting config).
    const bioPaths = [`/b/${slug}`, `/bio/${slug}`];
    for (const path of bioPaths) {
      const resp = await page.request.get(path, { maxRedirects: 3 });
      if (resp.status() === 200) {
        const body = await resp.text();
        // Oracle: the page must contain the bio page display name
        expect(body).toContain("J6 Journey Bio");
        break;
      } else {
        console.log(
          `[FINDING] J6: GET ${path} → ${resp.status()}. ` +
          `Public bio page not served at this path in the Next.js build.`,
        );
      }
    }
  });
});
