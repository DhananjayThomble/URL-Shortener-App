import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #785 — at phone widths the New link drawer's tabs ran together
   ("DestinationRouting", "Social previewQR"), the short-link domain select was
   clipped by the slug field, and the Links page's filter chips spilled out of
   the page.

   What is asserted is geometry measured in a real browser, not that the page
   rendered: every tab is its own box with a gap to its neighbour (no overlap)
   and a >= 24px tap target, a tab scrolled out of view can still be reached and
   activated by a real click, the domain select either shows its whole value or
   truncates it with an ellipsis (and still selects), the slug field keeps a
   usable width, the footer's Create link button keeps a >= 16px gutter, and
   neither page overflows horizontally. Runs at the narrowest phones people
   have (360), the QA width (390) and a large phone (412).

   Chromium only (CI installs nothing else): the three widths are applied to the
   Pixel 7 descriptor. iPhone 15 (WebKit) is covered as local evidence. */

const { defaultBrowserType: _engine, ...PIXEL_7 } = devices["Pixel 7"];

/** A verified custom domain long enough to overflow a phone-width select. */
const LONG_DOMAIN = "go.marketing-campaigns.international-division.example-company.co.uk";

const domain = (id: string, name: string, shared = false) => ({
  id,
  domain: name,
  status: "live",
  ssl: "active",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  shared,
  dns: null,
});

async function signedIn(page: Page, domains: ReturnType<typeof domain>[]) {
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": { status: 200, body: { ...MOCK_WORKSPACE, defaultDomain: domains[0]!.domain } },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /domains": { status: 200, body: domains },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /members": { status: 200, body: [] },
  });
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
}

type Box = { x: number; y: number; width: number; height: number };
async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}
const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;
const overlaps = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** The page itself must never scroll sideways (a scrolling TAB STRIP inside it is fine). */
async function expectNoPageOverflow(page: Page) {
  const m = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
  }));
  expect(m.scroll, "document scrollWidth vs viewport").toBeLessThanOrEqual(m.client);
  expect(m.bodyScroll, "body scrollWidth vs viewport").toBeLessThanOrEqual(m.client);
}

