import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";
import {
  clickInPlace,
  expectHeaderAlignsWithCells,
  expectNoPageOverflow,
  expectReachable,
  scrollTableEnd,
  scrollTableStart,
} from "../support/row-actions";

/* E2E (#832): the same "row actions must not hide behind horizontal scroll" the
   #786 spec locks for Developers and Domains, now for the three tables #786 did
   NOT touch — Forms, Bio and Reports.

   #786 introduced the pinned <ActionsTh/>/<ActionsTd/> column (sticky right edge
   of the TableWrap scroller); #832 is the mechanical swap of each remaining
   empty last <Th /> + `text-right whitespace-nowrap` action <Td> onto it. The
   shared <Table/> has min-width:560px, so below ~560px the last column — the one
   holding the row's buttons — was pushed into the scroller's overflow and the
   buttons ("Delete", "Reviewed", …) were unreachable without scrolling sideways.

   Each case measures where the real control is and presses the real pixel
   (support/row-actions.ts: no scrollIntoView, which would MASK the bug), at the
   four widths from the issue: 1316, 1024, 640, 390. It asserts the OBSERVABLE
   effect of the click — the delete confirm appears, the editor drawer opens, the
   responses panel toggles, the review PATCH is sent — not that the button merely
   rendered.

   Team is deliberately absent: its inline role editor needs a separate layout
   decision and stays on its own issue.

   Chromium only (the verify.yml e2e lane installs nothing else); a mobile width
   (390px, Pixel 7 UA) is covered as one of the four viewports. */

const FORMS = [
  {
    id: "frm_feedback",
    slug: "spring-feedback",
    title: "Spring launch feedback for the whole marketing team",
    description: "Two minutes, and it genuinely shapes what we build next.",
    status: "live",
    fields: [{ key: "email", label: "Email", type: "email", required: true }],
    responseCount: 3,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-10T00:00:00.000Z",
  },
  {
    id: "frm_beta",
    slug: "beta-waitlist",
    title: "Beta waitlist",
    description: "",
    status: "draft",
    fields: [{ key: "email", label: "Email", type: "email", required: true }],
    responseCount: 0,
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  },
];

const BIO_PAGES = [
  {
    id: "bio_acme",
    domain: "snap.to",
    slug: "acme-spring-collection-landing",
    status: "live",
    views: 42180,
    clickThrough: 31.4,
    profile: { name: "Acme", bio: "Tools for people who make things.", initials: "AC" },
    blocks: [{ id: "b1", kind: "header", title: "Header", subtitle: "Logo and bio", metric: null, locked: true }],
  },
  {
    id: "bio_priya",
    domain: "snap.to",
    slug: "priya",
    status: "draft",
    views: 0,
    clickThrough: null,
    profile: { name: "Priya Raman", bio: "Growth at Acme.", initials: "PR" },
    blocks: [],
  },
];

