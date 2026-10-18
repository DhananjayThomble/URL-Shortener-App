import { devices, expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #755 — Bulk create: after a partial failure the whole textarea was resent,
   and every row WITHOUT a back-half was created again (the API can only dedupe
   by back-half; a slug-less row gets a fresh random one per request).

   What is asserted is the REAL request body the real API client sends on each
   submit. The mock answers like the API does (links.service.ts bulkCreate):
   a row is created, rejected with the contract's own message, or skipped
   because its back-half exists — and, like the real server, it creates a
   slug-less row again every time it is sent. It records every row it creates,
   so "a row that succeeded is never sent again" is checked against what the
   server was actually asked, not against the screen. */

const DOMAIN = {
  id: "dom_snap",
  domain: "snap.to",
  status: "live",
  ssl: "active",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  shared: true,
  dns: null,
} as const;

type Row = { destination: string; domain: string; slug?: string };
type Outcome =
  | { ok: true; index: number; link: ReturnType<typeof linkFrom> }
  | { ok: false; index: number; destination: string; error: string; skipped?: true };

function linkFrom(row: Row, slug: string, n: number) {
  return {
    id: `lnk_${n}`,
    domain: row.domain,
    slug,
    destination: row.destination,
    title: null,
    comment: null,
    tags: [],
    folder: null,
    status: "active",
    clicks: 0,
    uniqueClicks: 0,
    redirectType: "302",
    rules: [],
    passwordProtected: false,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    cloaked: false,
    safeBrowsing: { status: "clean", checkedAt: "2026-01-01T00:00:00.000Z" },
    sparkline: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: MOCK_USER.name,
  };
}

/** Back-halves that "already exist" on the mock server. */
const TAKEN = new Set(["taken"]);

function setup(page: Page, opts: { delayMs?: number } = {}) {
  /** Every link the mock server has created, in order. */
  const created: Array<{ destination: string; slug: string }> = [];
  /** The `links` array of every POST /links/bulk. */
  const batches: Row[][] = [];
  let n = 0;

  const bulk = (rows: Row[]) => {
    const results: Outcome[] = rows.map((row, index) => {
      try {
        const u = new URL(row.destination);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
      } catch {
        // contract: HttpUrl error, prefixed with the failing path by bulkCreate
        return { ok: false, index, destination: row.destination, error: "destination: Enter an absolute http(s) URL" };
      }
      if (row.slug && TAKEN.has(row.slug)) {
        return {
          ok: false,
          index,
          destination: row.destination,
          error: `${row.domain}/${row.slug} already exists. Skipped — existing back-halves are never overwritten.`,
          skipped: true,
        };
      }
      // Slug-less rows get a NEW random back-half on every request, exactly the root cause of #755.
      const slug = row.slug ?? `gen${++n}x`;
      if (row.slug) TAKEN.add(row.slug);
      created.push({ destination: row.destination, slug });
      return { ok: true, index, link: linkFrom(row, slug, ++n) };
    });
    return {
      created: results.filter((r) => r.ok).length,
      skipped: results.filter((r) => !r.ok && r.skipped).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      results,
    };
  };

  return (async () => {
    TAKEN.clear();
    TAKEN.add("taken");
    const api = await mockApi(page, {
      "GET /auth/me": { status: 200, body: MOCK_USER },
      "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
      "GET /auth/workspaces": {
        status: 200,
        body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
      },
      "GET /domains": { status: 200, body: [DOMAIN] },
      "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
      "GET /members": { status: 200, body: [] },
    });
    // Registered after mockApi's catch-all, so it takes precedence for this endpoint only.
    await page.route("**/api/v1/links/bulk", async (route) => {
      const rows = (route.request().postDataJSON() as { links: Row[] }).links;
      batches.push(rows);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(bulk(rows)) });
    });
    await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
    return { api, created, batches };
  })();
}

const BOX = (page: Page) => page.getByLabel("One link per line");

async function openBulk(page: Page) {
  await page.goto("/links");
  await page.getByRole("button", { name: "Bulk create" }).click();
  await expect(BOX(page)).toBeVisible();
}

/* The exact list from the report: 5 lines, some slug-less, plus invalid ones. */
const FIVE = [
  "https://example.com/spring",
  "https://example.com/summer, summer-sale",
  "not a url",
  "https://example.com/fall",
  "https://example.com/winter, taken",
].join("\n");

/* Pixel 7 is chromium, this lane's only engine; iPhone 15 (webkit) is run by
   the journeys lane locally. */
const { defaultBrowserType: _engine, ...PIXEL_7 } = devices["Pixel 7"];

