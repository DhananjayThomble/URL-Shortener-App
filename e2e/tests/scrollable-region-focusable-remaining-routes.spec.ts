import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* Issue #463 — "Make scrollable data-table regions keyboard-reachable", split
   from #438 alongside #474. Same root cause and same fix as #474 (landed in
   #498): every wide table renders through the shared `TableWrap` scroll
   container in web/src/components/ui/index.tsx, which sets
   tabIndex={0} + role="region" + an accessible name.

   #498's own regression spec (scrollable-region-focusable.spec.ts) already
   covers /team, /bio, /conversions and the code-block pages by asserting the
   ARIA contract the fix commits to (role="region", accessible name,
   tabindex="0", then focus()+toBeFocused()) directly on the DOM node. That
   contract is the load-bearing check — a scrollable region axe-core would
   otherwise flag under scrollable-region-focusable (WCAG 2.1 SC 2.1.1
   Keyboard, impact=serious) is provably reachable and operable by keyboard
   only if the element the user tabs to can actually receive focus and the
   region is announced with a name.

   This spec extends that same load-bearing assertion — not an axe run — to
   every remaining TableWrap route #463 lists that #498 doesn't cover:
   /domains, /forms, /reports. An axe-only assertion was tried first and
   rejected on review: it stayed green even with tabIndex removed from
   TableWrap on this DOM shape, so it doesn't gate the defect it claims to.
   Asserting the concrete ARIA contract + actual focusability, as #498 does,
   is the check that provably goes red — see the bug-injection gate in the PR
   description for the reproduction.

   Fixtures mode: a route's DOM structure for this check does not depend on
   whether data comes from the real API or the fixture backend. */

async function expectFocusableRegion(region: ReturnType<import("@playwright/test").Page["getByRole"]>) {
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
}

test.describe("scrollable regions are keyboard-focusable — remaining TableWrap routes (#463)", () => {
  test("/domains: the Domains table wrapper is focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/domains");
    await expectFocusableRegion(page.getByRole("region", { name: "Domains" }));
  });

  test("/forms: the Forms and Form responses table wrappers are focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/forms");
    await expectFocusableRegion(page.getByRole("region", { name: "Forms" }));
    // The response table only mounts once a form with responses is expanded.
    await page.getByRole("row", { name: /Spring launch feedback/ }).getByRole("button", { name: "Responses" }).click();
    await expectFocusableRegion(page.getByRole("region", { name: "Form responses" }));
  });

  test("/reports: the Reports table wrapper is focusable and named", async ({ page }) => {
    await seedSession(page);
    await page.goto("/reports");
    await expectFocusableRegion(page.getByRole("region", { name: "Reports" }));
  });
});

test.describe("scrollable regions are keyboard-focusable — remaining TableWrap routes, mobile viewport", () => {
  // tabIndex/role/aria-label on TableWrap's scroll container (web/src/components/ui/index.tsx)
  // are set unconditionally, not behind a viewport media query, so the ARIA
  // contract does not vary with viewport. This case exists to prove that with
  // evidence (matching the maintainer's own iPhone-13-dimension rerun on this
  // PR) rather than assert it from reading the source.
  //
  // Coverage note (#559): the desktop describe block above exercises every
  // TableWrap call site this file covers (/domains, /forms x2, /reports), plus
  // sibling spec files cover /team, /bio, /conversions and /developers (x2) at
  // desktop only (scrollable-region-focusable.spec.ts). Before this block was
  // extended, only /domains had a mobile-viewport case — #559's own
  // investigation flagged "only checked desktop viewport... did not reproduce
  // the mobile half" as an explicit gap. This block closes it for every
  // TableWrap site reachable without additional fixture setup (the
  // /domains "DNS record for <pending domain>" panel is gated on a
  // status: "verifying" domain that no fixture seeds, so it is not
  // reachable here at either viewport and stays a documented gap, not a
  // silently-skipped one).
  test.use({ viewport: { width: 390, height: 852 }, isMobile: true, hasTouch: true });

  test("/domains: the Domains table wrapper is focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/domains");
    await expectFocusableRegion(page.getByRole("region", { name: "Domains" }));
  });

  test("/forms: the Forms and Form responses table wrappers are focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/forms");
    await expectFocusableRegion(page.getByRole("region", { name: "Forms" }));
    await page.getByRole("row", { name: /Spring launch feedback/ }).getByRole("button", { name: "Responses" }).click();
    await expectFocusableRegion(page.getByRole("region", { name: "Form responses" }));
  });

  test("/reports: the Reports table wrapper is focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/reports");
    await expectFocusableRegion(page.getByRole("region", { name: "Reports" }));
  });

  test("/team: the Members table and permission-matrix wrappers are focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/team");
    await expect(page.getByRole("row", { name: /Arjun Kapoor/ })).toBeVisible();
    await expectFocusableRegion(page.getByRole("region", { name: "Members" }));
    await expectFocusableRegion(page.getByRole("region", { name: "What each role can do" }));
  });

  test("/bio: the pages table wrapper is focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/bio");
    await expectFocusableRegion(page.getByRole("region", { name: "Your pages" }));
  });

  test("/conversions: the revenue-by-link table wrapper is focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/conversions");
    await expectFocusableRegion(page.getByRole("region", { name: "Revenue by link" }));
  });

  test("/developers: the API keys and Webhooks table wrappers are focusable and named on a phone viewport", async ({ page }) => {
    await seedSession(page);
    await page.goto("/developers");
    await expectFocusableRegion(page.getByRole("region", { name: "API keys" }));
    await expectFocusableRegion(page.getByRole("region", { name: "Webhooks" }));
  });
});
