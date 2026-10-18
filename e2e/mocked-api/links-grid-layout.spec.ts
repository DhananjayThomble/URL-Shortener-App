import { devices, expect, test, type Page, type TestInfo } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#787): the Links page Grid view.

   Reported: a slug wrapped mid-word ("qa-" / "full"), the destination was clipped
   with no ellipsis, and a card was taller than its content (a wrapped slug in one
   card stretched its neighbour, leaving a gap).

   Oracles are MEASURED from the rendered DOM, not "the page rendered":
     - nothing overflows horizontally (document and every card);
     - the short link (domain/slug) is a single line and, when too long, is cut by an
       ellipsis rather than wrapped — its full value is in `title`;
     - the destination is a single line that starts at the host (the START is the part
       that stays visible), is cut at the END by an ellipsis, and carries the full URL
       in `title`;
     - a card has no empty band under its content, and no card is taller than a
       one-line slug + one-line destination row allows.

   Mocked-API lane: layout only, the stand-in API serves the list. */

const NOW = "2026-01-01T00:00:00.000Z";

const LONG_DEST =
  "https://www.example-company.com/products/category/very-long-product-name-that-goes-on/and-on?utm_source=newsletter&utm_medium=email&utm_campaign=spring-sale-2026";

const LINKS: Array<{ slug: string; destination: string; tags?: string[] }> = [
  { slug: "qa-full", destination: LONG_DEST, tags: ["campaign", "spring-sale"] },
  { slug: "qa-full-campaign-spring-sale-2026-extended-edition-landing-page", destination: LONG_DEST, tags: ["a-rather-long-tag-name", "another-long-tag"] },
  { slug: "a", destination: "https://example.com" },
  { slug: "Mixed_Case.slug-v2", destination: "http://münchen.example.de/straße/ünïcode/路径/😀", tags: ["x"] },
  { slug: "x".repeat(60), destination: `https://example.com/${"p".repeat(120)}` },
  { slug: "short", destination: `https://${"very-long-subdomain-".repeat(6)}example.com/` },
];

function row(i: number, l: (typeof LINKS)[number]) {
  return {
    id: `lnk_${i}`,
    domain: "snap.to",
    slug: l.slug,
    destination: l.destination,
    tags: l.tags ?? [],
    clicks: 1234 * (i + 1),
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
    sparkline: Array.from({ length: 30 }, (_, k) => (k * (i + 2)) % 9),
    createdAt: NOW,
    status: "active",
  };
}

async function installApi(page: Page): Promise<void> {
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  await mockApi(page, {
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
    "GET /links": () => {
      const items = LINKS.map((l, i) => row(i, l));
      return { status: 200, body: { items, total: items.length, nextCursor: null } };
    },
  });
}

type CardMeasure = {
  slug: string;
  cardW: number;
  cardH: number;
  cardScrollW: number;
  contentH: number;
  slugLines: number;
  slugOverflowing: boolean;
  slugEllipsis: boolean;
  slugTitle: string | null;
  slugText: string;
  destText: string;
  destLines: number;
  destOverflowing: boolean;
  destEllipsis: boolean;
  destTitle: string | null;
  destLeftClip: number;
  lineH: number;
};

