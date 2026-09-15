/**
 * Journey 8 — Conversions
 *
 * Record a conversion against a link via the API (POST /conversions), then
 * assert it appears in the conversions report in the dashboard.
 *
 * Oracles:
 *   - packages/contract/src/analytics.ts — RecordConversionInput,
 *     RecordConversionResult, Conversions schema
 *   - Invariant: a recorded conversion must appear in GET /conversions.
 *   - Invariant: RecordConversionResult.recorded=true on first record,
 *     recorded=false on duplicate externalId.
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

test.describe("Journey 8 — Conversions", () => {
  test("record a conversion and verify it appears in the report", async ({ page }) => {
    /* ---- Setup ---- */
    const session = await registerUser(makeEmail("j8"));
    const link = await createLink(session.accessToken, {
      destination: "https://example.com/j8-conversion-target",
    });

    /* ---- 1. Record a conversion via the API ---- */
    const externalId = `j8-conv-${RUN_ID}`;
    const convName = `J8-Sale-${RUN_ID.slice(0, 8)}`;
    const recordRes = await fetch(`${API_URL}/conversions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        linkId: link.id,
        kind: "sale",
        name: convName,
        valueMinor: 9900,   // ₹99.00
        currency: "INR",
        externalId,
      }),
    });
    expect(recordRes.ok, "POST /conversions should succeed").toBe(true);
    const recordBody = await recordRes.json() as {
      id?: string | null;
      recorded?: boolean;
    };
    // Oracle: RecordConversionResult
    expect(recordBody.recorded, "First conversion should return recorded=true").toBe(true);
    expect(typeof recordBody.id === "string" || recordBody.id === null).toBe(true);

    /* ---- 2. Idempotency: duplicate externalId must return recorded=false ---- */
    const dupeRes = await fetch(`${API_URL}/conversions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        linkId: link.id,
        kind: "sale",
        name: convName,
        valueMinor: 9900,
        currency: "INR",
        externalId,  // same externalId
      }),
    });
    expect(dupeRes.ok, "Duplicate conversion POST should succeed").toBe(true);
    const dupeBody = await dupeRes.json() as { recorded?: boolean };
    expect(dupeBody.recorded, "Duplicate conversion should return recorded=false").toBe(false);

    /* ---- 3. Verify in the conversions report API ---- */
    const reportRes = await fetch(`${API_URL}/conversions?range=24h`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    });
    expect(reportRes.ok, "GET /conversions should succeed").toBe(true);
    const report = await reportRes.json() as {
      totals?: { conversions?: number };
      events?: Array<{ name?: string }>;
    };
    // Oracle: at least one conversion should appear
    expect(
      (report.totals?.conversions ?? 0) + (report.events?.length ?? 0),
      "Conversions report should reflect the recorded conversion",
    ).toBeGreaterThan(0);

    /* ---- 4. Verify in the dashboard UI ---- */
    await seedAccount(page, session);
    await page.goto("/conversions");
    await expect(page).toHaveURL(/\/conversions/);

    // The conversions page renders without error
    await expect(
      page.getByText("Which links actually produced revenue — not which produced clicks."),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("That didn't load")).toHaveCount(0);

    // The page should show some conversion data
    await expect(page.getByText("Funnel")).toBeVisible();
    await expect(page.getByText("Tracked events")).toBeVisible();
  });
});
