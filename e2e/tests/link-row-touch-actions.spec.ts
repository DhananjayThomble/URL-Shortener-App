import { expect, test, type Locator } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #659 (a11y): the per-row Copy / Duplicate / Archive actions in
   web/src/components/links/link-row.tsx are revealed with
   `opacity-0 group-hover:opacity-100 ... transition-opacity`. Touch devices
   cannot hover (matchMedia('(hover: hover)') is false), so the actions stay at
   opacity 0 and are unusable. The fix forces opacity:1 on hover-less devices
   via a `@media (hover: none)` rule while preserving the hover-reveal on
   pointer (desktop) devices.

   This spec drives the fix TDD-style: with touch emulation (isMobile+hasTouch)
   at the two verified viewports (Pixel 7 412x839 and 393x852) it asserts the
   Copy and Duplicate buttons have non-zero EFFECTIVE computed opacity and are
   clickable. A desktop regression guard then confirms the actions remain
   hover-only (opacity 0 at rest) on hover-capable devices.

   NOTE: Playwright's toBeVisible() does NOT treat opacity:0 as hidden, so we
   read the effective opacity from getComputedStyle (walking the element and its
   ancestors, multiplying each opacity) rather than relying on toBeVisible. */

/** Effective opacity = product of the element's own computed opacity and that
    of every ancestor up to <html>. Mirrors how the browser composites it. */
async function effectiveOpacity(locator: Locator): Promise<number> {
  return locator.evaluate((start) => {
    let node: Element | null = start as Element;
    let acc = 1;
    while (node) {
      const o = Number.parseFloat(getComputedStyle(node).opacity);
      if (!Number.isNaN(o)) acc *= o;
      node = node.parentElement;
    }
    return acc;
  });
}

/** The exact buttons from link-row.tsx, by accessible name. Scope to the first
    seeded row so a hover on a different row cannot leak into the assertion. */
function rowActions(page: import("@playwright/test").Page) {
  return {
    copy: page.getByRole("button", { name: /^Copy short link / }).first(),
    duplicate: page.getByRole("button", { name: /^Duplicate link / }).first(),
  };
}

async function gotoLinks(page: import("@playwright/test").Page) {
  await seedSession(page);
  await page.goto("/links");
  await expect(page).toHaveURL(/\/links$/);
}

for (const viewport of [
  { width: 412, height: 839 }, // Pixel 7
  { width: 393, height: 852 },
]) {
  test.describe(`touch devices (${viewport.width}x${viewport.height}) reveal the row actions`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test("Copy and Duplicate are visible, non-zero opacity, and clickable", async ({ page, context }) => {
      // onCopy writes to navigator.clipboard; grant the permission so the click
      // can round-trip to the "✓ copied" state. (Clipboard behavior itself is
      // out of scope — issue #641 — this only exercises that the button is
      // reachable and responds on a touch device.)
      await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
      await gotoLinks(page);

      // Precondition: this emulated device genuinely cannot hover, so the
      // group-hover reveal would never fire — exactly issue #659's trigger.
      const canHover = await page.evaluate(() => window.matchMedia("(hover: hover)").matches);
      expect(canHover, "touch emulation reports no hover capability").toBe(false);

      const { copy, duplicate } = rowActions(page);

      await expect(copy).toBeVisible();
      await expect(duplicate).toBeVisible();

      expect(await effectiveOpacity(copy), "Copy short link effective opacity").toBeGreaterThan(0);
      expect(await effectiveOpacity(duplicate), "Duplicate link effective opacity").toBeGreaterThan(0);

      // Clickable: Copy toggles to its copied state; Duplicate is enabled.
      await expect(duplicate).toBeEnabled();
      await copy.click();
      await expect(copy).toHaveText(/✓ copied/);
    });
  });
}

test.describe("hover-capable devices keep the row actions hover-only (regression guard)", () => {
  // Default project is Desktop Chrome (no isMobile/hasTouch) — a pointer device
  // that CAN hover. The fix must not make the actions always-visible here.
  test("Copy and Duplicate are present but at opacity 0 until hover", async ({ page }) => {
    await gotoLinks(page);

    const canHover = await page.evaluate(() => window.matchMedia("(hover: hover)").matches);
    expect(canHover, "desktop reports hover capability").toBe(true);

    const { copy, duplicate } = rowActions(page);

    // Present in the DOM (attached) but hidden by opacity 0 at rest.
    await expect(copy).toBeAttached();
    await expect(duplicate).toBeAttached();

    expect(await copy.evaluate((el) => getComputedStyle(el).opacity), "Copy opacity at rest").toBe("0");
    expect(
      await duplicate.evaluate((el) => getComputedStyle(el).opacity),
      "Duplicate opacity at rest",
    ).toBe("0");
  });
});
