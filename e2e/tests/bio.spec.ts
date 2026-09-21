import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the bio / link-in-bio page (/(app)/bio). An authenticated user
   creates a new bio page as a draft, sees it in their pages list, then publishes
   it and watches the status flip Draft -> Live. Bio pages are the product's
   "one link that holds all the others" feature; create + publish are the two
   real fixtures mutations (PUT /bio-pages keyed on domain+slug — a create and a
   status change are both an upsert), so the flow is deterministic against the
   in-memory fake.

   Fixtures mode (no API/DB). Accessible-name selectors only (getByRole /
   getByLabel) — Field associates its <label> with the real control (see #469),
   so inputs are addressed by label text. Semantic Table/Th/Td render a real
   table, so a page's row is located by its accessible name (concatenated cell
   text). One flow per file. */

test.describe("bio pages", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("create a bio page as a draft, see it listed, then publish it", async ({ page }) => {
    // A unique back-half per run so the new row cannot collide with a seeded
    // fixture page (acme / priya / events / spring-hub).
    const slug = `e2e-bio-${Date.now().toString(36)}`;
    const name = "E2E Growth";

    // Full load (also the fixtures reset) lands on the bio page.
    await page.goto("/bio");
    await expect(page).toHaveURL(/\/bio$/);

    // Open the create form. The primary action toggles between "New page" and
    // "Cancel"; match the create label.
    await page.getByRole("button", { name: "＋ New page" }).click();

    // Fill the draft. Domain has a sensible default (first workspace domain), so
    // only the back-half and display name need values.
    await page.getByLabel("Back-half").fill(slug);
    await page.getByLabel("Display name").fill(name);

    // Create as a draft. Fixtures unshift the new page to the top of the store.
    await page.getByRole("button", { name: "Create as draft" }).click();

    // The new page shows in the "Your pages" table. Its row's accessible name
    // includes the mono "<domain>/<slug>" cell and its per-row action buttons.
    const newRow = page.getByRole("row", { name: new RegExp(`/${slug}\\b`) });
    await expect(newRow).toBeVisible();
    // It was created as a draft.
    await expect(newRow.getByText("Draft")).toBeVisible();

    // Because the create unshifts to index 0 and the editor renders pages[0],
    // the editor pane now targets the new page — its Publish button is present.
    // Publish it: the button reads "Publish" for a draft, "Unpublish" once live.
    const publish = page.getByRole("button", { name: "Publish" });
    await expect(publish).toBeVisible();
    await publish.click();

    // Fixtures upsert flips status to live; the row's chip and the editor button
    // both reflect it. Assert on the row (list is the source of truth) and that
    // the editor's toggle is now "Unpublish".
    await expect(newRow.getByText("Live")).toBeVisible();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("cannot create a bio page without a back-half", async ({ page }) => {
    await page.goto("/bio");
    await expect(page).toHaveURL(/\/bio$/);

    // Wait for the pages table to finish loading (it renders a skeleton first),
    // then capture the row count so the "no page added" assertion is deterministic
    // rather than racing the initial fetch.
    const seededRow = page.getByRole("row", { name: /\/acme\b/ });
    await expect(seededRow).toBeVisible();
    const rowsBefore = await page.getByRole("row").count();

    await page.getByRole("button", { name: "＋ New page" }).click();

    // Fill only the display name, leaving the back-half empty. The page's own
    // guard rejects this client-side before any API call.
    await page.getByLabel("Display name").fill("No Slug");
    await page.getByRole("button", { name: "Create as draft" }).click();

    // The validation message is shown and no page was added.
    await expect(
      page.getByText("A page needs a domain, a back-half and a display name."),
    ).toBeVisible();
    expect(await page.getByRole("row").count()).toBe(rowsBefore);
  });

  /* Regression for #497 item 1, added per PR #500 review: the phone-preview
     footer ("Powered by SnapURL") composited text-ink-3 with opacity-70 down
     to an effective 2.85:1 — an axe-core `serious` color-contrast violation
     (WCAG 2.2 AA SC 1.4.3). globals-contrast.test.ts's static source-regex
     catches the literal `opacity-70` string but not equivalent evasions that
     produce the identical composite (`opacity-[0.7]`, or the color-alpha
     modifier `text-ink-3/70`) — both leave the class list looking fine to a
     text match while still failing the property that actually matters:
     rendered contrast. Asserting on axe's own color-contrast rule instead
     catches the composite regardless of which Tailwind utility produced it,
     and also covers a parent-element opacity, which a scan of this one div's
     class list never could. Light theme only: dark still carries #462's two
     unrelated white-on-saturated-tone nodes, so this scopes to the caption's
     rule rather than the whole page. */
  test("phone-preview 'Powered by SnapURL' caption has no color-contrast violation", async ({ page }) => {
    await page.goto("/bio");
    await expect(page.getByText("Powered by SnapURL")).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const captionViolations = results.violations
      .flatMap((v) => v.nodes)
      .filter((n) => n.html.includes("Powered by SnapURL"));
    expect(captionViolations, JSON.stringify(captionViolations, null, 2)).toEqual([]);
  });

  /* Regression for #497 item 2 (acceptance criterion: "Full-ruleset axe-core
     pass on light theme /bio shows 0 color-contrast violations"). Unlike the
     test above, this runs the full color-contrast rule with no per-node
     filter, so it also catches the wash-token/text-token pairs measured in
     the issue (wash-green, wash-teal, accent-wash, wash-amber all fell
     below 4.5:1 on at least one surface before the globals.css token fix)
     if any of them render on this route. Light theme only -- dark theme's
     now-fixed #462 family (bg-violet/bg-teal/bg-accent/bg-amber/bg-good
     with a literal text-white) is covered by globals-contrast.test.ts's own
     dark-theme assertions, not here. */
  test("light theme /bio has zero color-contrast violations under the full axe ruleset", async ({ page }) => {
    await page.goto("/bio");
    await expect(page.getByText("Powered by SnapURL")).toBeVisible();

    const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
