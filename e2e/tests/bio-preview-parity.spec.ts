import { devices, expect, test, type Locator } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E (#788): the editor's live preview IS the public page.

   QA saw the /bio preview and the public /b/<domain>/<slug> page differ: other
   button styling (the preview filled the first link with the accent colour) and
   other footer text. Both now render web/src/components/bio/bio-page-card.tsx.

   Oracle: what a visitor sees at /b/snap.to/acme (the seeded live fixture page)
   is the reference; the preview of the same page must read and look the same —
   same text, same avatar, same footer, and every link row styled alike. Only
   the links differ, on purpose: in the editor they are inert.

   Fixtures mode, so both routes read the same in-memory store. Desktop + Pixel 7
   (CI installs chromium only). */

type Look = { text: string; style: string };

const STYLE_PROPS = [
  "backgroundColor",
  "color",
  "borderTopColor",
  "borderTopWidth",
  "borderRadius",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "paddingTop",
  "paddingLeft",
  "textAlign",
] as const;

/** Text and computed look of each part of a rendered bio card. */
async function describeCard(root: Locator) {
  return root.evaluate((el, props) => {
    const look = (node: Element | null): { text: string; style: string } => {
      if (!node) return { text: "<missing>", style: "" };
      const s = getComputedStyle(node);
      return {
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim(),
        style: props.map((p) => `${p}=${(s as unknown as Record<string, string>)[p]}`).join(";"),
      };
    };
    const rows = Array.from(el.querySelectorAll('[data-testid="bio-card-blocks"] > *'));
    const footer = Array.from(el.querySelectorAll("p")).pop() ?? null;
    return {
      avatar: look(el.querySelector('[data-testid="bio-avatar"]')),
      name: look(el.querySelector("h1, h2")),
      bio: look(el.querySelector("header p")),
      rows: rows.map(look),
      footer: look(footer),
    };
  }, STYLE_PROPS as unknown as string[]);
}

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`bio preview parity (#788) — ${vp.name}`, () => {
    test.use(vp.use);

    test("the editor preview reads and looks like the public page", async ({ page, browser }) => {
      // Public page: a signed-out visitor, fresh context.
      const visitor = await browser.newContext({ ...vp.use });
      const pub = await visitor.newPage();
      await pub.goto("/b/snap.to/acme");
      await expect(pub.getByRole("heading", { level: 1, name: "Acme" })).toBeVisible();
      const publicCard = await describeCard(pub.locator("main"));
      await visitor.close();

      // Editor preview of the same page.
      await seedSession(page);
      await page.goto("/bio");
      const preview = page.getByTestId("bio-preview");
      await expect(preview.getByRole("heading", { name: "Acme" })).toBeVisible();
      const previewCard = await describeCard(preview);

      expect(publicCard.rows.length).toBeGreaterThan(1);
      expect(previewCard.avatar).toEqual(publicCard.avatar);
      // The preview is the page's <h2> inside the editor (its <h1> is the page
      // title): same words, same look.
      expect(previewCard.name).toEqual(publicCard.name);
      expect(previewCard.bio).toEqual(publicCard.bio);
      expect(previewCard.footer).toEqual(publicCard.footer);
      expect(previewCard.rows).toEqual(publicCard.rows);
    });

    test("every link row has one look — no accent-filled first button", async ({ page }) => {
      await seedSession(page);
      await page.goto("/bio");
      await expect(page.getByTestId("bio-preview").getByRole("heading", { name: "Acme" })).toBeVisible();
      const card = await describeCard(page.getByTestId("bio-preview"));
      expect(card.rows.length).toBeGreaterThan(1);
      expect(new Set(card.rows.map((r: Look) => r.style)).size).toBe(1);
    });

    test("preview: links are inert, and a hostile URL typed into a block is not a link either", async ({ page }) => {
      await seedSession(page);
      await page.goto("/bio");
      const preview = page.getByTestId("bio-preview");
      await expect(preview.getByRole("heading", { name: "Acme" })).toBeVisible();
      // Five link-ish blocks, all inert: no href anywhere in the preview.
      await expect(preview.locator("[href]")).toHaveCount(0);
      await expect(preview.locator('a[aria-disabled="true"]')).toHaveCount(5);

      await page.getByRole("button", { name: "Edit block “Download the app”" }).click();
      await page.getByLabel("URL", { exact: true }).fill("javascript:alert(1)");
      await expect(preview.locator("[href]")).toHaveCount(0);
      // The row stays, but is no longer a link-styled anchor.
      await expect(preview.getByText("Download the app")).toBeVisible();
      await expect(preview.locator('a[aria-disabled="true"]')).toHaveCount(4);
    });
  });
}
