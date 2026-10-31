import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/* ============================================================================
   Visual-regression determinism contract — issue #869.
   Design: .kiro/specs/visual-regression/design.md §5 (this contract), §2 (the
   nondeterminism inventory each step below defends — row numbers in comments).

   e2e/support/ has NO settle helper today; stabilise() is new and is the single
   most important artefact of the visual lane. Order matters: each screenshot is
   taken only after stabilise(page) resolves.
   ============================================================================ */

/**
 * A fixed UTC instant. Frozen via page.clock.setFixedTime BEFORE navigation so
 * that every Date.now() read — fixture data (daysAgo(), fixtures.ts:59), the
 * "N days ago" labels (utils.ts), the footer year (site-footer.tsx) and the 24h
 * analytics buckets (fixtures.ts) — resolves to the same value on every run
 * (design §2 rows #3/#4/#7/#8).
 *
 * CHANGING THIS CONSTANT REWRITES EVERY BASELINE. Treat it as part of the
 * baseline contract, not a tunable.
 */
export const VISUAL_EPOCH = new Date("2026-01-15T09:00:00Z");

/**
 * The appearance object seeded into localStorage before first paint.
 *
 * DEFAULT_APPEARANCE.mode is "" ("follow the OS"), which makes an unseeded theme
 * environment-dependent — CI and a laptop resolve prefers-color-scheme
 * differently (design §2 row #16). We also pin --accent, --density (scales
 * padding) and --radius (corner geometry everywhere) so none of them is read
 * from a stray localStorage value (row #17). Per-project colorScheme in the
 * config picks light/dark; "mode" stays "" here so the project's colorScheme is
 * what resolves, matching how the app follows the OS. reduceMotion is pinned on
 * so the pre-paint script adds the reduce-motion class (belt-and-braces with the
 * config's reducedMotion:"reduce").
 */
const SEED_APPEARANCE = {
  accent: "Cobalt",
  mode: "" as const,
  density: "1",
  radius: "9px",
  reduceMotion: true,
};

const APPEARANCE_KEY = "snapurl.appearance";

/**
 * Pin the saved appearance via addInitScript so it is present before the
 * pre-paint script in app/layout.tsx reads it (design §5, §2 rows #16/#17).
 * Must be called before the first navigation.
 */
export async function seedAppearance(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [APPEARANCE_KEY, JSON.stringify(SEED_APPEARANCE)] as const,
  );
}

/**
 * The determinism gate. Call immediately before every screenshot. Each step is
 * annotated with the design §2 row it defends.
 */
export async function stabilise(page: Page): Promise<void> {
  // 1. No animate-pulse skeleton remains. A skeleton in frame means content
  //    never loaded (design §2 rows #12, #26 — the 120ms fixture latency).
  await expect(page.locator(".animate-pulse")).toHaveCount(0);

  // 2. No toast present. The toast timer is Date.now()-based, pauses on hover,
  //    and sets --toast-inset on the root, which changes total page height
  //    (design §2 row #13; toast.tsx:162-169, :69-79).
  await expect(page.locator('[data-testid="toast"]')).toHaveCount(0);

  // 3. If a chart is present, its rendered <path> must be visible. The recharts
  //    ResponsiveContainer renders nothing on first pass, then emits path coords
  //    from a measured width (design §2 rows #9/#10; charts/index.tsx:85,:98).
  const chartPath = page.locator(".recharts-surface path, svg.recharts-surface path").first();
  if ((await chartPath.count()) > 0) {
    await expect(chartPath).toBeVisible();
  }

  // 4. If a QR container is present, wait for it to actually COMPOSE its SVG.
  //    qr-preview.tsx starts from svg="" and injects the markup asynchronously
  //    via dangerouslySetInnerHTML, so the container mounts with NO <svg> child
  //    and a blank first frame; the child appears only once composition finishes
  //    (design §2 row #21; qr/qr-preview.tsx:25-26, :70-72 —
  //    data-testid="qr-preview"). Waiting for the composed <svg> to be visible is
  //    what rules out capturing the blank frame — a bare "element exists" check
  //    would pass on that blank frame.
  const qr = page.locator('[data-testid="qr-preview"]');
  if ((await qr.count()) > 0) {
    await expect(qr.locator("svg")).toBeVisible();
  }

  // 5. Fonts loaded. document.fonts.ready resolves once every @font-face used on
  //    the page is ready (design §5 step 5). With fonts now self-hosted via
  //    next/font/local (#867) this resolves on real faces, not a fallback.
  await page.evaluate(() => document.fonts.ready);

  // 6. Two requestAnimationFrames so layout and ResizeObserver effects have
  //    flushed. TableWrap renders from *measured* overflow and its first paint is
  //    always overflow=false; a ±1px width change flips the edge fade, the
  //    "Scroll →" pill and the sticky-column shadow together (design §2 row #19;
  //    ui/index.tsx:393-418).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
