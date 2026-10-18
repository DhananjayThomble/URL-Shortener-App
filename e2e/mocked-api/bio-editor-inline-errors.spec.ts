import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession, type MockHandler } from "../support/mock-api";

/* E2E (#788): the /bio editor against the REAL API client, answered by the
   browser-level mock (same wire shapes the NestJS API sends).

   Three things QA saw on the bio page:
     1. the live preview was a hand-drawn phone that did not match the public
        page (different link styling, a different footer);
     2. the avatar for a name with "<" in it showed "Q<";
     3. a bad block URL was reported only in a banner at the top of the page.

   Oracles: UpsertBioPageInput / HttpUrl in packages/contract (a block's href is
   an absolute http(s) URL; the message is "Enter an absolute http(s) URL"); the
   initials rule in packages/domain (letters only); the shared BioPageCard that
   the public page renders. The parity of preview-vs-public-page is asserted in
   e2e/tests/bio-preview-parity.spec.ts (it needs the public route, which this
   lane's server-side existence probe cannot reach).

   Viewports: desktop plus Pixel 7 (CI installs chromium only). */

const SHARED = { id: "dom_shared", domain: "snap.to", status: "live", ssl: "active", links: 3, rootRedirect: null, notFoundRedirect: null, shared: true } as const;

const PAGE_ID = "8f0b1f4e-2d3c-4b8a-9d55-0a1b2c3d4e5f";

function blockOf(id: string, title: string, href: string | null, kind = "link") {
  return { id, kind, title, subtitle: null, metric: null, locked: false, href };
}

function bioPage(name = "QA <User>") {
  return {
    id: PAGE_ID,
    domain: "snap.to",
    slug: "ada",
    status: "draft",
    views: 0,
    clickThrough: null,
    profile: { name, bio: "Notes from the QA pass.", initials: "QU" },
    blocks: [
      blockOf("blk_1", "Latest project", "https://example.com/project"),
      blockOf("blk_2", "Watch the talk", "https://example.com/talk", "embed"),
      blockOf("blk_3", "Follow along", "https://example.com/social", "social"),
    ],
  };
}

async function openEditor(page: Page, name?: string) {
  const stored = bioPage(name);
  // Stateful like the real API: a save is what the next GET returns.
  let current: ReturnType<typeof bioPage> = stored;
  const put: MockHandler = (req) => {
    const body = req.body as { status: string; profile: object; blocks: Array<Record<string, unknown>> };
    current = {
      ...current,
      status: body.status,
      profile: { ...body.profile, initials: "QU" },
      blocks: body.blocks.map((b, i) => ({ ...(b as object), id: (b.id as string) ?? `blk_new_${i}`, metric: null })),
    } as typeof current;
    return { status: 200, body: current };
  };
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": { status: 200, body: [SHARED] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": () => ({ status: 200, body: [current] }),
    "GET /members": { status: 200, body: [] },
    "PUT /bio-pages": put,
  });
  await page.goto("/bio");
  await expect(page.getByLabel("Profile name")).toBeVisible();
  return api;
}

const preview = (page: Page) => page.getByTestId("bio-preview");
const avatar = (page: Page) => preview(page).getByTestId("bio-avatar");
const saveBtn = (page: Page) => page.getByRole("button", { name: "Save changes" });

