import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Regression for #640: the create-link drawer kept showing a server error
   from a previous failed submission even after the user edited the form to
   fix it, so a stale message ("…/<slug> is already taken…") sat alongside —
   or in place of — the message that actually describes the current input.

   Oracle (from the issue's "Expected" and `docs/BACKEND.md`'s shape for a
   mutation's error state): an error message must describe the *current*
   input. A server error from a previous submission must be cleared the
   moment the user edits the form or resubmits, not persist indefinitely.

   Repro follows the issue body exactly: submit with a back-half that already
   exists (409 "already taken"), then change the back-half to a free one.
   The old message must be gone. Runs against fixtures mode, which now
   simulates the same 409 the real API returns for a slug collision (added in
   this PR so this spec does not require the real stack per qa-oracles.md
   §5 — this is a pure client-state assertion, independent of backend
   validation logic). */

test.describe("create-link drawer clears a stale server error", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("editing the back-half after a 409 removes the old error message", async ({ page }) => {
    await page.goto("/links");
    await expect(page).toHaveURL(/\/links$/);

    await page
      .getByRole("button", { name: /New link|Create a link/ })
      .first()
      .click();
    const drawer = page.getByRole("dialog", { name: "Create a link" });
    await expect(drawer).toBeVisible();

    // "spring-sale" is seeded on snap.to in src/lib/api/fixtures.ts — colliding
    // with it reproduces the server's 409 without needing a prior create.
    await drawer.getByLabel("Destination URL").fill("https://example.com/collision");
    await drawer.getByLabel("Short link").fill("spring-sale");
    await drawer.getByRole("button", { name: "Create link" }).click();

    const staleError = drawer.getByText(/spring-sale is already taken/i);
    await expect(staleError).toBeVisible();

    // Fix the back-half to a free one. The old 409 message must disappear —
    // nothing has been resubmitted yet, so there is no new server error to
    // replace it with; the drawer should fall back to its neutral copy.
    const slug = `e2e-${Date.now().toString(36)}`;
    await drawer.getByLabel("Short link").fill(slug);

    await expect(staleError).toBeHidden();
    await expect(drawer.getByText(/already taken/i)).toHaveCount(0);
  });
});
