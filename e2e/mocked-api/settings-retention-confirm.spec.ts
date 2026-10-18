import { devices, expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession, type MockHandler } from "../support/mock-api";

/* E2E (#780): lowering click-data retention asks first.

   Before: picking "1 year" (was 3) and pressing Save sent the PATCH at once. The
   worker's maintenance pass (apps/worker/src/jobs/rollup.ts pruneRetention) then
   permanently deletes the raw click rows past the new window, so one click and one
   Save silently destroyed data that cannot be brought back.

   Now: Save with a LOWER retention than the stored one opens a confirmation that
   says what will be deleted and when; Cancel / Esc put the previous retention
   back and send nothing; raising it (or leaving it) does not ask.

   The deletion happens when the change is SAVED, not when a segment is picked
   (Settings holds a draft until "Save changes"), so that is where the question is
   asked. Viewports: desktop plus the two phones used across the suite; CI installs
   chromium only, so the iPhone viewport is emulated on chromium and WebKit is
   exercised in the real-stack verification instead. */

const FOREVER = 100;

async function openSettings(page: Page, opts: { retentionYears?: number; failPatch?: boolean } = {}) {
  const workspace: Record<string, unknown> = { ...MOCK_WORKSPACE, retentionYears: opts.retentionYears ?? 3 };
  const patch: MockHandler = (req) => {
    if (opts.failPatch) return { status: 500, body: { statusCode: 500, message: "Internal server error" } };
    Object.assign(workspace, req.body as Record<string, unknown>);
    return { status: 200, body: workspace };
  };
  await seedMockSession(page);
  const api = await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /workspaces/current": () => ({ status: 200, body: workspace }),
    "PATCH /workspaces/current": patch,
    "GET /domains": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
  });
  await page.goto("/settings");
  await expect(group(page)).toBeVisible();
  return { api, workspace };
}

const group = (page: Page) => page.getByRole("group", { name: "Click data retention" });
const choice = (page: Page, label: "1 year" | "3 years" | "Forever") => group(page).getByRole("button", { name: label, exact: true });
const saveBtn = (page: Page) => page.getByRole("button", { name: "Save changes" });
const dialog = (page: Page, window: string) => page.getByRole("alertdialog", { name: `Delete click data older than ${window}?` });
const patches = (api: Awaited<ReturnType<typeof openSettings>>["api"]) => api.callsTo("PATCH", "/workspaces/current");

