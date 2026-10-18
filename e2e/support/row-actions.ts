import { expect, type Locator, type Page } from "@playwright/test";

/* Geometry helpers for #786: "every row action is visible without horizontal
   scrolling, and clickable".

   Playwright's locator.click() scrolls the target into view first, which would
   MASK a button that sits in the overflowing part of a table. So these helpers
   measure where the control really is and click the real pixel with the mouse,
   with no scrolling in between. */

export type Rect = { left: number; right: number; top: number; bottom: number };

export type Reach = {
  /** Button box is inside the table's scroll container and inside the viewport. */
  inside: boolean;
  /** The topmost element at the button's centre is the button itself (or a child). */
  hit: boolean;
  box: Rect | null;
  scroller: Rect | null;
  viewportWidth: number;
};

/** The TableWrap scroll container (role=region, overflow-x-auto) that holds `el`. */
function scrollerOf(el: Locator): Locator {
  return el.locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]");
}

export async function reach(el: Locator): Promise<Reach> {
  const box = await el.boundingBox();
  const scroller = await scrollerOf(el).boundingBox();
  const viewportWidth = el.page().viewportSize()?.width ?? 0;
  const hit = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === n || n.contains(top));
  });
  const rect = (b: { x: number; y: number; width: number; height: number } | null): Rect | null =>
    b ? { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height } : null;
  const bx = rect(box);
  const sx = rect(scroller);
  const inside =
    !!bx &&
    !!sx &&
    bx.left >= sx.left - 1 &&
    bx.right <= sx.right + 1 &&
    bx.left >= -1 &&
    bx.right <= viewportWidth + 1;
  return { inside, hit, box: bx, scroller: sx, viewportWidth };
}

/** Assert `el` is fully visible where it stands (no scrolling) and that the pixel at its centre is the control. */
export async function expectReachable(el: Locator, what: string): Promise<void> {
  await expect(el, `${what}: attached`).toBeAttached();
  const r = await reach(el);
  expect(r.inside, `${what}: inside the table's visible area ${JSON.stringify(r)}`).toBe(true);
  expect(r.hit, `${what}: nothing covers it ${JSON.stringify(r)}`).toBe(true);
}

/** Click the control with a real mouse press at its centre. NO scrollIntoView, so a clipped control fails here. */
export async function clickInPlace(page: Page, el: Locator, what: string): Promise<void> {
  await expectReachable(el, what);
  const box = (await el.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** The page itself must not scroll sideways (a wider-than-viewport table would). */
export async function expectNoPageOverflow(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(o.sw, `page scrollWidth ${o.sw} > viewport ${o.iw}`).toBeLessThanOrEqual(o.iw + 1);
}

/** Scroll the table's scroller fully to the right (the position that used to hide the first columns instead). */
export async function scrollTableEnd(el: Locator): Promise<void> {
  await scrollerOf(el).evaluate((n) => {
    (n as HTMLElement).scrollLeft = (n as HTMLElement).scrollWidth;
  });
}

export async function scrollTableStart(el: Locator): Promise<void> {
  await scrollerOf(el).evaluate((n) => {
    (n as HTMLElement).scrollLeft = 0;
  });
}

/** The Actions column header must line up with the cells under it (both share the sticky right edge). */
export async function expectHeaderAlignsWithCells(header: Locator, cell: Locator, what: string): Promise<void> {
  const h = await header.boundingBox();
  const c = await cell.boundingBox();
  expect(h && c, `${what}: header and cell measured`).toBeTruthy();
  expect(Math.abs(h!.x - c!.x), `${what}: header x ${h!.x} vs cell x ${c!.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(h!.width - c!.width), `${what}: header w ${h!.width} vs cell w ${c!.width}`).toBeLessThanOrEqual(1);
}
