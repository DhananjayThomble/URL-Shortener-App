import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import {
  MOCK_USER,
  MOCK_WORKSPACE,
  fakeAccessToken,
  mockApi,
  nestError,
  seedMockSession,
  type MockApi,
  type MockReply,
  type MockRequest,
} from "../support/mock-api";

/* E2E (#757): success feedback after create / archive / unarchive / delete / save,
   and an Undo on archive.

   Before: all of them were silent. Archiving removed the row at once, and because
   rows shift up, a double click archived the NEXT link too.

   Mocked-API lane: the REAL web app, React Query cache and API client against a
   stateful browser-level stand-in for the links endpoints. A control is verified
   by its observable effect after a real click: the toast text in the live region,
   and the request the browser actually sent (the Undo must send
   PATCH {archived:false}, not just hide the toast). The real-stack round trip is
   journey j757-success-toasts-undo.spec.ts. */

const NOW = "2026-01-01T00:00:00.000Z";
const SLUGS = ["alpha", "bravo", "charlie", "delta", "echo"] as const;

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

const dto = (l: Row) => {
  const { archived, ...rest } = l;
  return { ...rest, status: archived ? "archived" : "active" };
};

type Opts = { failPatch?: MockReply; failDelete?: MockReply; failCreate?: MockReply; failSettings?: MockReply };

async function install(page: Page, opts: Opts = {}): Promise<{ api: MockApi; store: Row[] }> {
  const store = SLUGS.map((s) => row(s));
  const workspace: Record<string, unknown> = { ...MOCK_WORKSPACE };
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));

  const perLink = Object.fromEntries(
    SLUGS.flatMap((slug) => {
      const find = () => store.find((s) => s.slug === slug)!;
      return [
        [`GET /links/lnk_${slug}`, () => ({ status: 200, body: dto(find()) })],
        [
          `PATCH /links/lnk_${slug}`,
          (req: MockRequest) => {
            if (opts.failPatch) return opts.failPatch;
            const patch = req.body as { archived?: boolean; destination?: string };
            const target = find();
            if (patch.archived !== undefined) target.archived = patch.archived;
            if (patch.destination !== undefined) target.destination = patch.destination;
            return { status: 200, body: dto(target) };
          },
        ],
        [
          `DELETE /links/lnk_${slug}`,
          () => {
            if (opts.failDelete) return opts.failDelete;
            store.splice(store.indexOf(find()), 1);
            return { status: 204 };
          },
        ],
      ] as const;
    }),
  );

  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": () => ({ status: 200, body: workspace }),
    "PATCH /workspaces/current": (req) => {
      if (opts.failSettings) return opts.failSettings;
      Object.assign(workspace, req.body);
      return { status: 200, body: workspace };
    },
    "GET /domains": {
      status: 200,
      body: [{ id: "dom_1", domain: "snap.to", status: "live", ssl: "active", links: 0, rootRedirect: null, notFoundRedirect: null, shared: true }],
    },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /analytics": { status: 404, body: { statusCode: 404, message: "no analytics in this lane", error: "Not Found" } },
    "GET /links": (req) => {
      const want = req.query?.status ?? "all";
      const items = store.map(dto).filter((l) => (want === "all" ? l.status !== "archived" : l.status === want));
      return { status: 200, body: { items, total: items.length, nextCursor: null } };
    },
    "POST /links": (req) => {
      if (opts.failCreate) return opts.failCreate;
      const input = req.body as { slug?: string; destination: string };
      const created = row(input.slug || "fresh", { destination: input.destination });
      store.unshift(created);
      return { status: 201, body: dto(created) };
    },
    ...perLink,
  });
  return { api, store };
}

const rowFor = (page: Page, slug: string): Locator =>
  page.locator("article").filter({ has: page.getByRole("link", { name: `snap.to/${slug}`, exact: true }) });
const archiveButton = (page: Page, slug: string) =>
  rowFor(page, slug).getByRole("button", { name: `Archive link snap.to/${slug}`, exact: true });

/** The two live regions inside the Notifications landmark: polite (success) and assertive (errors). */
const polite = (page: Page) => page.getByRole("region", { name: /notifications/i }).locator('[aria-live="polite"]');
const assertive = (page: Page) => page.getByRole("region", { name: /notifications/i }).locator('[aria-live="assertive"]');
const toastItems = (page: Page) => page.getByTestId("toast");
const toast = (page: Page, text: RegExp | string) => toastItems(page).filter({ hasText: text });

