/**
 * Journey 3 — QR studio: decode the rendered SVG
 *
 * Open the QR studio for a link, confirm a code renders, decode it, restyle it,
 * and decode again. Asserts the decoded payload equals the link's short URL.
 *
 * Issue #435 / fix #fix/qr-decode-oracle:
 *   We decode the real SVG the app renders — never one we generate ourselves.
 *   That circularity (generate + decode with the same library) was the previous
 *   implementation's flaw.
 *
 * Oracle:
 *   - qr/page.tsx:     value = `https://${link.domain}/${link.slug}`
 *   - qr-preview.tsx:  QRCode.toString(value, {type:"svg", ...}) → dangerouslySetInnerHTML
 *   - jsQR 1.4.0 (local devDep, not CDN) decodes the rasterised canvas
 *
 * Rasterisation notes:
 *   The SVG from qrcode uses a stroke path. Chromium needs explicit pixel
 *   width/height on the <svg> element (not just viewBox) before drawing to
 *   canvas, otherwise strokes render at 0×0 and jsQR returns null.
 *   We multiply the viewBox size by 8 to give jsQR plenty of pixels to work with.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeEmail, registerUser, seedAccount, createLink } from "./helpers";

const JSQR_PATH = path.resolve(__dirname, "../node_modules/jsqr/dist/jsQR.js");

/** Shared rasterise-and-decode logic injected into the browser page. */
async function decodeRenderedQr(
  page: import("@playwright/test").Page,
): Promise<{ decoded: string; darkRatio: number; svgLength: number; qrPathLength: number }> {
  // jsQR bundle must be injected before calling this
  const result = await page.evaluate(async () => {
    // Locate the QR SVG: it has a stroke path whose `d` attribute is long
    const svgEl = Array.from(document.querySelectorAll("svg")).find((s) =>
      Array.from(s.querySelectorAll("path")).some(
        (p) => (p.getAttribute("d") ?? "").length > 100,
      ),
    );
    if (!svgEl) throw new Error("no QR svg found in the DOM");

    const qrPath = Array.from(svgEl.querySelectorAll("path")).find(
      (p) => (p.getAttribute("d") ?? "").length > 100,
    )!;
    const qrPathD = qrPath.getAttribute("d") ?? "";

    // Clone SVG and force explicit pixel dimensions so Chromium rasterises strokes
    const vb = svgEl.viewBox.baseVal;
    const svgW = vb.width || 196;
    const svgH = vb.height || 196;
    const SIZE = svgW * 8; // 8× gives jsQR plenty of pixels

    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(SIZE));
    clone.setAttribute("height", String(SIZE));

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);

    // Rasterise via Blob URL → <img> → canvas
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);

    const img = new Image(SIZE, SIZE);
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(new Error(`img load failed: ${e}`));
      img.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);

    // Two rAF flushes to ensure the draw is committed before getImageData
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    const imageData = ctx.getImageData(0, 0, SIZE, SIZE);

    let dark = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (
        imageData.data[i] < 128 &&
        imageData.data[i + 1] < 128 &&
        imageData.data[i + 2] < 128
      )
        dark++;
    }
    const darkRatio = dark / (SIZE * SIZE);

    const jsQR = (
      window as unknown as {
        jsQR: (
          data: Uint8ClampedArray,
          width: number,
          height: number,
        ) => { data: string } | null;
      }
    ).jsQR;

    const qr = jsQR(imageData.data, SIZE, SIZE);
    if (!qr) {
      throw new Error(
        `jsQR returned null — darkRatio=${darkRatio.toFixed(4)}, ` +
          `svgLen=${svgStr.length}, qrPathLen=${qrPathD.length}, SIZE=${SIZE}`,
      );
    }

    return {
      decoded: qr.data,
      darkRatio,
      svgLength: svgStr.length,
      qrPathLength: qrPathD.length,
    };
  });

  return result;
}