type ReportStatus = "open" | "reviewed" | "dismissed" | "actioned";
const report = (id: string, slug: string, status: ReportStatus) => ({
  id,
  slug,
  reason: `A fairly long abuse reason describing why /${slug} was reported, to widen the row`,
  reporterContact: null,
  status,
  linkId: "0191f6a0-0000-7000-8000-0000000c0790",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
const REPORT_OPEN = "0191f6a0-0000-7000-8000-00000000a832";

const common = {
  "GET /auth/me": { status: 200, body: { ...MOCK_USER, role: "owner" } },
  "GET /auth/workspaces": { status: 200, body: [] },
  "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
} as const;

const WIDTHS = [
  { name: "1316px", use: { viewport: { width: 1316, height: 900 } } },
  { name: "1024px", use: { viewport: { width: 1024, height: 900 } } },
  { name: "640px", use: { viewport: { width: 640, height: 900 }, hasTouch: true } },
  {
    name: "390px",
    use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent },
  },
] as const;

const row = (page: Page, text: string) => page.locator("main tbody tr").filter({ hasText: text });

/* The sticky Actions column settles via a ResizeObserver after first paint, so a
   single measurement can race it under parallel-worker CPU contention. Retry the
   ≤1px alignment check (tolerance unchanged) until layout settles. */
async function expectHeaderAligned(header: Locator, cell: Locator, what: string) {
  await expect(async () => {
    await expectHeaderAlignsWithCells(header, cell, what);
  }).toPass({ timeout: 5000 });
}

for (const w of WIDTHS) {
  test.describe(`more row actions reachable without scrolling (#832) — ${w.name}`, () => {
    test.use(w.use);

    test.beforeEach(async ({ page }) => {
      await seedMockSession(page);
    });

    test("Forms: Responses, Edit and Delete are fully visible, and each does its job", async ({ page }) => {
      let store = [...FORMS];
      const api = await mockApi(page, {
        ...common,
        "GET /forms": () => ({ status: 200, body: store }),
        "GET /forms/frm_feedback/responses": { status: 200, body: [] },
        "DELETE /forms/frm_feedback": () => {
          store = store.filter((f) => f.id !== "frm_feedback");
          return { status: 204 };
        },
      });
      await page.goto("/forms");

      const r = row(page, "Spring launch feedback");
      await expect(r).toBeVisible();
      await expectNoPageOverflow(page);

      // All three actions reachable on both rows without scrolling sideways.
      for (const title of ["Spring launch feedback", "Beta waitlist"]) {
        await expectReachable(row(page, title).getByRole("button", { name: "Responses" }), `${title}: Responses`);
        await expectReachable(row(page, title).getByRole("button", { name: /^Edit / }), `${title}: Edit`);
        await expectReachable(row(page, title).getByRole("button", { name: /^Delete / }), `${title}: Delete`);
      }

      // Still reachable after the scroller is swept all the way right and back.
      await scrollTableEnd(r.getByRole("button", { name: /^Delete / }));
      await expectReachable(r.getByRole("button", { name: /^Delete / }), "Delete after scrolling right");
      await scrollTableStart(r.getByRole("button", { name: /^Delete / }));

      // Responses toggles the panel open.
      await clickInPlace(page, r.getByRole("button", { name: "Responses" }), "Responses");
      await expect(r.getByRole("button", { name: "Hide" })).toBeVisible();
      await clickInPlace(page, r.getByRole("button", { name: "Hide" }), "Hide");

      // Edit opens the form drawer (dialog named "Edit <title>").
      await clickInPlace(page, r.getByRole("button", { name: /^Edit / }), "Edit");
      await expect(page.getByRole("dialog", { name: /^Edit Spring launch feedback/ })).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();

      // Delete raises the confirm banner, then confirming sends the DELETE.
      await clickInPlace(page, r.getByRole("button", { name: /^Delete / }), "Delete");
      await expect(page.getByText(/Deleting .* cannot be undone/)).toBeVisible();
      expect(api.callsTo("DELETE", "/forms/frm_feedback")).toHaveLength(0);
      await page.getByRole("button", { name: "Delete for good" }).click();
      await expect.poll(() => api.callsTo("DELETE", "/forms/frm_feedback").length).toBe(1);
    });

    test("Forms: the actions header sits over its cells", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /forms": { status: 200, body: FORMS },
      });
      await page.goto("/forms");
      const r = row(page, "Spring launch feedback");
      await expect(r).toBeVisible();
      const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Responses" }) });
      await expectHeaderAligned(
        table.getByRole("columnheader", { name: "Actions" }),
        r.getByRole("cell").last(),
        "Forms actions column",
      );
    });

    test("Bio: Edit and Delete are fully visible, Delete confirms inline and sends the DELETE", async ({ page }) => {
      let store = [...BIO_PAGES];
      const api = await mockApi(page, {
        ...common,
        "GET /bio-pages": () => ({ status: 200, body: store }),
        "DELETE /bio-pages/bio_acme": () => {
          store = store.filter((p) => p.id !== "bio_acme");
          return { status: 204 };
        },
      });
      await page.goto("/bio");

      const r = row(page, "acme-spring-collection-landing");
      await expect(r).toBeVisible();
      await expectNoPageOverflow(page);

      for (const slug of ["acme-spring-collection-landing", "snap.to/priya"]) {
        await expectReachable(row(page, slug).getByRole("button", { name: "Edit" }), `${slug}: Edit`);
        await expectReachable(row(page, slug).getByRole("button", { name: "Delete" }), `${slug}: Delete`);
      }

      await scrollTableEnd(r.getByRole("button", { name: "Delete" }));
      await expectReachable(r.getByRole("button", { name: "Delete" }), "Delete after scrolling right");
      await scrollTableStart(r.getByRole("button", { name: "Delete" }));

      // Delete swaps the row to its inline Keep / Delete confirm; both reachable.
      await clickInPlace(page, r.getByRole("button", { name: "Delete" }), "Delete");
      await expectReachable(r.getByRole("button", { name: "Keep" }), "Keep");
      await expectReachable(r.getByRole("button", { name: "Delete" }), "confirm Delete");
      expect(api.callsTo("DELETE", "/bio-pages/bio_acme")).toHaveLength(0);
      await clickInPlace(page, r.getByRole("button", { name: "Delete" }), "confirm Delete");
      await expect.poll(() => api.callsTo("DELETE", "/bio-pages/bio_acme").length).toBe(1);
    });

    test("Bio: the actions header sits over its cells", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /bio-pages": { status: 200, body: BIO_PAGES },
      });
      await page.goto("/bio");
      const r = row(page, "acme-spring-collection-landing");
      await expect(r).toBeVisible();
      const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Click-through" }) });
      await expectHeaderAligned(
        table.getByRole("columnheader", { name: "Actions" }),
        r.getByRole("cell").last(),
        "Bio actions column",
      );
    });

    test("Reports: Reviewed, Dismiss and Flag are fully visible, and the review PATCH is sent", async ({ page }) => {
      let store = [report(REPORT_OPEN, "spammy-link", "open")];
      const api = await mockApi(page, {
        ...common,
        "GET /reports": () => ({ status: 200, body: store }),
        [`PATCH /reports/${REPORT_OPEN}`]: (req) => {
          const body = req.body as { status?: ReportStatus };
          store = store.map((r) => (r.id === REPORT_OPEN ? { ...r, status: body.status ?? r.status } : r));
          return { status: 200, body: store[0] };
        },
      });
      await page.goto("/reports");

      const r = row(page, "/spammy-link");
      await expect(r).toBeVisible();
      await expectNoPageOverflow(page);

      await expectReachable(r.getByRole("button", { name: /^Mark report .* reviewed/ }), "Reviewed");
      await expectReachable(r.getByRole("button", { name: /^Dismiss report /}), "Dismiss");
      await expectReachable(r.getByRole("button", { name: /^Flag the link /}), "Flag link");

      await scrollTableEnd(r.getByRole("button", { name: /^Dismiss report /}));
      await expectReachable(r.getByRole("button", { name: /^Dismiss report /}), "Dismiss after scrolling right");
      await scrollTableStart(r.getByRole("button", { name: /^Dismiss report /}));

      // Reviewed sends the PATCH; the row flips to its reviewed state.
      await clickInPlace(page, r.getByRole("button", { name: /^Mark report .* reviewed/ }), "Reviewed");
      await expect.poll(() => api.callsTo("PATCH", `/reports/${REPORT_OPEN}`).length).toBe(1);
      expect(api.callsTo("PATCH", `/reports/${REPORT_OPEN}`)[0]!.body).toEqual({ status: "reviewed" });
      await expect(r).toContainText("Reviewed");
    });

    test("Reports: the actions header sits over its cells", async ({ page }) => {
      await mockApi(page, {
        ...common,
        "GET /reports": { status: 200, body: [report(REPORT_OPEN, "spammy-link", "open")] },
      });
      await page.goto("/reports");
      const r = row(page, "/spammy-link");
      await expect(r).toBeVisible();
      const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Reason" }) });
      await expectHeaderAligned(
        table.getByRole("columnheader", { name: "Actions" }),
        r.getByRole("cell").last(),
        "Reports actions column",
      );
    });
  });
}