async function measure(page: Page): Promise<{ docOverflow: number; cards: CardMeasure[] }> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("article")).map((a) => {
      const link = a.querySelector<HTMLAnchorElement>('a[href^="/links/"]')!;
      const slugEl = link.querySelector<HTMLElement>("[data-slot='slug']")!;
      const dest = a.querySelector<HTMLElement>("[data-slot='destination']")!;
      const inner = a.firstElementChild as HTMLElement;
      const lineOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height;
      const rectsOf = (el: HTMLElement) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const tops = new Set(
          Array.from(r.getClientRects())
            .filter((c) => c.width > 0)
            .map((c) => Math.round(c.top)),
        );
        return tops.size;
      };
      const textEl = dest.querySelector<HTMLElement>("[data-slot='destination-text']")!;
      const aRect = a.getBoundingClientRect();
      const dRect = textEl.getBoundingClientRect();
      return {
        slug: slugEl.textContent ?? "",
        cardW: aRect.width,
        cardH: aRect.height,
        cardScrollW: a.scrollWidth,
        contentH: inner.getBoundingClientRect().height,
        slugLines: rectsOf(slugEl),
        slugOverflowing: slugEl.scrollWidth > slugEl.clientWidth + 1,
        slugEllipsis: getComputedStyle(slugEl).textOverflow === "ellipsis",
        slugTitle: link.getAttribute("title") ?? slugEl.getAttribute("title"),
        slugText: slugEl.textContent ?? "",
        destText: textEl.textContent ?? "",
        destLines: rectsOf(textEl),
        destOverflowing: textEl.scrollWidth > textEl.clientWidth + 1,
        destEllipsis: getComputedStyle(textEl).textOverflow === "ellipsis",
        destTitle: textEl.getAttribute("title") ?? dest.getAttribute("title"),
        destLeftClip: Math.max(0, aRect.left - dRect.left) + textEl.scrollLeft,
        lineH: lineOf(slugEl),
      };
    });
    return { docOverflow: document.documentElement.scrollWidth - window.innerWidth, cards };
  });
}

const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];

/* Viewport-only screenshots (never full-page). Set QA_SHOTS_DIR to keep them as evidence;
   otherwise they go to the test's own output dir like any other artifact. */
const shotPath = (info: TestInfo, name: string) =>
  process.env.QA_SHOTS_DIR ? `${process.env.QA_SHOTS_DIR}/${name}` : info.outputPath(name);
const VIEWPORTS = [
  { name: "390", use: { ...pixel7, viewport: { width: 390, height: 844 } } },
  { name: "pixel7-412", use: pixel7 },
  { name: "768", use: { viewport: { width: 768, height: 1024 } } },
  { name: "1440", use: { viewport: { width: 1440, height: 900 } } },
] as const;

/* Tallest a card may be: header + destination (+ footer in the grid card) at one line each.
   On a phone the touch actions add a wrapped line. Anything taller means a slug or
   destination wrapped, or a hidden control opened a gap. */
const MAX_CARD_H = { grid: { wide: 150, phone: 190 } } as const;

for (const view of ["grid", "list"] as const) {
for (const vp of VIEWPORTS) {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(`Links ${view} layout — ${vp.name} — ${scheme}`, () => {
      test.use({ ...vp.use, colorScheme: scheme });

      test("slug stays on one line, destination keeps its host, cards have no gap", async ({ page }, info) => {
        await installApi(page);
        await page.goto("/links");
        if (view === "grid") await page.getByRole("button", { name: "Grid", exact: true }).click();
        await expect(page.locator("article")).toHaveCount(LINKS.length);
        /* The list opens its first row on its own; close it so every card is measured collapsed. */
        const open = page.getByRole("button", { name: "Hide routing" });
        if (await open.count()) await open.first().click();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: shotPath(info, `${view}-${vp.name}-${scheme}.png`) });

        const { docOverflow, cards } = await measure(page);
        info.attach("measurements", { body: JSON.stringify(cards, null, 2), contentType: "application/json" });
        expect.soft(docOverflow, "document scrolls horizontally").toBeLessThanOrEqual(0);
        expect.soft(cards).toHaveLength(LINKS.length);

        cards.forEach((c, i) => {
          const l = LINKS[i];
          const tag = `card ${i} (${l.slug.slice(0, 20)})`;
          expect.soft(c.cardScrollW, `${tag}: card overflows horizontally`).toBeLessThanOrEqual(c.cardW + 1);

          /* Slug: one line; never wrapped mid-word. When it does not fit it is cut by an ellipsis. */
          expect.soft(c.slugLines, `${tag}: short link wrapped onto ${c.slugLines} lines`).toBe(1);
          expect.soft(c.slugText.includes(l.slug), `${tag}: slug text is complete in the DOM`).toBe(true);
          if (c.slugOverflowing) expect.soft(c.slugEllipsis, `${tag}: clipped slug has no ellipsis`).toBe(true);
          expect.soft(c.slugTitle ?? "", `${tag}: full short link available on hover`).toContain(l.slug);

          /* Destination: one line, starts at the host, cut at the END, full value in title. */
          const shown = l.destination.replace(/^https?:\/\//, "");
          expect.soft(c.destLines, `${tag}: destination wrapped`).toBe(1);
          expect.soft(c.destText.startsWith(shown), `${tag}: destination text starts with the host`).toBe(true);
          expect.soft(c.destLeftClip, `${tag}: destination clipped on the left`).toBe(0);
          if (c.destOverflowing) expect.soft(c.destEllipsis, `${tag}: clipped destination has no ellipsis`).toBe(true);
          expect.soft(c.destTitle, `${tag}: full destination available on hover`).toBe(l.destination);

          /* No gap: nothing under the content, and one line each for slug and destination. */
          expect.soft(c.cardH - c.contentH, `${tag}: empty band under the content`).toBeLessThanOrEqual(2);
        });

        /* No card is taller than the tallest a one-line-slug + one-line-destination card can be
           (chips/actions may add a wrapped actions line on a phone). */
        const heights = cards.map((c) => c.cardH);
        /* Card height is asserted for the grid only. The list row still wraps its
           hover-only actions onto an invisible second line beside a long slug —
           the same kind of gap, reported separately (see the PR). */
        if (view === "grid") {
          const cap = MAX_CARD_H.grid[vp.name === "1440" || vp.name === "768" ? "wide" : "phone"];
          for (const h of heights) expect.soft(h, `card height ${h}`).toBeLessThanOrEqual(cap);
        }
      });
    });
  }
}
}

