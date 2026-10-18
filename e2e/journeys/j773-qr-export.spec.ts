/**
 * Journey 773 — QR studio: the downloaded SVG and PNG carry the centre logo and the
 * standard quiet zone, against the REAL stack (real API, real link).
 *
 * Oracles: ISO/IEC 18004 (quiet zone = 4 modules); jsQR 1.4.0 (local devDep) decodes the
 * DOWNLOADED files back to the link's short URL. The module count comes from the decoded
 * symbol's version, so the quiet zone is measured from pixels, not read from a file attribute.
 * The fuller matrix (every ECL, logo on/off, desktop + Pixel 7) is e2e/mocked-api/qr-export.spec.ts.
 */

import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeEmail, registerUser, seedAccount, createLink } from "./helpers";

const JSQR_PATH = path.resolve(__dirname, "../node_modules/jsqr/dist/jsQR.js");

test.describe("Journey 773 — QR export", () => {
  test("@mobile downloads decode to the short URL, with the logo and a 4-module quiet zone", async ({ page }) => {
    const session = await registerUser(makeEmail("j773"));
    const link = await createLink(session.accessToken, { destination: "https://example.com/j773-qr-export" });

    await seedAccount(page, session);
    await page.goto("/qr");
    await expect(page.getByTestId("qr-preview").locator("svg")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Centre logo/ })).toHaveAttribute("aria-pressed", "true");
    await page.addScriptTag({ path: JSQR_PATH });
    const scheme = new URL(page.url()).protocol;

    for (const format of ["svg", "png"] as const) {
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: format === "svg" ? /^SVG/ : /^PNG/ }).click();
      const file = await pending;
      const chunks: Buffer[] = [];
      for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
      const bytes = Buffer.concat(chunks);
      if (format === "svg") expect(bytes.toString("utf8")).toContain("<image");

      const seen = await page.evaluate(
        async ({ mime, b64 }) => {
          const img = new Image();
          await new Promise<void>((res, rej) => {
            img.onload = () => res();
            img.onerror = () => rej(new Error("file did not load"));
            img.src = `data:${mime};base64,${b64}`;
          });
          const W = img.naturalWidth;
          const canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = W;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, W, W);
          ctx.drawImage(img, 0, 0, W, W);
          const { data } = ctx.getImageData(0, 0, W, W);
          const jsQR = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string; version: number } | null }).jsQR;
          const qr = jsQR(data, W, W);
          let min = W;
          for (let y = 0; y < W; y++)
            for (let x = 0; x < W; x++) {
              const i = (y * W + x) * 4;
              if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) min = Math.min(min, x, y);
            }
          const modules = qr ? 17 + 4 * qr.version : 0;
          return { decoded: qr?.data ?? null, quiet: modules ? min / ((W - 2 * min) / modules) : -1 };
        },
        { mime: format === "svg" ? "image/svg+xml" : "image/png", b64: bytes.toString("base64") },
      );
      expect(seen.decoded, `${format}: decodes to the short URL`).toBe(`${scheme}//${link.domain}/${link.slug}`);
      expect(seen.quiet, `${format}: quiet zone in modules`).toBeGreaterThan(3.85);
      expect(seen.quiet, `${format}: quiet zone in modules`).toBeLessThan(4.15);
    }
  });
});
