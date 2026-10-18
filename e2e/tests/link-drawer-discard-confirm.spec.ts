import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E (#761): closing the New-link / Edit-link drawer must not silently throw away
   what was typed.

   Before: Esc, a click on the dimmed backdrop, the ✕ and Cancel all called onClose
   directly, and the drawer's form is reset on the next open — so one stray Esc
   (the key people reach for to dismiss an autocomplete or a date picker) lost a
   half-written link with no way back.

   Now: when the form differs from what it opened with, every one of those four
   routes asks "Discard …?" first (the shared ConfirmDialog from #780). Keep editing
   leaves the drawer and every value exactly as they were; Discard closes it. A
   drawer nobody touched, and a form typed into and then emptied again, still
   closes at once, and a successful save never asks.

   Fixtures mode: the property is client-side form state, independent of any API.
   CI installs chromium only, so the phone viewports are emulated on chromium. */

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

const DESTINATION_PLACEHOLDER = "https://acme.com/collections/spring-2026";

const confirm = (page: Page, title: string) => page.getByRole("alertdialog", { name: title });
const anyConfirm = (page: Page) => page.getByRole("alertdialog");

async function openCreate(page: Page) {
  await page.goto("/links");
  const trigger = page.getByRole("button", { name: /New link|Create a link/ }).first();
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Create a link" });
  await expect(drawer).toBeVisible();
  return { drawer, trigger };
}

async function openEdit(page: Page) {
  await page.goto("/links");
  await page.getByRole("link", { name: /spring-sale/ }).first().click();
  await expect(page).toHaveURL(/\/links\/[^/]+$/);
  const trigger = page.getByRole("button", { name: "Edit", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: /Edit .+\/spring-sale/ });
  await expect(drawer).toBeVisible();
  return { drawer, trigger };
}

const destination = (drawer: Locator) => drawer.getByPlaceholder(DESTINATION_PLACEHOLDER);

/** A click on the dimmed area left of the drawer (the drawer is a full-width sheet at phone width, so there is none there). */
const hasBackdrop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 700;
const clickBackdrop = (page: Page) => page.mouse.click(20, 300);

type Route = "Escape" | "Close" | "Cancel" | "backdrop";
const ROUTES: Route[] = ["Escape", "Close", "Cancel", "backdrop"];

async function dismiss(page: Page, drawer: Locator, route: Route) {
  if (route === "Escape") await page.keyboard.press("Escape");
  else if (route === "backdrop") await clickBackdrop(page);
  else await drawer.getByRole("button", { name: route, exact: true }).click();
}

for (const vp of VIEWPORTS) {
  test.describe(`link drawers ask before discarding typed input (#761) — ${vp.name}`, () => {
    test.use(vp.use);
    test.beforeEach(async ({ page }) => {
      await seedSession(page);
    });

    for (const route of ROUTES) {
      test(`create: an untouched drawer closes at once on ${route}`, async ({ page }) => {
        test.skip(route === "backdrop" && !hasBackdrop(page), "no backdrop to click at phone width");
        const { drawer, trigger } = await openCreate(page);
        await dismiss(page, drawer, route);
        await expect(drawer).toBeHidden();
        await expect(anyConfirm(page)).toHaveCount(0);
        if (route !== "backdrop") await expect(trigger).toBeFocused();
      });

      test(`create: a drawer with typed input asks on ${route}; Keep editing changes nothing, Discard closes and the next open is blank`, async ({ page }) => {
        test.skip(route === "backdrop" && !hasBackdrop(page), "no backdrop to click at phone width");
        const { drawer, trigger } = await openCreate(page);
        await destination(drawer).fill("https://example.com/half-written");
        await drawer.getByPlaceholder("spring-sale").fill("my-slug");

        await dismiss(page, drawer, route);
        const ask = confirm(page, "Discard this link?");
        await expect(ask).toBeVisible();
        await expect(drawer).toBeVisible();
        await expect(ask).toContainText("lost");

        // Keep editing: still open, every value intact, focus back inside the drawer.
        await ask.getByRole("button", { name: "Keep editing" }).click();
        await expect(anyConfirm(page)).toHaveCount(0);
        await expect(drawer).toBeVisible();
        await expect(destination(drawer)).toHaveValue("https://example.com/half-written");
        await expect(drawer.getByPlaceholder("spring-sale")).toHaveValue("my-slug");
        expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true);

        // Ask again, this time discard.
        await dismiss(page, drawer, route);
        await expect(ask).toBeVisible();
        await ask.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(drawer).toBeHidden();
        await expect(anyConfirm(page)).toHaveCount(0);
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
        await expect(trigger).toBeFocused();

        await trigger.click();
        await expect(destination(page.getByRole("dialog", { name: "Create a link" }))).toHaveValue("");
      });
    }

    test("create: Escape in the confirmation keeps editing (it does not discard) and a second Escape asks again", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await destination(drawer).fill("https://example.com/keep-me");
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard this link?")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(anyConfirm(page)).toHaveCount(0);
      await expect(drawer).toBeVisible();
      await expect(destination(drawer)).toHaveValue("https://example.com/keep-me");

      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard this link?")).toBeVisible();
    });

    test("create: the confirmation is a real modal — the drawer behind it cannot be reached by Tab", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await destination(drawer).fill("https://example.com/x");
      await page.keyboard.press("Escape");
      const ask = confirm(page, "Discard this link?");
      await expect(ask).toBeVisible();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(await ask.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
    });

    test("create: typing and then emptying the field again is not a change", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await destination(drawer).fill("https://example.com/oops");
      await destination(drawer).fill("");
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(anyConfirm(page)).toHaveCount(0);
    });

    test("create: whitespace-only input is not a change worth asking about", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await destination(drawer).fill("   ");
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(anyConfirm(page)).toHaveCount(0);
    });

    test("create: input on another tab counts (Tags live on Destination, UTM on its own tab)", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await drawer.getByRole("tab", { name: "UTM", exact: true }).click();
      await drawer.getByPlaceholder("instagram").fill("newsletter");
      await drawer.getByRole("tab", { name: "Destination", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard this link?")).toBeVisible();
      await confirm(page, "Discard this link?").getByRole("button", { name: "Keep editing" }).click();
      await drawer.getByRole("tab", { name: "UTM", exact: true }).click();
      await expect(drawer.getByPlaceholder("instagram")).toHaveValue("newsletter");
    });

    test("create: changing the redirect type is a change", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await drawer.getByRole("tab", { name: "Routing", exact: true }).click();
      await drawer.getByRole("button", { name: "307", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard this link?")).toBeVisible();
    });

    test("create: a successful create closes without asking", async ({ page }) => {
      const { drawer } = await openCreate(page);
      await destination(drawer).fill("https://example.com/ship-it");
      await drawer.getByRole("button", { name: "Create link" }).click();
      await expect(drawer).toBeHidden();
      await expect(anyConfirm(page)).toHaveCount(0);
    });

    for (const route of ROUTES) {
      test(`edit: an untouched drawer closes at once on ${route}`, async ({ page }) => {
        test.skip(route === "backdrop" && !hasBackdrop(page), "no backdrop to click at phone width");
        const { drawer } = await openEdit(page);
        await dismiss(page, drawer, route);
        await expect(drawer).toBeHidden();
        await expect(anyConfirm(page)).toHaveCount(0);
      });

      test(`edit: a changed destination asks on ${route}; Keep editing changes nothing, Discard closes and the saved value is back on the next open`, async ({ page }) => {
        test.skip(route === "backdrop" && !hasBackdrop(page), "no backdrop to click at phone width");
        const { drawer, trigger } = await openEdit(page);
        const saved = await destination(drawer).inputValue();
        expect(saved).not.toBe("");
        await destination(drawer).fill("https://example.com/changed-my-mind");

        await dismiss(page, drawer, route);
        const ask = confirm(page, "Discard your changes?");
        await expect(ask).toBeVisible();
        await ask.getByRole("button", { name: "Keep editing" }).click();
        await expect(drawer).toBeVisible();
        await expect(destination(drawer)).toHaveValue("https://example.com/changed-my-mind");

        await dismiss(page, drawer, route);
        await ask.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(drawer).toBeHidden();
        expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");

        await trigger.click();
        await expect(destination(page.getByRole("dialog", { name: /Edit .+\/spring-sale/ }))).toHaveValue(saved);
      });
    }

    test("edit: the Archived switch is a change", async ({ page }) => {
      const { drawer } = await openEdit(page);
      await drawer.getByRole("button", { name: /^Archived/ }).click();
      await page.keyboard.press("Escape");
      await expect(confirm(page, "Discard your changes?")).toBeVisible();
    });

    test("edit: changing a field and putting the original value back is not a change", async ({ page }) => {
      const { drawer } = await openEdit(page);
      const saved = await destination(drawer).inputValue();
      await destination(drawer).fill("https://example.com/other");
      await destination(drawer).fill(saved);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(anyConfirm(page)).toHaveCount(0);
    });

    test("edit: saving closes without asking", async ({ page }) => {
      const { drawer } = await openEdit(page);
      await destination(drawer).fill("https://example.com/e2e/saved-not-discarded");
      await drawer.getByRole("button", { name: "Save changes" }).click();
      await expect(drawer).toBeHidden();
      await expect(anyConfirm(page)).toHaveCount(0);
    });
  });
}
