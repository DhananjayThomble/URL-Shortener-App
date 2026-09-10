import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the operator-side abuse-report queue (#291, FEAT-003) at
   /(app)/reports. This surface is a REVIEW QUEUE, not a report generator — an
   editor sees reports filed against their workspace's links and moves each one
   through its status (Reviewed / Dismiss) or flags the underlying link.

   Fixtures (web/src/lib/api/fixtures.ts) seed exactly two reports:
     • /spring-sale — status "open",     linkId lnk_spring  (flaggable)
     • /app         — status "reviewed", linkId lnk_app      (flaggable)
   The PATCH /reports/:id handler mutates the report in place and the mutation
   invalidates the query, so the row's status Chip re-renders. Flagging defaults
   the report to "actioned" when no explicit status is sent.

   Selectors are accessible names only (getByRole with the per-row aria-labels
   the action buttons carry, plus row-scoped getByText for the status Chip). No
   CSS, no data-testid.

   Collision note: the status Chip words "Reviewed" and "Dismiss(ed)" partly
   overlap the visible action-button labels ("Reviewed", "Dismiss"), and a Chip
   is a <span> while the action is a <button> — but selectors here stay
   role-agnostic, so status assertions use only the status words that NO button
   uses: "Open", "Dismissed", and "Actioned" are unique on the page (buttons say
   "Dismiss", not "Dismissed"; "Flag link", not "Actioned"). Those uniquely
   identify the chip. Reports is authenticated /(app), so we seedSession. */

/** The <tr> for a report, located by its unique "/<slug>" mono cell. */
function reportRow(page: import("@playwright/test").Page, slug: string) {
  return page.getByRole("row").filter({ has: page.getByText(`/${slug}`, { exact: true }) });
}

test.describe("abuse-report queue", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an operator reviews an open report and then flags its link", async ({ page }) => {
    // Full load (also the fixture reset) — lands on the queue, not the login route.
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports$/);

    // The queue renders both seeded reports (unique mono slug cells) and is not
    // in the empty/error state.
    const springRow = reportRow(page, "spring-sale");
    await expect(springRow).toBeVisible();
    await expect(reportRow(page, "app")).toBeVisible();
    await expect(page.getByText("No reports")).toHaveCount(0);

    // The open report starts with an "Open" status Chip in its own row ("Open" is
    // unique — no action button uses that word).
    await expect(springRow.getByText("Open", { exact: true })).toBeVisible();

    // Act on the open report: mark it reviewed. The button's accessible name (its
    // aria-label) embeds the slug, so it targets exactly this row.
    await page.getByRole("button", { name: "Mark report on /spring-sale reviewed" }).click();

    // The mutation invalidates the query and the /spring-sale row leaves "Open".
    await expect(springRow.getByText("Open", { exact: true })).toHaveCount(0);

    // Now flag the underlying link for that report. Fixtures default a flag with
    // no explicit status to "actioned" — a status word no button uses, so it
    // unambiguously identifies the chip and confirms the full review→flag path.
    await page.getByRole("button", { name: "Flag the link for report on /spring-sale" }).click();
    await expect(springRow.getByText("Actioned", { exact: true })).toBeVisible();
  });

  test("dismissing a report sets it Dismissed without flagging (no Actioned side effect)", async ({ page }) => {
    // Negative/validation: Dismiss sends an explicit status and NO flagLink, so
    // the fixtures must NOT default the report to "actioned" nor archive a link.
    // This guards the branch where willFlag is false and body.status wins.
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports$/);

    const appRow = reportRow(page, "app");
    // Preconditions: the /app report is present and nothing is actioned yet.
    await expect(appRow).toBeVisible();
    await expect(page.getByText("Actioned", { exact: true })).toHaveCount(0);

    // Dismiss the /app report (its per-row Dismiss button names the slug).
    await page.getByRole("button", { name: "Dismiss report on /app" }).click();

    // Its row chip becomes "Dismissed" (unique word — no button uses it) — and
    // crucially never becomes "Actioned", proving Dismiss did not fall through to
    // the flag branch anywhere on the page.
    await expect(appRow.getByText("Dismissed", { exact: true })).toBeVisible();
    await expect(page.getByText("Actioned", { exact: true })).toHaveCount(0);
  });
});
