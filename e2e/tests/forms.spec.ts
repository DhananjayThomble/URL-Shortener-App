import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: an authenticated user opens /forms, sees their forms listed,
   and expands a form's responses to read the response table and reach the CSV
   export. The Forms surface is read-only in the dashboard — creating, editing
   or deleting a form is not exposed in the UI; the page only lists forms and
   renders each one's responses — so the "primary journey" here is
   view -> expand -> read.

   Builds on the #353 harness: fixtures mode (no API/DB), accessible-name
   selectors only (getByRole / getByText — no CSS, no data-testid), seedSession
   before the first nav (Forms is an authenticated /(app) route), and a full
   page load per test to reset fixture state.

   Seeded forms (web/src/lib/api/fixtures.ts): "Spring launch feedback"
   (frm_feedback, live; declares name/email/plan/notes) and "Beta waitlist"
   (frm_beta, draft; declares only email). The responses endpoint returns the
   same three seeded responses for either form, and the response columns are the
   UNION of that form's declared fields and every key any response carries — so
   an answer whose key the form does NOT declare still gets a column, rendered
   as "<key> (removed)". Because the two forms declare different fields, the same
   responses render different "(removed)" columns: that field-relative union rule
   is the non-trivial behaviour the two tests contrast.

   Selector notes: the list is a semantic <table>, so getByRole("row", { name })
   matches a row by its concatenated cell text (including its "Responses" toggle
   button label). The per-row toggle is scoped to its row so it stays
   unambiguous while both rows are present. */

test.describe("forms — list and responses", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("an authenticated user can open a form's responses and read the response table", async ({ page }) => {
    await page.goto("/forms");
    await expect(page).toHaveURL(/\/forms$/);

    // Both seeded forms are listed. Match each by its own row so an assertion is
    // not accidentally satisfied by an unrelated cell elsewhere on the page.
    const feedbackRow = page.getByRole("row", { name: /Spring launch feedback/ });
    await expect(feedbackRow).toBeVisible();
    await expect(feedbackRow.getByText("/f/spring-feedback")).toBeVisible();
    await expect(page.getByRole("row", { name: /Beta waitlist/ })).toBeVisible();

    // Expand this form's responses via its row-scoped toggle (labelled
    // "Responses"; it flips to "Hide" once open).
    await feedbackRow.getByRole("button", { name: "Responses" }).click();

    // The responses panel names the form it belongs to.
    await expect(page.getByText("Responses — Spring launch feedback")).toBeVisible();

    // A seeded answer is rendered in the table body. This form declares "name",
    // so it is a normal column.
    await expect(page.getByRole("cell", { name: "Ada Lovelace" })).toBeVisible();

    // Union-of-keys rule: a seeded response carries a "phone" answer for a field
    // this form does NOT declare, so the table adds a "phone (removed)" column
    // header rather than dropping the answer. This is the defining behaviour of
    // the responses view.
    await expect(page.getByText("phone (removed)")).toBeVisible();

    // With responses present, the CSV export control is enabled. Not clicked:
    // the export is a direct browser fetch to the real API host, which is not
    // served in fixtures mode.
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeEnabled();

    // The toggle collapses the panel again.
    await feedbackRow.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByText("Responses — Spring launch feedback")).toBeHidden();
  });

  test("the union-of-keys rule is field-relative: a form's own fields decide which columns read as (removed)", async ({
    page,
  }) => {
    await page.goto("/forms");
    await expect(page).toHaveURL(/\/forms$/);

    // "Beta waitlist" declares ONLY an email field. Opening its responses shows
    // the same seeded responses, but now every non-email answer key is a field
    // this form does not declare — so "name" and "notes", which are normal
    // columns for the feedback form, render here as "(removed)". This asserts
    // the union rule keys off the specific form's fields, not a global schema.
    const betaRow = page.getByRole("row", { name: /Beta waitlist/ });
    await expect(betaRow).toBeVisible();
    await betaRow.getByRole("button", { name: "Responses" }).click();

    await expect(page.getByText("Responses — Beta waitlist")).toBeVisible();

    // Its own declared field keeps its label.
    await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();

    // Fields it does NOT declare are marked removed — including "name", which is
    // a first-class column for the feedback form above.
    await expect(page.getByText("name (removed)")).toBeVisible();
    await expect(page.getByText("notes (removed)")).toBeVisible();
    await expect(page.getByText("phone (removed)")).toBeVisible();
  });
});
