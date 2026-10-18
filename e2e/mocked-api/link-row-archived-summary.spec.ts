import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession, type MockApi } from "../support/mock-api";

/* E2E (#760): an archived link's row keeps its expiry / schedule summary.

   The row described a link by `link.status`, and an archived link's status is just
   "archived", so the Archived filter printed "Never expires" for a link that was
   scheduled to go live (the schedule came back on unarchive — only the label was
   wrong). The label is now decided from the schedule fields and the clock
   (web/src/lib/link-lifecycle.ts, unit-tested there); this spec proves the DOM.

   Oracle: what the SAME row printed in the normal list before the click that
   archived it. Archiving must not change when a link goes live or stops working,
   so the details line must be identical in the Archived filter. Also asserted
   independently of that comparison: the scheduled row says "Goes live" and never
   "Never expires".

   Mocked-API lane: the stand-in API applies the real contract's rules (archived
   wins the `status` field; the schedule fields are returned either way). The
   real-stack round trip is journey j760-archived-scheduled-label.spec.ts. */

const NOW = "2026-01-01T00:00:00.000Z";
const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

type Row = Record<string, unknown> & { id: string; slug: string; archived: boolean };

function row(slug: string, over: Record<string, unknown> = {}): Row {
  return {
    id: `lnk_${slug}`,
    domain: "snap.to",
    slug,
    destination: `https://example.com/${slug}`,
    tags: [] as string[],
    clicks: 0,
    redirectType: "302",
    rules: [],
    expiresAt: null,
    activatesAt: null,
    clickLimit: null,
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: NOW },
    sparkline: Array.from({ length: 30 }, () => 0),
    createdAt: NOW,
    archived: false,
    ...over,
  };
}

/* One link per lifecycle state, plus the pattern its details line must match. */
const LINKS: Array<{ slug: string; over: Record<string, unknown>; summary: RegExp }> = [
  { slug: "sched", over: { activatesAt: inDays(9) }, summary: /^Goes live [A-Z][a-z]{2} \d{1,2}, \d{4}$/ },
  { slug: "sched-exp", over: { activatesAt: inDays(2), expiresAt: inDays(20) }, summary: /^Goes live / },
  { slug: "dated", over: { expiresAt: inDays(30) }, summary: /^Expires [A-Z][a-z]{2} \d{1,2}, \d{4}$/ },
  { slug: "soon", over: { expiresAt: inDays(2) }, summary: /^Expires [A-Z]/ },
  { slug: "past", over: { expiresAt: inDays(-3) }, summary: /^Expired [A-Z][a-z]{2} \d{1,2}, \d{4}$/ },
  { slug: "limit", over: { clickLimit: 500, clicks: 3 }, summary: /^Expires after 500 clicks$/ },
  { slug: "spent", over: { clickLimit: 50, clicks: 50 }, summary: /^Expired after 50 clicks$/ },
  { slug: "never", over: {}, summary: /^Never expires$/ },
];

/* What the API's deriveStatus says, for a link that is not archived. */
function underlyingStatus(l: Row): string {
  const now = Date.now();
  const at = (v: unknown) => (typeof v === "string" ? new Date(v).getTime() : null);
  if (l.clickLimit != null && (l.clicks as number) >= (l.clickLimit as number)) return "expired";
  const exp = at(l.expiresAt);
  if (exp != null && exp <= now) return "expired";
  const act = at(l.activatesAt);
  if (act != null && act > now) return "scheduled";
  if (exp != null && exp - now <= 7 * DAY) return "expiring";
  return "active";
}

const dto = (l: Row) => {
  const { archived, ...rest } = l;
  return { ...rest, status: archived ? "archived" : underlyingStatus(l) };
};

async function installApi(page: Page): Promise<{ api: MockApi; store: Row[] }> {
  const store = LINKS.map((l) => row(l.slug, l.over));
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": {
      status: 200,
      body: [{ id: "dom_1", domain: "snap.to", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null, shared: true }],
    },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": (req) => {
      const want = req.query?.status ?? "all";
      const items = store
        .map(dto)
        .filter((l) => (want === "all" ? l.status !== "archived" : l.status === want));
      return { status: 200, body: { items, total: items.length, nextCursor: null } };
    },
    ...Object.fromEntries(
      LINKS.map((l) => [
        `PATCH /links/lnk_${l.slug}`,
        (req: { body: unknown }) => {
          const target = store.find((s) => s.slug === l.slug)!;
          const patch = req.body as { archived?: boolean };
          if (patch.archived !== undefined) target.archived = patch.archived;
          return { status: 200, body: dto(target) };
        },
      ]),
    ),
  });
  return { api, store };
}

