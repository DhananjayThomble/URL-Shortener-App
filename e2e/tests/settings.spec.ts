import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: Settings > Appearance. Appearance is a real product feature
   (web/src/components/theme/theme-provider.tsx) wired to a per-device store
   (localStorage "snapurl.appearance") and applied to <html> — both by the
   pre-paint script in web/src/app/layout.tsx before React mounts, and by the
   provider after. It is NOT an API call, so this asserts on the resulting DOM
   effect (the data-theme attribute and the controls' aria-pressed state), never
   a network round-trip.

   Settings is an authenticated /(app) route, so we seedSession first.
   Selectors use accessible names only: the accent swatches carry
   aria-label={accent.name} + aria-pressed, and the Theme/segmented controls are
   aria-pressed buttons labelled Light / Match system / Dark. No CSS, no
   data-testid. */

test.describe("settings appearance", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("choosing an accent and dark theme applies and survives a reload", async ({ page }) => {
    await page.goto("/settings");
    // The page rendered (not bounced to login) — the workspace name is in the head.
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

    const html = page.locator("html");
    // Default appearance is "match system" (mode ""), so no data-theme is set.
    await expect(html).not.toHaveAttribute("data-theme", /.+/);

    // --- Pick an accent. The swatch's accessible name is the accent name. ---
    // "Cobalt" is the default (already pressed), so choose a different one so the
    // assertion proves the click did something rather than matching the default.
    const magenta = page.getByRole("button", { name: "Magenta" });
    await expect(magenta).toHaveAttribute("aria-pressed", "false");
    await magenta.click();
    await expect(magenta).toHaveAttribute("aria-pressed", "true");
    // Selecting an accent is mutually exclusive — the previous default un-presses.
    await expect(page.getByRole("button", { name: "Cobalt" })).toHaveAttribute("aria-pressed", "false");

    // --- Switch the Theme to Dark and see it applied to the document. ---
    const dark = page.getByRole("button", { name: "Dark" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
    await expect(html).toHaveAttribute("data-theme", "dark");
    // A CSS custom property is the token the whole UI reads; the provider sets it.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()))
      .not.toEqual("");

    // --- Persistence: a full reload re-runs the pre-paint script from the
    // localStorage the click wrote, so the choice must survive it. ---
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Magenta" })).toHaveAttribute("aria-pressed", "true");
  });

  test("Reset to defaults clears a dark theme back to the system default", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

    const html = page.locator("html");

    // Put the appearance into a non-default state first.
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");

    // Reset must tear that state down: mode returns to "match system", so the
    // data-theme attribute is removed and Dark is no longer pressed. This is the
    // negative/teardown case — a reset that left a stale attribute behind would
    // keep forcing dark on every page for this device.
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(html).not.toHaveAttribute("data-theme", /.+/);
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
    // Accent is back to the built-in default (Cobalt) rather than whatever was set.
    await expect(page.getByRole("button", { name: "Cobalt" })).toHaveAttribute("aria-pressed", "true");
  });
});