/* `defaultBrowserType` is part of a device descriptor and cannot be set inside a
   describe; the lane is chromium, which is also Pixel 7's engine. */
const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  test.describe(`Success feedback + Undo — ${vp.name}`, () => {
    test.use(vp.use);

    test("archiving announces it in a polite live region and offers a working Undo", async ({ page }) => {
      const { api, store } = await install(page);
      await page.goto("/links");
      await expect(rowFor(page, "alpha")).toBeVisible();

      /* The live regions must already exist and be empty BEFORE the action: a region
         inserted together with its text is often not announced. */
      await expect(polite(page)).toBeAttached();
      await expect(assertive(page)).toBeAttached();
      await expect(toastItems(page)).toHaveCount(0);

      await archiveButton(page, "alpha").click();

      const t = toast(page, "Archived snap.to/alpha");
      await expect(t).toBeVisible();
      await expect(polite(page).filter({ has: t })).toHaveCount(1);
      await expect(rowFor(page, "alpha")).toHaveCount(0);
      expect(api.callsTo("PATCH", "/links/lnk_alpha")[0].body).toMatchObject({ archived: true });

      await t.getByRole("button", { name: "Undo" }).click();

      /* The observable effect of Undo: a request that unarchives, and the row back. */
      await expect.poll(() => api.callsTo("PATCH", "/links/lnk_alpha").length).toBe(2);
      expect(api.callsTo("PATCH", "/links/lnk_alpha")[1].body).toMatchObject({ archived: false });
      expect(store.find((s) => s.slug === "alpha")!.archived).toBe(false);
      await expect(rowFor(page, "alpha")).toBeVisible();
      /* The archive toast is gone and a plain confirmation (no second Undo) replaces it. */
      await expect(toast(page, "Archived snap.to/alpha")).toHaveCount(0);
      await expect(toast(page, "Restored snap.to/alpha")).toBeVisible();
      await expect(toast(page, "Restored snap.to/alpha").getByRole("button", { name: "Undo" })).toHaveCount(0);
    });

    test("the Archived filter shows the link after archive, and Unarchive there also confirms", async ({ page }) => {
      const { api } = await install(page);
      await page.goto("/links");
      await archiveButton(page, "bravo").click();
      await expect(toast(page, "Archived snap.to/bravo")).toBeVisible();

      await page.getByRole("button", { name: "Archived" }).click();
      await rowFor(page, "bravo").getByRole("button", { name: "Unarchive link snap.to/bravo", exact: true }).click();
      await expect(toast(page, "Unarchived snap.to/bravo")).toBeVisible();
      expect(api.callsTo("PATCH", "/links/lnk_bravo").map((c) => (c.body as { archived: boolean }).archived)).toEqual([true, false]);
    });

    test("a failed archive shows no success toast, and says so", async ({ page }) => {
      const { api } = await install(page, { failPatch: nestError(500, "Something went wrong on our side.", "Internal Server Error") });
      await page.goto("/links");
      await archiveButton(page, "alpha").click();
      await expect.poll(() => api.callsTo("PATCH", "/links/lnk_alpha").length).toBeGreaterThan(0);

      await expect(toast(page, /^Archived /)).toHaveCount(0);
      await expect(toast(page, /Restored|Unarchived/)).toHaveCount(0);
      /* The link is still there: nothing changed. */
      await expect(rowFor(page, "alpha")).toBeVisible();
      /* ...and the person is told, via the assertive region. */
      await expect(assertive(page).getByTestId("toast")).toContainText("Couldn't archive snap.to/alpha");
    });

    test("a failed Undo says so instead of claiming the link is back", async ({ page }) => {
      await install(page);
      await page.goto("/links");
      await archiveButton(page, "alpha").click();
      const t = toast(page, "Archived snap.to/alpha");
      await expect(t).toBeVisible();
      /* Make only the Undo request fail. */
      await page.route("**/api/v1/links/lnk_alpha", (route) =>
        route.request().method() === "PATCH"
          ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ statusCode: 500, message: "boom", error: "Internal Server Error" }) })
          : route.fallback(),
      );
      await t.getByRole("button", { name: "Undo" }).click();
      await expect(assertive(page).getByTestId("toast")).toContainText("Couldn't restore snap.to/alpha");
      await expect(toast(page, "Restored snap.to/alpha")).toHaveCount(0);
    });

    test("a double click on Archive archives ONE link, not the one that slides under the cursor", async ({ page }) => {
      const { api, store } = await install(page);
      await page.goto("/links");
      await expect(rowFor(page, "alpha")).toBeVisible();

      await archiveButton(page, "alpha").dblclick();
      await expect(rowFor(page, "alpha")).toHaveCount(0);
      /* Give a stray second request time to arrive before asserting there is none. */
      await page.waitForTimeout(600);

      const patches = api.calls.filter((c) => c.method === "PATCH");
      expect(patches.map((p) => p.path)).toEqual(["/links/lnk_alpha"]);
      expect(store.filter((s) => s.archived).map((s) => s.slug)).toEqual(["alpha"]);
      await expect(rowFor(page, "bravo")).toBeVisible();
    });

    test("toasts do not pile up: at most three stay, newest last, each with its own Undo", async ({ page }) => {
      await install(page);
      await page.goto("/links");
      for (const slug of ["alpha", "bravo", "charlie", "delta"] as const) {
        await archiveButton(page, slug).click();
        await expect(rowFor(page, slug)).toHaveCount(0);
        await page.waitForTimeout(80);
      }
      await expect(toastItems(page)).toHaveCount(3);
      await expect(toast(page, "Archived snap.to/alpha")).toHaveCount(0); // the oldest was dropped
      await expect(toastItems(page).last()).toContainText("Archived snap.to/delta");
      await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(3);
    });

    test("a toast dismisses itself, and can be dismissed by hand", async ({ page }) => {
      await install(page);
      await page.goto("/links");
      await archiveButton(page, "alpha").click();
      const t = toast(page, "Archived snap.to/alpha");
      await expect(t).toBeVisible();
      await t.getByRole("button", { name: "Dismiss notification" }).click();
      await expect(t).toHaveCount(0);

      /* ...and an untouched one leaves on its own. */
      await archiveButton(page, "bravo").click();
      await expect(toast(page, "Archived snap.to/bravo")).toBeVisible();
      await expect(toast(page, "Archived snap.to/bravo")).toHaveCount(0, { timeout: 15_000 });
    });

    test("keyboard only: F8 moves focus to the toast, Enter on Undo restores the link", async ({ page }) => {
      test.skip(vp.name !== "desktop", "needs a physical keyboard");
      const { api } = await install(page);
      await page.goto("/links");
      await archiveButton(page, "alpha").focus();
      await page.keyboard.press("Enter");
      await expect(toast(page, "Archived snap.to/alpha")).toBeVisible();

      await page.keyboard.press("F8");
      const undo = toast(page, "Archived snap.to/alpha").getByRole("button", { name: "Undo" });
      await expect(undo).toBeFocused();
      /* Focus is visible (an outline/ring is drawn), not just present. */
      const ring = await undo.evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}`;
      });
      expect(ring).not.toMatch(/^none\|0px\|none$/);

      await page.keyboard.press("Tab");
      await expect(toast(page, "Archived snap.to/alpha").getByRole("button", { name: "Dismiss notification" })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(undo).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => api.callsTo("PATCH", "/links/lnk_alpha").length).toBe(2);
      expect(api.callsTo("PATCH", "/links/lnk_alpha")[1].body).toMatchObject({ archived: false });
      await expect(rowFor(page, "alpha")).toBeVisible();
    });

    test("deleting from the detail page confirms it; a failed delete does not", async ({ page }) => {
      const { api } = await install(page);
      await page.goto("/links/lnk_alpha");
      await page.getByRole("button", { name: "Delete this link" }).click();
      await page.getByRole("button", { name: "Delete for good" }).click();

      await expect(page).toHaveURL(/\/links$/);
      await expect(toast(page, "Deleted snap.to/alpha")).toBeVisible();
      expect(api.callsTo("DELETE", "/links/lnk_alpha")).toHaveLength(1);
      /* Delete is not undoable, so no Undo is offered. */
      await expect(toast(page, "Deleted snap.to/alpha").getByRole("button", { name: "Undo" })).toHaveCount(0);
    });

    test("a failed delete stays on the page with no success toast", async ({ page }) => {
      await install(page, { failDelete: nestError(500, "Something went wrong on our side.", "Internal Server Error") });
      await page.goto("/links/lnk_alpha");
      await page.getByRole("button", { name: "Delete this link" }).click();
      await page.getByRole("button", { name: "Delete for good" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible(); // the page's own inline error
      await expect(page).toHaveURL(/\/links\/lnk_alpha$/);
      await expect(toast(page, /Deleted/)).toHaveCount(0);
    });

    test("creating a link from the detail page's New link drawer confirms it", async ({ page }) => {
      const { api } = await install(page);
      await page.goto("/links/lnk_alpha");
      await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
      const drawer = page.getByRole("dialog", { name: "Create a link" });
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("fresh");
      await drawer.getByRole("button", { name: "Create link" }).click();

      await expect(drawer).toBeHidden();
      await expect(toast(page, "Created snap.to/fresh")).toBeVisible();
      expect(api.callsTo("POST", "/links")).toHaveLength(1);
    });

    test("a refused create shows no success toast and keeps the drawer open", async ({ page }) => {
      await install(page, { failCreate: nestError(409, "That back-half is already taken.", "Conflict") });
      await page.goto("/links");
      await page.getByRole("button", { name: /New link|Create a link/ }).first().click();
      const drawer = page.getByRole("dialog", { name: "Create a link" });
      await drawer.getByLabel("Destination URL").fill("https://example.com/landing");
      await drawer.getByLabel("Short link").fill("alpha");
      await drawer.getByRole("button", { name: "Create link" }).click();

      await expect(drawer.getByText("That back-half is already taken.")).toBeVisible();
      await expect(drawer).toBeVisible();
      await expect(toast(page, /Created/)).toHaveCount(0);
    });

    test("saving an edit from the detail page confirms it", async ({ page }) => {
      const { api } = await install(page);
      await page.goto("/links/lnk_alpha");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: /Edit .+\/alpha/ });
      await drawer.getByPlaceholder("https://acme.com/collections/spring-2026").fill("https://example.com/edited");
      await drawer.getByRole("button", { name: "Save changes" }).click();

      await expect(drawer).toBeHidden();
      await expect(toast(page, "Saved changes to snap.to/alpha")).toBeVisible();
      expect(api.callsTo("PATCH", "/links/lnk_alpha")).toHaveLength(1);
    });

    test("saving Settings confirms it; a refused save does not", async ({ page }) => {
      const { api } = await install(page);
      await page.goto("/settings");
      await page.getByRole("group", { name: "Default redirect type" }).getByRole("button", { name: "307", exact: true }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(toast(page, "Settings saved")).toBeVisible();
      expect(api.callsTo("PATCH", "/workspaces/current")).toHaveLength(1);
    });

    test("a refused Settings save shows no success toast", async ({ page }) => {
      const { api } = await install(page, { failSettings: nestError(400, "That workspace slug is taken.", "Bad Request") });
      await page.goto("/settings");
      await page.getByRole("group", { name: "Default redirect type" }).getByRole("button", { name: "307", exact: true }).click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("That workspace slug is taken.")).toBeVisible();
      expect(api.callsTo("PATCH", "/workspaces/current")).toHaveLength(1);
      await expect(toast(page, "Settings saved")).toHaveCount(0);
    });
  });
}

test.describe("Toasts at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("stay inside the viewport and off the top bar, filters and search", async ({ page }) => {
    await install(page);
    await page.goto("/links");
    await archiveButton(page, "alpha").click();
    await archiveButton(page, "bravo").click();
    await expect(toast(page, "Archived snap.to/bravo")).toBeVisible();

    const vp = page.viewportSize()!;
    const boxes = await toastItems(page).evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.h).toBeLessThanOrEqual(vp.height);
    }
    /* The page's primary controls live at the top: header, filter chips, search.
       Nothing the toast sits on may be one of them. */
    const covered = await page.evaluate(() => {
      const hits: string[] = [];
      const toasts = Array.from(document.querySelectorAll('[data-testid="toast"]')).map((t) => t.getBoundingClientRect());
      const top = Array.from(document.querySelectorAll("header button, header a, header input, main > div button, main input")).filter(
        (el) => !el.closest('[data-testid="toast"]') && !el.closest("article"),
      );
      for (const el of top) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        for (const t of toasts) {
          const overlap = r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top;
          if (overlap) hits.push(`${el.tagName} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}`);
        }
      }
      return hits;
    });
    expect(covered).toEqual([]);
    /* The Undo / Dismiss buttons are big enough to tap. */
    for (const name of ["Undo", "Dismiss notification"]) {
      const b = await toastItems(page).last().getByRole("button", { name }).boundingBox();
      expect(b!.height).toBeGreaterThanOrEqual(32);
      expect(b!.width).toBeGreaterThanOrEqual(32);
    }
  });
});