const VIEWPORTS = [
  { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  { name: "iPhone 15 (393px)", use: { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15"].userAgent } },
  { name: "Pixel 7", use: { viewport: devices["Pixel 7"].viewport, isMobile: true, hasTouch: true, userAgent: devices["Pixel 7"].userAgent } },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`Settings > retention lowering confirm (#780) — ${vp.name}`, () => {
    test.use(vp.use);

    test("picking a shorter window does not delete anything or ask yet; Save does ask, and sends nothing until confirmed", async ({ page }) => {
      const { api } = await openSettings(page);
      await choice(page, "1 year").click();
      await expect(choice(page, "1 year")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);

      await saveBtn(page).click();
      const d = dialog(page, "1 year");
      await expect(d).toBeVisible();
      await expect(d).toContainText("older than 1 year");
      await expect(d).toContainText("permanently deleted");
      await expect(d).toContainText("next maintenance pass");
      await expect(d).toContainText("can’t be undone");
      expect(patches(api)).toHaveLength(0);

      await d.getByRole("button", { name: "Delete older data and save" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByText("Saved.")).toBeVisible();
      expect(patches(api)).toHaveLength(1);
      expect((patches(api)[0]!.body as { retentionYears: number }).retentionYears).toBe(1);
      await expect(choice(page, "1 year")).toHaveAttribute("aria-pressed", "true");

      // A reload shows what the server stored.
      await page.reload();
      await expect(choice(page, "1 year")).toHaveAttribute("aria-pressed", "true");
    });

    test("Cancel puts the previous retention back, sends nothing, and leaves nothing to save", async ({ page }) => {
      const { api } = await openSettings(page);
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      await dialog(page, "1 year").getByRole("button", { name: "Cancel" }).click();

      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true");
      await expect(choice(page, "1 year")).toHaveAttribute("aria-pressed", "false");
      await expect(saveBtn(page)).toBeDisabled();
      expect(patches(api)).toHaveLength(0);
    });

    test("Escape cancels exactly like Cancel", async ({ page }) => {
      const { api } = await openSettings(page);
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      await expect(dialog(page, "1 year")).toBeVisible();
      await page.keyboard.press("Escape");

      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true");
      expect(patches(api)).toHaveLength(0);
    });

    test("Forever -> 1 year and Forever -> 3 years are lowerings too", async ({ page }) => {
      const { api } = await openSettings(page, { retentionYears: FOREVER });
      await expect(choice(page, "Forever")).toHaveAttribute("aria-pressed", "true");

      await choice(page, "1 year").click();
      await saveBtn(page).click();
      await expect(dialog(page, "1 year")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(choice(page, "Forever")).toHaveAttribute("aria-pressed", "true");

      await choice(page, "3 years").click();
      await saveBtn(page).click();
      await expect(dialog(page, "3 years")).toBeVisible();
      await dialog(page, "3 years").getByRole("button", { name: "Delete older data and save" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      expect(patches(api)).toHaveLength(1);
      expect((patches(api)[0]!.body as { retentionYears: number }).retentionYears).toBe(3);
    });

    test("raising the window (1 -> 3, 3 -> Forever) saves straight away with no question", async ({ page }) => {
      const { api } = await openSettings(page, { retentionYears: 1 });
      await choice(page, "3 years").click();
      await saveBtn(page).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect((patches(api)[0]!.body as { retentionYears: number }).retentionYears).toBe(3);

      await choice(page, "Forever").click();
      await saveBtn(page).click();
      await expect.poll(() => patches(api).length).toBe(2);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect((patches(api)[1]!.body as { retentionYears: number }).retentionYears).toBe(FOREVER);
    });

    test("changing only something else never asks about retention", async ({ page }) => {
      const { api } = await openSettings(page);
      await page.getByLabel("Name").fill("Renamed workspace");
      await saveBtn(page).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(patches(api)).toHaveLength(1);
    });

    test("picking the lower value and then the original one again is not a change, so nothing asks", async ({ page }) => {
      const { api } = await openSettings(page);
      await choice(page, "1 year").click();
      await choice(page, "3 years").click();
      await expect(saveBtn(page)).toBeDisabled();
      expect(patches(api)).toHaveLength(0);
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
    });

    test("Cancel undoes only the retention edit; another unsaved edit survives and can still be saved", async ({ page }) => {
      const { api } = await openSettings(page);
      await page.getByLabel("Name").fill("Renamed workspace");
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      await dialog(page, "1 year").getByRole("button", { name: "Cancel" }).click();

      await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByLabel("Name")).toHaveValue("Renamed workspace");
      await expect(saveBtn(page)).toBeEnabled();
      await expect(saveBtn(page)).toBeFocused();
      expect(patches(api)).toHaveLength(0);

      await saveBtn(page).click();
      await expect(page.getByText("Saved.")).toBeVisible();
      expect(patches(api)).toHaveLength(1);
      expect(patches(api)[0]!.body).toMatchObject({ name: "Renamed workspace", retentionYears: 3 });
    });

    test("double-clicking Confirm sends one request", async ({ page }) => {
      const { api } = await openSettings(page);
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      const confirm = dialog(page, "1 year").getByRole("button", { name: "Delete older data and save" });
      await confirm.dblclick({ noWaitAfter: true }).catch(() => undefined);
      await expect(page.getByText("Saved.")).toBeVisible();
      expect(patches(api)).toHaveLength(1);
    });

    test("a failed save after confirming says so and keeps the form unsaved", async ({ page }) => {
      const { api } = await openSettings(page, { failPatch: true });
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      await dialog(page, "1 year").getByRole("button", { name: "Delete older data and save" }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByText("Saved.")).toHaveCount(0);
      await expect(saveBtn(page)).toBeEnabled();
      expect(patches(api)).toHaveLength(1);
    });

    test("the dialog fits the viewport and its buttons are reachable", async ({ page }) => {
      await openSettings(page);
      await choice(page, "1 year").click();
      await saveBtn(page).click();
      const d = dialog(page, "1 year");
      await expect(d).toBeVisible();
      const vpSize = page.viewportSize()!;
      const box = (await d.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vpSize.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vpSize.height);
      for (const name of ["Cancel", "Delete older data and save"]) {
        const b = d.getByRole("button", { name });
        await expect(b).toBeInViewport();
        const bb = (await b.boundingBox())!;
        expect(bb.height).toBeGreaterThanOrEqual(24);
      }
    });
  });
}

test.describe("Settings > retention lowering confirm (#780) — keyboard and accessibility", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("focus moves into the dialog on the safe button, is trapped inside, and returns afterwards", async ({ page }) => {
    await openSettings(page);
    await choice(page, "1 year").click();
    await saveBtn(page).focus();
    await page.keyboard.press("Enter");

    const d = dialog(page, "1 year");
    await expect(d).toBeVisible();
    await expect(d).toHaveAttribute("aria-modal", "true");
    const cancel = d.getByRole("button", { name: "Cancel" });
    const confirm = d.getByRole("button", { name: "Delete older data and save" });
    // The safe choice holds focus first: Enter on the Save button must not also confirm.
    await expect(cancel).toBeFocused();

    // Tab / Shift+Tab never leave the dialog.
    await page.keyboard.press("Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="alertdialog"]')))).toBe(true);

    // The description is wired up for screen readers.
    const describedBy = await d.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText("permanently deleted");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    // Back where it was asked from: on the control that was changed, not on <body>.
    await expect(choice(page, "3 years")).toBeFocused();
  });

  test("clicking outside the dialog cancels", async ({ page }) => {
    const { api } = await openSettings(page);
    await choice(page, "1 year").click();
    await saveBtn(page).click();
    await expect(dialog(page, "1 year")).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(choice(page, "3 years")).toHaveAttribute("aria-pressed", "true");
    expect(patches(api)).toHaveLength(0);
  });

  test("the page behind a modal dialog does not scroll", async ({ page }) => {
    await openSettings(page);
    await choice(page, "1 year").click();
    await saveBtn(page).click();
    await expect(dialog(page, "1 year")).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });
});