for (const width of [360, 390, 412]) {
  test.describe(`${width}px phone (#785)`, () => {
    test.use({ ...PIXEL_7, viewport: { width, height: 844 } });

    test("filter chips stay inside the page, do not overlap and are tappable", async ({ page }) => {
      await signedIn(page, [domain("d1", "snap.to", true)]);
      await page.goto("/links");
      const chips = page.getByRole("button", { name: /^(All|Active|Scheduled|Expiring|Expired|Archived)$/ });
      await expect(chips).toHaveCount(6);
      await expectNoPageOverflow(page);

      const boxes: Box[] = [];
      for (let i = 0; i < 6; i++) boxes.push(await box(chips.nth(i)));
      for (const [i, b] of boxes.entries()) {
        expect(b.x, `chip ${i} left edge`).toBeGreaterThanOrEqual(0);
        expect(right(b), `chip ${i} right edge inside viewport`).toBeLessThanOrEqual(width);
        expect(b.width, `chip ${i} width`).toBeGreaterThanOrEqual(24);
        expect(b.height, `chip ${i} height`).toBeGreaterThanOrEqual(24);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `chip ${i} overlaps chip ${j}`).toBe(false);
      }

      // Real click -> observable effect.
      await chips.nth(3).click();
      await expect(chips.nth(3)).toHaveAttribute("aria-pressed", "true");
      await expect(chips.nth(0)).toHaveAttribute("aria-pressed", "false");
    });

    test("drawer tabs are separated, never overlap, and every tab can be activated", async ({ page }) => {
      await signedIn(page, [domain("d1", "snap.to", true)]);
      await page.goto("/links?new=https%3A%2F%2Fexample.com%2Fspring");
      const drawer = page.getByRole("dialog", { name: "Create a link" });
      await expect(drawer).toBeVisible();
      await expectNoPageOverflow(page);

      const tabs = drawer.getByRole("tab");
      const names = ["Destination", "Routing", "Access", "UTM", "Social preview", "QR"];
      await expect(tabs).toHaveCount(names.length);

      // The strip is a scroller: a tab may be off-screen, so geometry between
      // NEIGHBOURS is compared in the strip's own coordinate space.
      const boxes: Box[] = [];
      for (let i = 0; i < names.length; i++) boxes.push(await box(tabs.nth(i)));
      for (const [i, b] of boxes.entries()) {
        expect(b.width, `${names[i]} tab width`).toBeGreaterThanOrEqual(24);
        expect(b.height, `${names[i]} tab height`).toBeGreaterThanOrEqual(24);
      }
      for (let i = 0; i + 1 < boxes.length; i++) {
        const gap = boxes[i + 1]!.x - right(boxes[i]!);
        expect(overlaps(boxes[i]!, boxes[i + 1]!), `${names[i]} overlaps ${names[i + 1]}`).toBe(false);
        // "DestinationRouting" is what a 1px gap looks like: demand real air between labels.
        expect(gap, `gap between ${names[i]} and ${names[i + 1]}`).toBeGreaterThanOrEqual(4);
      }

      // The first tab starts inside the drawer's 16px gutter, not on the screen edge.
      expect(boxes[0]!.x, "first tab left gutter").toBeGreaterThanOrEqual(16);

      // Every tab is reachable by a real click (Playwright scrolls the strip) and shows its panel.
      for (const name of names) {
        await tabs.filter({ hasText: new RegExp(`^${name}`) }).click();
        await expect(drawer.getByRole("tab", { name: new RegExp(`^${name}`), selected: true })).toBeVisible();
        await expect(drawer.getByRole("tabpanel")).toBeVisible();
        await expectNoPageOverflow(page);
      }
    });

    test("domain select shows its value (or an ellipsis), stays selectable and leaves the slug field room", async ({ page }) => {
      await signedIn(page, [domain("d2", LONG_DOMAIN), domain("d1", "snap.to", true)]);
      await page.goto("/links?new=https%3A%2F%2Fexample.com%2Fspring");
      const drawer = page.getByRole("dialog", { name: "Create a link" });
      await expect(drawer).toBeVisible();

      const select = drawer.getByRole("combobox", { name: "Short-link domain" });
      const slug = drawer.getByLabel("Short link", { exact: true });
      await expect(select).toHaveValue(LONG_DOMAIN);
      await expectNoPageOverflow(page);

      const s = await box(select);
      const sl = await box(slug);
      expect(s.x, "select left gutter").toBeGreaterThanOrEqual(16);
      expect(right(sl), "slug field right gutter").toBeLessThanOrEqual(width - 16);
      expect(overlaps(s, sl), "select overlaps slug field").toBe(false);
      expect(sl.width, "slug field keeps a usable width").toBeGreaterThanOrEqual(120);

      // The value is either wholly visible or deliberately truncated with an ellipsis.
      const fit = await select.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { clipped: el.scrollWidth > el.clientWidth, ellipsis: cs.textOverflow === "ellipsis", title: el.getAttribute("title") };
      });
      expect(fit.clipped ? fit.ellipsis : true, "a clipped select value must carry text-overflow: ellipsis").toBe(true);
      // The full value stays discoverable even when truncated.
      expect(fit.title ?? LONG_DOMAIN).toBe(LONG_DOMAIN);

      // Selecting still works and the slug field is still typeable afterwards.
      await select.selectOption("snap.to");
      await expect(select).toHaveValue("snap.to");
      await slug.fill("spring-sale");
      await expect(slug).toHaveValue("spring-sale");
      await select.selectOption(LONG_DOMAIN);
      await expect(select).toHaveValue(LONG_DOMAIN);
      await expectNoPageOverflow(page);
    });

    test("footer buttons keep a 16px gutter from the screen edge", async ({ page }) => {
      await signedIn(page, [domain("d1", "snap.to", true)]);
      await page.goto("/links?new=https%3A%2F%2Fexample.com%2Fspring");
      const drawer = page.getByRole("dialog", { name: "Create a link" });
      await expect(drawer).toBeVisible();
      const create = await box(drawer.getByRole("button", { name: "Create link" }));
      const cancel = await box(drawer.getByRole("button", { name: "Cancel" }));
      expect(right(create), "Create link right gutter").toBeLessThanOrEqual(width - 16);
      expect(overlaps(create, cancel), "Cancel overlaps Create link").toBe(false);
      expect(create.height).toBeGreaterThanOrEqual(24);
      await expectNoPageOverflow(page);
    });
  });
}
