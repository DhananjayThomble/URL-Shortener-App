import { expect, test } from "@playwright/test";

/* Landing hero trust-row spacing on narrow screens (#726, part of #722).

   The hero trust badges ("No tracking cookies" / "Export everything, always" /
   "Free tier that doesn't shrink") render in a centred flex-wrap row. With the
   original fixed `gap-[26px]`, on a 360px phone the 26px inter-item gap forces
   all three badges onto their OWN line each — three stacked rows with large
   vertical gaps (the P3 cosmetic bug). The fix tightens the gap below `sm`
   (`gap-x-4 gap-y-2 sm:gap-[26px]`) so the badges pack onto at most two lines,
   while desktop (>= sm) keeps the original 26px gap untouched.

   This asserts the rendered layout, not a class string: it counts the number
   of distinct vertical positions (lines) the three badges occupy at 360px.
   FAILS on the pre-fix code (3 lines) and PASSES on the fix (<= 2 lines).
   Public page — no session needed. Fixtures mode. */

const BADGES = [
  "No tracking cookies",
  "Export everything, always",
  "Free tier that doesn't shrink",
];

test.describe("landing hero trust row (#726)", () => {
  test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });

  test("the three trust badges wrap to at most two lines on a 360px viewport", async ({ page }) => {
    await page.goto("/");

    const tops: number[] = [];
    for (const label of BADGES) {
      const badge = page.getByText(label, { exact: true });
      await expect(badge).toBeVisible();
      const b = await badge.boundingBox();
      expect(b, `badge "${label}" has a rendered box`).not.toBeNull();
      // Round to tolerate sub-pixel baseline differences within one line.
      tops.push(Math.round(b!.y));
    }

    const lines = new Set(tops);
    expect(
      lines.size,
      `trust badges occupy ${lines.size} lines (tops=${tops.join(",")}); expected <= 2`,
    ).toBeLessThanOrEqual(2);
  });

  test("the hero does not scroll horizontally on a 360px viewport", async ({ page }) => {
    await page.goto("/");
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    expect(
      scrollW,
      `landing page overflows: scrollWidth ${scrollW} > clientWidth ${clientW}`,
    ).toBeLessThanOrEqual(clientW + 1);
  });
});