/* A card opened in the grid must not stretch the card beside it into an empty band,
   and the grid must not open a card by itself (the list's first-row default leaked in). */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`Links grid expand — 1440 — ${scheme}`, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });

    test("opening one card leaves its neighbour's height alone; none starts open", async ({ page }, info) => {
      await installApi(page);
      await page.goto("/links");
      await page.getByRole("button", { name: "Grid", exact: true }).click();
      const cards = page.locator("article");
      await expect(cards).toHaveCount(LINKS.length);
      /* The slug link keeps one unbroken accessible name ("snap.to/qa-full", not "snap.to/ qa-full"). */
      await expect(cards.nth(0).getByRole("link", { name: "snap.to/qa-full", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Hide routing" })).toHaveCount(0);

      const before = await cards.nth(1).boundingBox();
      await cards.nth(0).getByRole("button", { name: "Show routing" }).click();
      await expect(cards.nth(0).getByText("Routing chain")).toBeVisible();
      await page.mouse.move(0, 0);
      await page.screenshot({ path: shotPath(info, `grid-expanded-1440-${scheme}.png`) });
      const after = await cards.nth(1).boundingBox();
      expect(after!.height, "neighbour card was stretched by the open card").toBeCloseTo(before!.height, 0);
    });
  });
}

/* The row actions still work after the grid card's re-layout (observable effect, not "rendered"). */
test("grid card: Copy writes the short link, Duplicate and Archive hit the API", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  const calls: string[] = [];
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": () => ({ status: 200, body: { items: [row(0, LINKS[0])], total: 1, nextCursor: null } }),
    "POST /links/lnk_0/clone": () => {
      calls.push("clone");
      return { status: 201, body: row(9, LINKS[0]) };
    },
    "PATCH /links/lnk_0": () => {
      calls.push("archive");
      return { status: 200, body: { ...row(0, LINKS[0]), status: "archived" } };
    },
  });
  await page.goto("/links");
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  const card = page.locator("article");
  await card.hover();
  await card.getByRole("button", { name: /^Copy short link/ }).click();
  await expect(card.getByText("✓ copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("snap.to/qa-full");
  await card.getByRole("button", { name: /^Duplicate link/ }).click();
  await expect.poll(() => calls).toContain("clone");
  await card.getByRole("button", { name: /^Archive link/ }).click();
  await expect.poll(() => calls).toContain("archive");
});
