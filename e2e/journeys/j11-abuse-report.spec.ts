/**
 * Journey 11 — Abuse report
 *
 * File a report against a link through the public route
 * (POST /api/v1/public/reports/:slug), then verify it appears in the
 * operator's queue at GET /reports (authenticated).
 *
 * Oracles:
 *   - packages/contract/src/report.ts — SubmitReportInput, SubmitReportResult,
 *     AbuseReport, AbuseReportStatus
 *   - PublicController: POST /public/reports/:slug (unauthenticated)
 *   - ReportsController: GET /reports (authenticated, workspace-scoped)
 *   - Invariant: a submitted report for a slug that belongs to this workspace
 *     must appear in the workspace's report queue.
 *   - Privacy invariant: the intake endpoint always returns {ok:true} regardless
 *     of whether the slug exists (per SubmitReportResult docs — to prevent
 *     enumeration).
 */

import { expect, test } from "@playwright/test";
import {
  makeEmail,
  registerUser,
  seedAccount,
  createLink,
  API_URL,
  RUN_ID,
} from "./helpers";

test.describe("Journey 11 — Abuse report", () => {
  test("file a report and see it in the operator queue", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j11"));
    const link = await createLink(session.accessToken, {
      destination: "https://example.com/j11-target",
    });

    /* ---- 1. File a report via the public unauthenticated route ---- */
    // Oracle: PublicController POST /public/links/:slug/report (not /public/reports/:slug)
    const reason = `J11 test report ${RUN_ID} — suspicious link`;
    const submitRes = await fetch(`${API_URL}/public/links/${link.slug}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason,
        reporterContact: makeEmail("j11-reporter"),
      }),
    });
    expect(submitRes.ok, `POST /public/links/${link.slug}/report should succeed`).toBe(true);
    const submitBody = await submitRes.json() as { ok?: boolean };
    // Oracle: SubmitReportResult always returns {ok:true} (even if slug not found)
    expect(submitBody.ok, "Submit result should be {ok:true}").toBe(true);

    /* ---- 2. Privacy invariant: a non-existent slug also returns {ok:true} ---- */
    const fakeSlugRes = await fetch(`${API_URL}/public/links/definitely-does-not-exist-${RUN_ID}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Probing non-existent slug" }),
    });
    // Oracle: must return {ok:true} regardless (anti-enumeration)
    const fakeBody = await fakeSlugRes.json() as { ok?: boolean };
    expect(fakeBody.ok, "Non-existent slug report should also return {ok:true}").toBe(true);

    /* ---- 3. Verify the report appears in the operator queue ---- */
    // Reports may take a moment to be queryable
    let reports: Array<{ id: string; slug: string; reason: string; status: string }> = [];
    for (let i = 0; i < 5; i++) {
      const reportsRes = await fetch(`${API_URL}/reports`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        reports = Array.isArray(data) ? data : data.items ?? [];
        if (reports.some((r) => r.slug === link.slug)) break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    const ourReport = reports.find((r) => r.slug === link.slug);
    expect(ourReport, `Report for slug ${link.slug} should appear in GET /reports`).toBeTruthy();
    expect(ourReport?.status, "Report should start as 'open'").toBe("open");

    /* ---- 4. Verify in the UI: the report appears in /reports ---- */
    await seedAccount(page, session);
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports/);

    // The reports queue should render and show our report
    const reportRow = page.getByRole("row").filter({ has: page.getByText(`/${link.slug}`, { exact: true }) });
    await expect(reportRow).toBeVisible({ timeout: 15_000 });
    await expect(reportRow.getByText(/Open/i)).toBeVisible();
  });
});
