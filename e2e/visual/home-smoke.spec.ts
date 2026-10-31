import { expect, test } from "@playwright/test";
import { seedAppearance, stabilise, VISUAL_EPOCH } from "./_helpers";

/* ============================================================================
   Harness smoke — issue #869.

   The ONE smoke target for the visual lane. It proves the whole mechanism end
   to end (fixed clock → seeded appearance → navigation → stabilise() → capture)
   inside the pinned Chromium container, WITHOUT committing a baseline — baseline
   generation is issue #870.

   Why not toHaveScreenshot here: that assertion needs a committed baseline under
   __screenshots__/, and on a fresh checkout its first run WRITES the baseline and
   FAILS the test. That would make this PR either red in CI or require a committed
   baseline, both out of scope. Instead the smoke captures to a buffer and asserts
   the capture succeeded and produced a well-formed, non-trivial PNG at the
   configured viewport. That exercises every determinism step and the container's
   rendering stack, which is exactly what this bring-up PR must prove.

   Desktop project only (design: "One smoke spec: / at the desktop project only").
   ============================================================================ */

test.describe("visual harness smoke", () => {
  test("captures the marketing home page deterministically", async ({ page }, testInfo) => {
    // Desktop only. The lane runs desktop/tablet/mobile; scope the smoke to
    // desktop so it is a single, stable target regardless of how the suite is
    // invoked.
    test.skip(testInfo.project.name !== "desktop", "smoke runs on the desktop project only");

    // Freeze the clock BEFORE navigation so fixture timestamps, "N days ago"
    // labels and the footer year are all fixed (design §5 step 0, §2 #3/#4/#7/#8).
    await page.clock.setFixedTime(VISUAL_EPOCH);

    // Pin the saved appearance before first paint (design §5, §2 #16/#17).
    await seedAppearance(page);

    // "/" is the signed-out marketing page — no session seeding needed.
    const response = await page.goto("/");
    expect(response, "navigation to / returned a response").not.toBeNull();
    expect(response!.ok(), `GET / status ${response!.status()}`).toBeTruthy();

    // Run the determinism contract. If any step throws, the harness is not
    // actually stable and the smoke must fail.
    await stabilise(page);

    // Prove the capture path works: take a viewport screenshot to a buffer with
    // the same capture options the lane uses, and assert it is a well-formed,
    // non-trivial PNG. No baseline comparison (that is #870).
    const png = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });

    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A.
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(0, 8).equals(PNG_MAGIC), "capture is a PNG").toBeTruthy();

    // IHDR width/height are big-endian uint32 at byte offsets 16 and 20.
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width, "capture width matches the desktop viewport").toBe(1440);
    expect(height, "capture height is non-trivial").toBeGreaterThan(0);

    // A blank/near-empty capture would be a few hundred bytes; a real rendered
    // page is far larger. Guard against a white-frame "pass".
    expect(png.byteLength, "capture is a non-trivial image").toBeGreaterThan(10_000);
  });
});
