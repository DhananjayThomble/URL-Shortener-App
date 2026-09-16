import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the top-bar link search (DC5 follow-up, issue #408).

   The top bar's search input (web/src/components/app-shell/index.tsx) used to be
   a non-functional stub. It is now an accessible combobox: typing queries the
   workspace's links SERVER-SIDE via useLinks({ search }) (GET /links?search=,
   which the fixtures backend filters by slug/destination/title/comment), and the
   matches render in a listbox under the input. Enter / click / ArrowDown+Enter
   open the highlighted link's detail page (/links/:id). Empty query hides the
   dropdown; a no-match query shows "No matches".

   Authenticated /(app) shell, so seedSession first. Selectors are accessible
   name / role only per repo convention (no CSS, no data-testid). The search is
   `hidden sm:flex` (desktop/tablet only — DC5 keeps it off phones), so these run
   at the default Desktop Chrome viewport; a phone-viewport test asserts the
   combobox is NOT present. Fixture seed used: slug "webinar-q3" (id lnk_webinar)
   is the sole "webinar" match; "spring" matches several; "zzzznomatch" matches
   none. */

const COMBOBOX = "Search links, slugs, destinations, tags";

test.describe("top-bar link search (desktop/tablet)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto("/links");
  });

  test("typing a matching query shows the link in the results listbox", async ({ page }) => {
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await expect(search).toBeVisible();
    // Empty query: no dropdown.
    await expect(page.getByRole("listbox", { name: "Link results" })).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");

    await search.fill("webinar");

    const listbox = page.getByRole("listbox", { name: "Link results" });
    await expect(listbox).toBeVisible();
    await expect(search).toHaveAttribute("aria-expanded", "true");

    // The sole "webinar" match (slug webinar-q3) appears as an option; its
    // destination is shown in the row too.
    const option = listbox.getByRole("option", { name: /webinar-q3/ });
    await expect(option).toBeVisible();
    await expect(listbox.getByText("https://acme.com/events/q3-webinar")).toBeVisible();
  });

  test("clicking a result navigates to that link's detail page", async ({ page }) => {
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await search.fill("webinar");

    const listbox = page.getByRole("listbox", { name: "Link results" });
    const option = listbox.getByRole("option", { name: /webinar-q3/ });
    await expect(option).toBeVisible();

    await option.click();

    // Assert we landed on a link detail route without encoding the id format —
    // real API issues uuidv7; the fixture uses short ids. (#445 fixture-fidelity fix)
    await expect(page).toHaveURL(/\/links\/[^/]+$/);
    // Confirm it is the webinar-q3 link (slug visible on the detail page).
    await expect(page.getByText(/webinar-q3/, { exact: false })).toBeVisible();
    // Dropdown closed on navigation.
    await expect(page.getByRole("listbox", { name: "Link results" })).toHaveCount(0);
  });

  test("keyboard: ArrowDown highlights and Enter opens the result", async ({ page }) => {
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await search.fill("webinar");

    const listbox = page.getByRole("listbox", { name: "Link results" });
    const option = listbox.getByRole("option", { name: /webinar-q3/ });
    await expect(option).toBeVisible();

    // ArrowDown selects the first option (aria-selected), Enter opens it.
    await search.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await search.press("Enter");

    // Assert the detail page for this specific link without encoding the id format.
    // (#445 fixture-fidelity fix: do not hard-code lnk_webinar)
    await expect(page).toHaveURL(/\/links\/[^/]+$/);
    // Confirm the right link.
    await expect(page.getByText(/webinar-q3/, { exact: false })).toBeVisible();
  });

  test("a no-match query shows the empty state", async ({ page }) => {
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await search.fill("zzzznomatch");

    await expect(page.getByText("No matches")).toBeVisible();
    // The empty state is not a listbox of options: no results listbox renders.
    await expect(page.getByRole("listbox", { name: "Link results" }).getByRole("option")).toHaveCount(0);
  });

  test("clearing the query hides the dropdown", async ({ page }) => {
    const search = page.getByRole("combobox", { name: COMBOBOX });
    await search.fill("webinar");
    await expect(page.getByRole("listbox", { name: "Link results" })).toBeVisible();

    await search.fill("");
    await expect(page.getByRole("listbox", { name: "Link results" })).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("top-bar search is desktop/tablet only (DC5)", () => {
  test.use({ viewport: { width: 390, height: 852 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await seedSession(page);
    await page.goto("/links");
  });

  test("the search combobox is not present on phones", async ({ page }) => {
    // hidden sm:flex — below the sm breakpoint the search wrapper is display:none.
    await expect(page.getByRole("combobox", { name: COMBOBOX })).toBeHidden();
  });
});