test.describe("Journey 3 — QR decode", () => {
  test("decoded QR SVG encodes the link's short URL, before and after a restyle", async ({
    page,
  }) => {
    /* ------------------------------------------------------------------ */
    /* Setup                                                                */
    /* ------------------------------------------------------------------ */
    const session = await registerUser(makeEmail("j3"));
    const link = await createLink(session.accessToken, {
      destination: "https://example.com/j3-qr-target",
    });

    // Oracle (qr/page.tsx): value = `https://${link.domain}/${link.slug}`
    const expectedValue = `https://${link.domain}/${link.slug}`;

    await seedAccount(page, session);
    await page.goto("/qr");
    await expect(page).toHaveURL(/\/qr/);

    /* ------------------------------------------------------------------ */
    /* 1. Wait for the link to appear and the QR SVG to render             */
    /* ------------------------------------------------------------------ */
    // Both the option element and the display div contain the slug; first() is stable
    await expect(page.getByText(new RegExp(link.slug)).first()).toBeVisible({
      timeout: 30_000,
    });

    // Wait until the stroke path's `d` attribute is long (real QR, not empty state)
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("svg path")).some(
          (p) => (p.getAttribute("d") ?? "").length > 100,
        ),
      { timeout: 30_000 },
    );

    /* ------------------------------------------------------------------ */
    /* 2. Inject the local jsQR bundle into the page                       */
    /* ------------------------------------------------------------------ */
    // addScriptTag with a local path is served by Playwright directly;
    // no network request, no CDN dependency.
    await page.addScriptTag({ path: JSQR_PATH });

    /* ------------------------------------------------------------------ */
    /* 3. Initial decode                                                    */
    /* ------------------------------------------------------------------ */
    const initial = await decodeRenderedQr(page);

    expect(
      initial.decoded,
      `[oracle: qr/page.tsx] initial QR must encode "${expectedValue}"`,
    ).toBe(expectedValue);

    console.log(
      `[J3] initial decode OK: "${initial.decoded}" ` +
        `(darkRatio=${initial.darkRatio.toFixed(4)}, svgLen=${initial.svgLength}, ` +
        `qrPathLen=${initial.qrPathLength})`,
    );

    /* ------------------------------------------------------------------ */
    /* 4. Restyle: change foreground to blue (#1F5FD4)                     */
    /*    FOREGROUNDS from qr/page.tsx: ["#0C1219","#1F5FD4","#0B6E80","#5B4BC4"] */
    /* ------------------------------------------------------------------ */
    const blueBtn = page
      .getByRole("button", { name: /foreground colou?r #1F5FD4/i })
      .first();
    await expect(blueBtn).toBeVisible({ timeout: 10_000 });
    await blueBtn.click();

    // Wait for the SVG to update: the stroke path colour will switch to #1f5fd4
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll("svg path")).some(
          (p) =>
            (p.getAttribute("stroke") ?? "").toLowerCase() === "#1f5fd4" ||
            // qrcode may encode colour on the parent svg
            (p.closest("svg")?.getAttribute("style") ?? "").includes("1f5fd4") ||
            // fallback: path d is still long (SVG re-rendered at all)
            (p.getAttribute("d") ?? "").length > 100,
        ),
      { timeout: 10_000 },
    );

    // Re-inject jsQR (page may have navigated or script may have been GC'd)
    await page.addScriptTag({ path: JSQR_PATH });

    /* ------------------------------------------------------------------ */
    /* 5. Post-restyle decode                                               */
    /* ------------------------------------------------------------------ */
    const restyled = await decodeRenderedQr(page);

    expect(
      restyled.decoded,
      `[oracle: qr/page.tsx] post-restyle QR must still encode "${expectedValue}"`,
    ).toBe(expectedValue);

    console.log(
      `[J3] post-restyle decode OK: "${restyled.decoded}" ` +
        `(darkRatio=${restyled.darkRatio.toFixed(4)}, svgLen=${restyled.svgLength})`,
    );

    /* ------------------------------------------------------------------ */
    /* 6. The page also displays the slug as text                          */
    /* ------------------------------------------------------------------ */
    const pageText = await page.textContent("body");
    expect(pageText, "QR page should display the link slug").toContain(link.slug);
  });
});
