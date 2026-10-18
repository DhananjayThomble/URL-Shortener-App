import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #790 — after dismissing an abuse report its row kept offering "Dismiss". Each
   click sent the same PATCH again and nothing changed.

   Oracle: the issue's acceptance criteria — dismissed reports show their resolved
   state, without a Dismiss action. Shapes: packages/contract/src/report.ts;
   PATCH /reports/:id echoes the updated AbuseReport (reports.service.ts review()).

   Real API client + React Query cache. The list refetch that follows a mutation is
   HELD in one test, so the assertion proves the row updates from the PATCH response
   itself rather than from whenever the refetch happens to land. */

const REPORT_A = "0191f6a0-0000-7000-8000-00000000a790";
const REPORT_B = "0191f6a0-0000-7000-8000-00000000b790";

type Status = "open" | "reviewed" | "dismissed" | "actioned";
const report = (id: string, slug: string, status: Status, linkId: string | null = "0191f6a0-0000-7000-8000-0000000c0790") => ({
  id,
  slug,
  reason: `reported ${slug}`,
  reporterContact: null,
  status,
  linkId,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

const common = {
  "GET /auth/me": { status: 200, body: MOCK_USER },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
} as const;

const row = (page: Page, slug: string) => page.locator("main tbody tr").filter({ hasText: `/${slug}` });

for (const [name, use] of [
  ["desktop", { viewport: { width: 1440, height: 900 } }],
  // defaultBrowserType forces a new worker and cannot be set inside a describe.
  ["mobile", (({ defaultBrowserType: _ignored, ...rest }) => rest)(devices["Pixel 7"])],
] as const) {
  test.describe(`abuse reports dismissed (#790) — ${name}`, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("a dismissed report shows its resolved state and no Dismiss; the other row is untouched", async ({ page }) => {
      let store = [report(REPORT_A, "alpha", "open"), report(REPORT_B, "bravo", "open")];
      const api = await mockApi(page, {
        ...common,
        "GET /reports": () => ({ status: 200, body: store }),
        [`PATCH /reports/${REPORT_A}`]: (req) => {
          const { status } = req.body as { status: Status };
          store = store.map((r) => (r.id === REPORT_A ? { ...r, status } : r));
          return { status: 200, body: store[0] };
        },
      });
      await page.goto("/reports");

      const a = row(page, "alpha");
      const b = row(page, "bravo");
      await expect(a.getByRole("button", { name: "Dismiss report on /alpha" })).toBeVisible();
      await a.getByRole("button", { name: "Dismiss report on /alpha" }).click();

      expect(api.callsTo("PATCH", `/reports/${REPORT_A}`)[0]!.body).toEqual({ status: "dismissed" });
      await expect(a).toContainText("Dismissed");
      await expect(a.getByRole("button", { name: "Dismiss report on /alpha" })).toHaveCount(0);
      // Not a dead end: it can still be reopened as reviewed or acted on.
      await expect(a.getByRole("button", { name: "Mark report on /alpha reviewed" })).toBeVisible();
      await expect(a.getByRole("button", { name: "Flag the link for report on /alpha" })).toBeVisible();
      // The sibling row is still open and still offers Dismiss.
      await expect(b).toContainText("Open");
      await expect(b.getByRole("button", { name: "Dismiss report on /bravo" })).toBeVisible();
    });

    test("the row updates from the response, without waiting for the list refetch or a reload", async ({ page }) => {
      let store = [report(REPORT_A, "alpha", "open")];
      await mockApi(page, {
        ...common,
        "GET /reports": () => ({ status: 200, body: store }),
        [`PATCH /reports/${REPORT_A}`]: () => {
          store = [{ ...store[0]!, status: "dismissed" }];
          return { status: 200, body: store[0] };
        },
      });
      // Registered after mockApi, so it wins: answer the first list load, hold every refetch.
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let lists = 0;
      await page.route("**/api/v1/reports", async (route) => {
        lists += 1;
        if (lists > 1) await gate;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(store) });
      });
      await page.goto("/reports");

      const a = row(page, "alpha");
      await a.getByRole("button", { name: "Dismiss report on /alpha" }).click();
      // The refetch is still in flight (or held), yet the row already reads Dismissed.
      await expect(a).toContainText("Dismissed");
      await expect(a.getByRole("button", { name: "Dismiss report on /alpha" })).toHaveCount(0);
      release();
    });

    test("each status hides only the action that would be a no-op", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /reports": {
          status: 200,
          body: [
            report(REPORT_A, "alpha", "reviewed"),
            report(REPORT_B, "bravo", "actioned"),
            report("0191f6a0-0000-7000-8000-00000000c790", "charlie", "dismissed"),
          ],
        },
      });
      await page.goto("/reports");
      const reviewed = (s: string) => `Mark report on /${s} reviewed`;
      const dismiss = (s: string) => `Dismiss report on /${s}`;
      const flag = (s: string) => `Flag the link for report on /${s}`;

      await expect(row(page, "alpha").getByRole("button", { name: reviewed("alpha") })).toHaveCount(0);
      await expect(row(page, "alpha").getByRole("button", { name: dismiss("alpha") })).toBeVisible();
      await expect(row(page, "bravo").getByRole("button", { name: flag("bravo") })).toHaveCount(0);
      await expect(row(page, "bravo").getByRole("button", { name: dismiss("bravo") })).toBeVisible();
      await expect(row(page, "charlie").getByRole("button", { name: dismiss("charlie") })).toHaveCount(0);
      await expect(row(page, "charlie").getByRole("button", { name: reviewed("charlie") })).toBeVisible();
    });
  });
}
