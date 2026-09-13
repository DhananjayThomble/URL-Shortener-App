import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E (mobile viewport): DC3 responsive-tables fix. On the /team page the
   Members table and the "What each role can do" permission matrix are wider
   than a phone viewport (the shared <Table/> carries a min-width). Before the
   fix their right-hand columns (Members' "Links"; the matrix's "Admin"/"Owner")
   were silently CLIPPED off the right edge with no scroll affordance, so the
   data was unreachable and undiscoverable on a phone.

   The fix keeps the existing horizontal scroller (TableWrap's overflow-x-auto)
   and adds a mobile-only affordance (right-edge fade + "Scroll →" hint) shown
   only while there is more content to the right. This spec proves, at a 390px
   iPhone-class viewport, that:
     (1) the wide-table wrapper is genuinely horizontally scrollable,
     (2) the affordance ("Scroll →") is shown while columns remain off-screen,
     (3) the right-most columns are REACHABLE — scrolling brings the "Links"
         header (Members) and the "Admin" header (matrix) into the viewport,
   i.e. no data is hidden.

   Runs in the same chromium project as the desktop suite but overrides the
   viewport for this file only (test.use), so the global desktop project and
   its layout assertions are untouched. Fixtures mode + seedSession, same as
   team.spec.ts; accessible-name / role selectors only. */

test.use({
  viewport: { width: 390, height: 852 },
  isMobile: true,
  hasTouch: true,
});

// Is this element horizontally scrollable? (content wider than the box)
async function isScrollable(el: import("@playwright/test").Locator): Promise<boolean> {
  return el.evaluate((n) => (n as HTMLElement).scrollWidth - (n as HTMLElement).clientWidth > 1);
}

// Is this element within the current viewport's horizontal bounds?
async function isWithinViewportX(el: import("@playwright/test").Locator, viewportWidth: number): Promise<boolean> {
  const box = await el.boundingBox();
  if (!box) return false;
  return box.x >= -1 && box.x + box.width <= viewportWidth + 1;
}

test.describe("team page wide tables are reachable on mobile (DC3)", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto("/team");
    await expect(page).toHaveURL(/\/team$/);
    // Wait past the Members skeleton so the real table is mounted.
    await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toBeVisible();
  });

  test("Members table: the right-most 'Links' column is reachable by horizontal scroll", async ({ page }) => {
    // The Members table's scroll container is the TableWrap div wrapping the
    // table whose header includes "Member" and "Links".
    const membersTable = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Links" }) });
    await expect(membersTable).toBeVisible();
    const scroller = membersTable.locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]");
    await expect(scroller).toBeVisible();

    // (1) At 390px the table overflows its container — it is genuinely scrollable.
    expect(await isScrollable(scroller)).toBe(true);

    // (2) While columns remain off-screen, the mobile "Scroll →" affordance shows.
    await expect(page.getByText(/Scroll →/).first()).toBeVisible();

    // The right-most header ("Links") exists but starts off-screen (clipped).
    const linksHeader = membersTable.getByRole("columnheader", { name: "Links" });
    await expect(linksHeader).toBeAttached();
    expect(await isWithinViewportX(linksHeader, 390)).toBe(false);

    // (3) Scroll it into view — no data is hidden; it becomes reachable/visible.
    await linksHeader.scrollIntoViewIfNeeded();
    await expect(linksHeader).toBeVisible();
    expect(await isWithinViewportX(linksHeader, 390)).toBe(true);
  });

  test("permission matrix: the right-most 'Admin'/'Owner' columns are reachable by horizontal scroll", async ({ page }) => {
    // The matrix is the table whose header includes the permission columns.
    const matrix = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Permission" }) });
    await expect(matrix).toBeVisible();
    const scroller = matrix.locator("xpath=ancestor::div[contains(@class,'overflow-x-auto')][1]");
    await expect(scroller).toBeVisible();

    // (1) The matrix overflows at 390px — scrollable.
    expect(await isScrollable(scroller)).toBe(true);

    // The right-most role columns exist; "Owner" is the last, starts off-screen.
    const ownerHeader = matrix.getByRole("columnheader", { name: "Owner" });
    await expect(ownerHeader).toBeAttached();
    expect(await isWithinViewportX(ownerHeader, 390)).toBe(false);

    // (3) Scroll the last column into view — reachable, not clipped.
    await ownerHeader.scrollIntoViewIfNeeded();
    await expect(ownerHeader).toBeVisible();
    expect(await isWithinViewportX(ownerHeader, 390)).toBe(true);

    // And the "Admin" column (called out in DC3) is likewise reachable.
    const adminHeader = matrix.getByRole("columnheader", { name: "Admin" });
    await adminHeader.scrollIntoViewIfNeeded();
    await expect(adminHeader).toBeVisible();
    expect(await isWithinViewportX(adminHeader, 390)).toBe(true);
  });
});