for (const [label, use] of [
  ["desktop", {}],
  ["mobile (Pixel 7)", PIXEL_7],
] as const) {
  test.describe(`Bulk create keeps already-created rows out of a resubmit (#755) — ${label}`, () => {
    test.use(use);

    test("partial success: only the failed rows stay in the box, the button count follows, and resubmitting never recreates a created row", async ({ page }) => {
      const { created, batches } = await setup(page);
      await openBulk(page);
      await BOX(page).fill(FIVE);
      await page.getByRole("button", { name: "Create 5 links" }).click();

      // The exact outcome the server reported.
      await expect(page.getByText("3 created.")).toBeVisible();
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(5);
      expect(created.map((c) => c.destination)).toEqual([
        "https://example.com/spring",
        "https://example.com/summer",
        "https://example.com/fall",
      ]);

      // Only the two failed rows are left, exactly as typed, and the button says so.
      await expect(BOX(page)).toHaveValue(["not a url", "https://example.com/winter, taken"].join("\n"));
      await expect(page.getByRole("button", { name: "Create 2 links" })).toBeVisible();
      await expect(page.getByText("2 rows didn't go through")).toBeVisible();

      // Resubmit WITHOUT editing: the two bad rows fail again, and nothing created is sent.
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.getByText("Nothing was created.")).toBeVisible();
      expect(batches).toHaveLength(2);
      expect(batches[1]!.map((r) => r.destination)).toEqual(["not a url", "https://example.com/winter"]);
      expect(created).toHaveLength(3); // no new link was made
      // The two failures are still in the box and still explained.
      await expect(BOX(page)).toHaveValue(["not a url", "https://example.com/winter, taken"].join("\n"));
      await expect(page.getByText("Enter an absolute http(s) URL")).toBeVisible();
      await expect(page.getByText(/taken already exists/)).toBeVisible();
    });

    test("edits between submits: fixing the flagged rows and resubmitting creates just those, once each", async ({ page }) => {
      const { created, batches } = await setup(page);
      await openBulk(page);
      await BOX(page).fill(FIVE);
      await page.getByRole("button", { name: "Create 5 links" }).click();
      await expect(page.getByText("3 created.")).toBeVisible();

      await BOX(page).fill(["https://example.com/fixed", "https://example.com/winter, winter-sale"].join("\n"));
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.getByText("2 created.")).toBeVisible();

      expect(batches).toHaveLength(2);
      expect(batches[1]).toEqual([
        expect.objectContaining({ destination: "https://example.com/fixed" }),
        expect.objectContaining({ destination: "https://example.com/winter", slug: "winter-sale" }),
      ]);
      expect(batches[1]![0]).not.toHaveProperty("slug");
      // 5 distinct links in total, none twice.
      expect(created.map((c) => c.destination).sort()).toEqual(
        [
          "https://example.com/spring",
          "https://example.com/summer",
          "https://example.com/fall",
          "https://example.com/fixed",
          "https://example.com/winter",
        ].sort(),
      );
      // Everything went through: the box is empty and nothing is offered for resubmit.
      await expect(BOX(page)).toHaveValue("");
      await expect(page.getByRole("button", { name: /^Create\s*links?$/ })).toBeDisabled();
    });

    test("everything succeeds: the box is emptied, so a second click cannot recreate anything", async ({ page }) => {
      const { created, batches } = await setup(page);
      await openBulk(page);
      await BOX(page).fill("https://example.com/a\nhttps://example.com/b\nhttps://example.com/c, c-slug");
      await page.getByRole("button", { name: "Create 3 links" }).click();
      await expect(page.getByText("3 created.")).toBeVisible();
      await expect(BOX(page)).toHaveValue("");
      await expect(page.getByRole("button", { name: /^Create\s*links?$/ })).toBeDisabled();
      expect(batches).toHaveLength(1);
      expect(created).toHaveLength(3);
    });

    test("nothing succeeds: the list stays exactly as typed for fixing", async ({ page }) => {
      const { batches } = await setup(page);
      await openBulk(page);
      const text = "not a url\nalso not a url";
      await BOX(page).fill(text);
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.getByText("Nothing was created.")).toBeVisible();
      await expect(BOX(page)).toHaveValue(text);
      await expect(page.getByRole("button", { name: "Create 2 links" })).toBeEnabled();
      expect(batches).toHaveLength(1);
    });

    test("two lines with the same destination are two links, and a resubmit keeps only the one that failed", async ({ page }) => {
      const { created, batches } = await setup(page);
      await openBulk(page);
      // Same destination three times, as intended (one link per line); the middle row asks for a taken back-half.
      await BOX(page).fill(["https://example.com/same", "https://example.com/same, taken", "https://example.com/same"].join("\n"));
      await page.getByRole("button", { name: "Create 3 links" }).click();
      await expect(page.getByText("2 created.")).toBeVisible();
      expect(created.filter((c) => c.destination === "https://example.com/same")).toHaveLength(2);
      await expect(BOX(page)).toHaveValue("https://example.com/same, taken");
      await expect(page.getByRole("button", { name: "Create 1 link" })).toBeVisible();
      expect(batches).toHaveLength(1);
    });

    test("double submit: a second click while the first is in flight sends nothing, and the box can't be edited under it", async ({ page }) => {
      const { created, batches } = await setup(page, { delayMs: 800 });
      await openBulk(page);
      await BOX(page).fill("https://example.com/one\nhttps://example.com/two");
      const button = page.getByRole("button", { name: "Create 2 links" });
      // Two clicks in the same tick, before React can re-render the disabled button.
      await button.evaluate((el: HTMLButtonElement) => {
        el.click();
        el.click();
      });
      await expect(page.getByRole("button", { name: "Creating…" })).toBeDisabled();
      await expect(BOX(page)).toHaveAttribute("readonly", "");
      await expect(page.getByText("2 created.")).toBeVisible();
      expect(batches).toHaveLength(1);
      expect(created).toHaveLength(2);
    });

    test("a request that fails outright leaves the list untouched so it can be sent again", async ({ page }) => {
      await setup(page);
      let calls = 0;
      await page.route("**/api/v1/links/bulk", async (route) => {
        calls++;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ statusCode: 500, message: "Something went wrong on our side.", error: "Internal Server Error" }),
        });
      });
      await openBulk(page);
      await BOX(page).fill("https://example.com/a\nhttps://example.com/b");
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.locator("p[role='alert']")).toBeVisible();
      await expect(BOX(page)).toHaveValue("https://example.com/a\nhttps://example.com/b");
      await expect(page.getByRole("button", { name: "Create 2 links" })).toBeEnabled();
      expect(calls).toBe(1);
    });
  });
}