/** Expand every row (the first one is open by default) and read its details line. */
async function summaries(page: Page): Promise<Record<string, string>> {
  const rows = page.locator("article");
  await expect(rows.first()).toBeVisible();
  for (const r of await rows.all()) {
    const show = r.getByRole("button", { name: "Show routing" });
    if (await show.count()) await show.click();
  }
  const out: Record<string, string> = {};
  for (const r of await rows.all()) {
    const slug = (await r.getByRole("link").first().innerText()).split("/").pop()!.trim();
    const line = r.getByText(/^· (Goes live|Expires|Expired|Never expires)/).first();
    out[slug] = (await line.innerText()).replace(/^·\s*/, "").trim();
  }
  return out;
}

const rowFor = (page: Page, slug: string): Locator =>
  page.locator("article").filter({ has: page.getByRole("link", { name: `snap.to/${slug}`, exact: true }) });
const archiveButton = (r: Locator, slug: string) => r.getByRole("button", { name: new RegExp(`^Archive link .+/${slug}$`) });

/* `defaultBrowserType` is part of a device descriptor and cannot be set inside a
   describe (it forces a new worker); the lane is chromium, which is also Pixel 7's
   engine, so take everything else from the descriptor. */
const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  test.describe(`Link row lifecycle summary — ${vp.name}`, () => {
    test.use(vp.use);

    test("the normal list describes every lifecycle state", async ({ page }) => {
      await installApi(page);
      await page.goto("/links");
      const got = await summaries(page);
      for (const l of LINKS) expect(got[l.slug], `row ${l.slug}`).toMatch(l.summary);
    });

    test("the Archived filter prints the same summary the row had before it was archived", async ({ page }, info) => {
      const { api, store } = await installApi(page);
      await page.goto("/links");
      const before = await summaries(page);

      /* Archive every row with a real click on its row action. */
      for (const l of LINKS) {
        await archiveButton(rowFor(page, l.slug), l.slug).click();
        await expect(rowFor(page, l.slug)).toHaveCount(0, { timeout: 10_000 });
      }
      expect(api.callsTo("PATCH", "/links/lnk_sched")[0].body).toMatchObject({ archived: true });
      expect(store.every((s) => s.archived)).toBe(true);

      await page.getByRole("button", { name: "Archived" }).click();
      await expect(page.locator("article")).toHaveCount(LINKS.length);
      const after = await summaries(page);
      await page.screenshot({ path: info.outputPath(`archived-filter-${vp.name.split(" ")[0]}.png`), fullPage: true });

      expect(after).toEqual(before);
      for (const l of LINKS) expect(after[l.slug], `archived row ${l.slug}`).toMatch(l.summary);
      /* The reported bug, stated directly. */
      expect(after.sched).not.toMatch(/never expires/i);
      expect(after.sched).toMatch(/^Goes live /);
      expect(after.limit).toBe("Expires after 500 clicks");
      expect(after.never).toBe("Never expires");
      /* The status chip still says what the filter is. */
      await expect(page.locator("article").first().getByText("Archived", { exact: true })).toBeVisible();
    });

    test("unarchiving restores the row to the normal list with the same summary", async ({ page }) => {
      await installApi(page);
      await page.goto("/links");
      const before = await summaries(page);

      await archiveButton(rowFor(page, "sched"), "sched").click();
      await page.getByRole("button", { name: "Archived" }).click();
      const archived = rowFor(page, "sched");
      await expect(archived).toHaveCount(1);
      await archived.getByRole("button", { name: /^Unarchive link .+\/sched$/ }).click();
      await expect(page.locator("article")).toHaveCount(0);

      await page.getByRole("button", { name: "All" }).click();
      const after = await summaries(page);
      expect(after.sched).toBe(before.sched);
    });
  });
}