async function editBlock(page: Page, title: string) {
  await page.getByRole("button", { name: `Edit block “${title}”` }).click();
}

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Bio editor (#788) — ${vp.name}`, () => {
    test.use(vp.use);

    test.describe("avatar initials", () => {
      test("a name with markup shows letters, never the bracket", async ({ page }) => {
        await openEditor(page);
        await expect(avatar(page)).toHaveText("QU");
        await expect(avatar(page)).not.toContainText("<");
      });

      test("follows the name as it is typed: emoji, whitespace, single name, cleared field", async ({ page }) => {
        await openEditor(page);
        const name = page.getByLabel("Profile name");
        for (const [typed, shown] of [
          ["Ada Lovelace", "AL"],
          ["  Grace   Hopper  ", "GH"],
          ["🎉 Ada Lovelace", "AL"],
          ["Demo", "DE"],
          ["🎉", "?"],
          ["<script>", "SC"],
          ["", "?"],
        ] as const) {
          await name.fill(typed);
          await expect(avatar(page), JSON.stringify(typed)).toHaveText(shown);
        }
      });
    });

    test.describe("live preview", () => {
      test("uses the public page's wording and one style for every link", async ({ page }) => {
        await openEditor(page);
        await expect(preview(page).getByText("Built with SnapURL. No cookies are set by this page.")).toBeVisible();
        await expect(page.getByText("Powered by SnapURL")).toHaveCount(0);

        const rows = preview(page).getByTestId("bio-card-blocks").locator("> *");
        await expect(rows).toHaveCount(3);
        const looks = await rows.evaluateAll((els) =>
          els.map((el) => {
            const s = getComputedStyle(el);
            return [s.backgroundColor, s.color, s.borderTopColor, s.fontWeight, s.fontSize].join("|");
          }),
        );
        // The old mock-up filled the first link with the accent colour and
        // left the rest plain; the public page styles every link alike.
        expect(new Set(looks).size).toBe(1);
      });

      test("follows the draft: name, bio, new block titles", async ({ page }) => {
        await openEditor(page);
        await page.getByLabel("Profile name").fill("Acme Studio");
        await page.getByLabel("Profile bio").fill("We make the tools.");
        await expect(preview(page).getByRole("heading", { name: "Acme Studio" })).toBeVisible();
        await expect(preview(page).getByText("We make the tools.")).toBeVisible();
        await editBlock(page, "Latest project");
        await page.getByLabel("Title", { exact: true }).fill("Renamed project");
        await expect(preview(page).getByText("Renamed project")).toBeVisible();
      });

      test("is inert: no link in it can navigate, and a hostile URL is never an href", async ({ page }) => {
        await openEditor(page);
        await editBlock(page, "Latest project");
        await page.getByLabel("URL", { exact: true }).fill("javascript:alert(1)");
        await expect(preview(page).locator("[href]")).toHaveCount(0);
        await expect(preview(page).getByRole("link")).toHaveCount(0);
        // The row is still there, just not clickable.
        await expect(preview(page).getByText("Latest project")).toBeVisible();
      });

      test("renders markup in a title or name as text, never as HTML", async ({ page }) => {
        await openEditor(page);
        const payload = "<img src=x onerror=\"window.__pwned=1\">";
        await page.getByLabel("Profile name").fill(payload);
        await page.getByLabel("Profile bio").fill(payload);
        await editBlock(page, "Latest project");
        await page.getByLabel("Title", { exact: true }).fill(payload);
        await expect(preview(page).getByRole("heading")).toHaveText(payload);
        await expect(preview(page).locator("img")).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
      });
    });

    test.describe("block URL errors", () => {
      test("a bad URL is flagged on its own block, the page is not saved, and the field is focused", async ({ page }) => {
        const api = await openEditor(page);
        await editBlock(page, "Latest project");
        const url = page.getByLabel("URL", { exact: true });
        await url.fill("not a url");
        await saveBtn(page).click();

        const block = page.getByTestId("bio-block").filter({ hasText: "Latest project" });
        await expect(block.getByText("Enter an absolute http(s) URL")).toBeVisible();
        await expect(url).toHaveAttribute("aria-invalid", "true");
        await expect(url).toBeFocused();
        // The message is tied to the field for assistive tech.
        const describedBy = await url.getAttribute("aria-describedby");
        expect(describedBy).toBeTruthy();
        await expect(page.locator(`[id="${describedBy}"]`)).toHaveText("Enter an absolute http(s) URL");
        // The other blocks are not accused.
        await expect(page.getByTestId("bio-block").filter({ hasText: "Watch the talk" }).getByText("Enter an absolute")).toHaveCount(0);
        expect(api.callsTo("PUT", "/bio-pages")).toHaveLength(0);
      });

      test("every bad block is flagged, including ones that were collapsed", async ({ page }) => {
        await openEditor(page);
        for (const [title, href] of [["Latest project", "example.com"], ["Follow along", "javascript:alert(1)"]] as const) {
          await editBlock(page, title);
          await page.getByLabel("URL", { exact: true }).fill(href);
          await page.getByRole("button", { name: `Close block “${title}”` }).click();
        }
        await saveBtn(page).click();
        for (const title of ["Latest project", "Follow along"]) {
          await expect(page.getByTestId("bio-block").filter({ hasText: title }).getByText("Enter an absolute http(s) URL")).toBeVisible();
        }
        await expect(page.getByTestId("bio-block").filter({ hasText: "Watch the talk" }).getByText("Enter an absolute")).toHaveCount(0);
      });

      test("a blank title is flagged on the title field", async ({ page }) => {
        await openEditor(page);
        await editBlock(page, "Latest project");
        const title = page.getByLabel("Title", { exact: true });
        await title.fill("   ");
        await saveBtn(page).click();
        await expect(title).toHaveAttribute("aria-invalid", "true");
        await expect(page.getByTestId("bio-block").getByText(/./).filter({ hasText: /Too small|at least|required|Invalid/i }).first()).toBeVisible();
      });

      test("fixing the URL clears the error and the save goes through", async ({ page }) => {
        const api = await openEditor(page);
        await editBlock(page, "Latest project");
        const url = page.getByLabel("URL", { exact: true });
        await url.fill("nope");
        await saveBtn(page).click();
        await expect(url).toHaveAttribute("aria-invalid", "true");

        await url.fill("https://example.com/fixed");
        await expect(url).not.toHaveAttribute("aria-invalid", "true");
        await expect(page.getByText("Enter an absolute http(s) URL")).toHaveCount(0);

        await saveBtn(page).click();
        await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
        const sent = api.callsTo("PUT", "/bio-pages");
        expect(sent).toHaveLength(1);
        const blocks = (sent[0]!.body as { blocks: { title: string; href: string }[] }).blocks;
        expect(blocks.find((b) => b.title === "Latest project")?.href).toBe("https://example.com/fixed");
      });

      test("Discard drops the errors with the draft", async ({ page }) => {
        await openEditor(page);
        await editBlock(page, "Latest project");
        await page.getByLabel("URL", { exact: true }).fill("nope");
        await saveBtn(page).click();
        await expect(page.getByText("Enter an absolute http(s) URL").first()).toBeVisible();
        await page.getByRole("button", { name: "Discard" }).click();
        await expect(page.getByText("Enter an absolute http(s) URL")).toHaveCount(0);
      });

      test("Publish with a bad URL is refused the same way", async ({ page }) => {
        const api = await openEditor(page);
        await editBlock(page, "Latest project");
        await page.getByLabel("URL", { exact: true }).fill("ftp://example.com/x");
        await page.getByRole("button", { name: "Publish" }).click();
        await expect(page.getByTestId("bio-block").filter({ hasText: "Latest project" }).getByText("Enter an absolute http(s) URL")).toBeVisible();
        expect(api.callsTo("PUT", "/bio-pages")).toHaveLength(0);
      });
    });
  });
}
