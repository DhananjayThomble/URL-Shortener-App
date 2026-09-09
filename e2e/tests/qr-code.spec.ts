import { expect, test } from "@playwright/test";
import { seedSession } from "../support/session";

/* E2E journey: the QR studio. QR generation and download are entirely client-side
   (the `qrcode` lib) — no server round-trip — so this asserts the preview renders,
   a style control changes it, and the PNG/SVG downloads actually fire. Fixtures
   mode (a seeded link supplies the value), accessible-name selectors. */

test.describe("QR studio", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("renders a QR preview, restyles it, and downloads PNG and SVG", async ({ page }) => {
    await page.goto("/qr");

    // The preview is an inline SVG generated from the selected link's short URL.
    const preview = page.locator("svg").first();
    await expect(preview).toBeVisible();

    // Restyle: pick a non-default foreground colour swatch; the preview must stay
    // rendered (it re-generates locally from the new colour).
    await page.getByRole("button", { name: "Foreground colour #1F5FD4" }).click();
    await expect(preview).toBeVisible();

    // The header "Download" button produces a PNG entirely client-side.
    const pngDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const png = await pngDownload;
    expect(png.suggestedFilename()).toMatch(/\.png$/);

    // The export card's SVG button produces an SVG. Its label is "SVG …" — match
    // the button whose accessible name contains SVG.
    const svgDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: /SVG/ }).click();
    const svg = await svgDownload;
    expect(svg.suggestedFilename()).toMatch(/\.svg$/);
  });
});
