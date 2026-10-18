import path from "node:path";
import { devices, expect, test, type Download, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, fakeAccessToken, mockApi, seedMockSession } from "../support/mock-api";

/* E2E (#773): the QR studio's SVG and PNG downloads match the preview — centre logo
   included — and use the standard 4-module quiet zone.

   The files used to be built by a second code path (QRCode.toString / toDataURL with
   `margin: 1` and no logo) while the logo existed only as a DOM overlay in the preview.

   Every assertion is on the DOWNLOADED FILE's content, read back the way a scanner or a
   print shop would see it. Oracles, none taken from the implementation:
   - ISO/IEC 18004 §6.3.8: quiet zone = 4 modules.
   - jsQR 1.4.0 (a local devDependency, not the `qrcode` lib that wrote the file) decodes
     the rasterised file back to the link's short URL, at every error-correction level.
   - The decoded symbol's own version gives its module count, so the quiet zone is measured
     from pixels (first dark pixel / module size), not read from an attribute.
   - The logo is the page's accent colour: pixels of that colour appear in the middle of
     the file when the toggle is on, and nowhere in it when off.
   - Preview ↔ SVG: the downloaded SVG, with only its pixel size stripped, is the preview's SVG. */

const JSQR_PATH = path.resolve(__dirname, "../node_modules/jsqr/dist/jsQR.js");
const SLUG = "limited";
const DOMAIN = "snap.to";
const NOW = "2026-01-01T00:00:00.000Z";
const ECLS = ["L", "M", "Q", "H"] as const;

const LINK = {
  id: "lnk_1",
  domain: DOMAIN,
  slug: SLUG,
  destination: "https://example.com/start",
  tags: [] as string[],
  status: "active",
  clicks: 0,
  redirectType: "302",
  rules: [],
  passwordProtected: false,
  forwardQuery: true,
  deepLink: false,
  hideReferrer: false,
  publicPreview: true,
  cloaked: false,
  safeBrowsing: { status: "clean", checkedAt: NOW },
  sparkline: Array.from({ length: 30 }, () => 0),
  createdAt: NOW,
  clickLimit: null,
};

async function openStudio(page: Page, slug = SLUG) {
  const link = { ...LINK, slug };
  await seedMockSession(page, fakeAccessToken(MOCK_WORKSPACE.id));
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /links": { status: 200, body: { items: [link], total: 1, nextCursor: null } },
  });
  await page.goto("/qr");
  await expect(page.getByTestId("qr-preview").locator("svg")).toBeVisible();
  await page.addScriptTag({ path: JSQR_PATH });
}

const logoToggle = (page: Page) => page.getByRole("button", { name: /^Centre logo/ });
const setLogo = async (page: Page, on: boolean) => {
  const t = logoToggle(page);
  if ((await t.getAttribute("aria-pressed")) !== String(on)) await t.click();
  await expect(t).toHaveAttribute("aria-pressed", String(on));
};
const setEcl = async (page: Page, ecl: (typeof ECLS)[number]) => {
  const b = page.getByRole("group", { name: "Error correction" }).getByRole("button", { name: ecl, exact: true });
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
};

async function download(page: Page, format: "svg" | "png"): Promise<{ file: Download; bytes: Buffer }> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: format === "svg" ? /^SVG/ : /^PNG/ }).click();
  const file = await pending;
  const chunks: Buffer[] = [];
  for await (const c of await file.createReadStream()) chunks.push(c as Buffer);
  return { file, bytes: Buffer.concat(chunks) };
}

type Inspection = {
  decoded: string | null;
  version: number;
  width: number;
  /** Quiet zone in modules, measured from the first dark pixel. */
  quietModules: number;
  /** Share of the central 40% square painted in the accent colour. */
  accentShare: number;
};

/** Rasterise a downloaded file in the browser and read it back with jsQR. */
async function inspect(page: Page, mime: string, bytes: Buffer, accent: string): Promise<Inspection> {
  return page.evaluate(
    async ({ mime, b64, accent }) => {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("file did not load as an image"));
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

      // Quiet zone, from pixels: bounding box of "dark" pixels (the finder patterns touch it).
      let min = W;
      for (let y = 0; y < W; y++)
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          if (data[i] < 90 && data[i + 1] < 90 && data[i + 2] < 90) {
            if (x < min) min = x;
            if (y < min) min = y;
          }
        }
      const modules = qr ? 17 + 4 * qr.version : 0;
      const moduleSize = modules ? (W - 2 * min) / modules : 0;

      const [ar, ag, ab] = [1, 3, 5].map((o) => parseInt(accent.slice(o, o + 2), 16));
      const lo = Math.floor(W * 0.3);
      const hi = Math.floor(W * 0.7);
      let hits = 0;
      for (let y = lo; y < hi; y++)
        for (let x = lo; x < hi; x++) {
          const i = (y * W + x) * 4;
          if (Math.abs(data[i] - ar) < 24 && Math.abs(data[i + 1] - ag) < 24 && Math.abs(data[i + 2] - ab) < 24) hits++;
        }

      return {
        decoded: qr ? qr.data : null,
        version: qr ? qr.version : 0,
        width: W,
        quietModules: moduleSize ? min / moduleSize : -1,
        accentShare: hits / ((hi - lo) * (hi - lo)),
      };
    },
    { mime, b64: bytes.toString("base64"), accent },
  );
}

/* The studio encodes the short link with the page's own scheme (utils.ts#shortUrlHref, #721):
   http: on the plain-http test server, https: in production. */
const shortUrlOf = (page: Page, slug = SLUG) => `${new URL(page.url()).protocol}//${DOMAIN}/${slug}`;

/** The page's accent, as the hex the app resolves it to. */
async function pageAccent(page: Page): Promise<string> {
  const raw = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  expect(raw, "the app should expose --accent as a hex colour").toMatch(/^#[0-9a-f]{6}$/i);
  return raw;
}

/* `defaultBrowserType` belongs to the device descriptor and cannot be set inside a describe;
   this lane is chromium, which is Pixel 7's engine too. */
const { defaultBrowserType: _ignored, ...pixel7 } = devices["Pixel 7"];
const viewports = [
  { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  { name: "mobile (Pixel 7, 412px)", use: pixel7 },
] as const;

for (const vp of viewports) {
  test.describe(`QR studio exports — ${vp.name}`, () => {
    test.use(vp.use);

    for (const logo of [true, false]) {
      for (const ecl of ECLS) {
        test(`SVG + PNG decode to the short URL with a 4-module quiet zone — ECL ${ecl}, logo ${logo ? "on" : "off"}`, async ({ page }) => {
          await openStudio(page);
          await setEcl(page, ecl);
          await setLogo(page, logo);
          const accent = await pageAccent(page);
          const expected = shortUrlOf(page);

          for (const format of ["svg", "png"] as const) {
            const { file, bytes } = await download(page, format);
            expect(file.suggestedFilename()).toBe(`${DOMAIN}-${SLUG}.${format}`);

            if (format === "svg") {
              const text = bytes.toString("utf8");
              if (logo) {
                expect(text, "SVG should embed the logo").toContain("<image");
                expect(text).toMatch(/href="data:image\/svg\+xml;base64,/);
              } else {
                expect(text, "no logo requested, none embedded").not.toContain("<image");
              }
              // The file stands alone: no remote reference anywhere in it.
              expect([...text.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith("http://www.w3.org/"))).toEqual([]);
            } else {
              expect(bytes.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
            }

            const seen = await inspect(page, format === "svg" ? "image/svg+xml" : "image/png", bytes, accent);
            const label = `${format} ECL ${ecl} logo ${logo}`;
            expect(seen.decoded, `${label}: decodes to the short URL`).toBe(expected);
            expect(seen.width, `${label}: export size`).toBe(format === "svg" ? 1024 : 2048);
            expect(seen.quietModules, `${label}: quiet zone in modules (ISO/IEC 18004 = 4)`).toBeGreaterThan(3.85);
            expect(seen.quietModules, `${label}: quiet zone in modules`).toBeLessThan(4.15);
            if (logo) expect(seen.accentShare, `${label}: logo drawn in the middle`).toBeGreaterThan(0.02);
            else expect(seen.accentShare, `${label}: nothing drawn in the middle`).toBe(0);
          }
        });
      }
    }

    test("the SVG download is the preview's own SVG (only its pixel size differs)", async ({ page }) => {
      await openStudio(page);
      await page.getByRole("button", { name: "Foreground colour #1F5FD4" }).click();
      await setEcl(page, "H");
      await setLogo(page, true);
      const { bytes } = await download(page, "svg");

      const same = await page.evaluate((file) => {
        // Canonical form: attributes sorted (HTML and XML parsers order them differently), pixel size dropped.
        const norm = (el: Element, root = true): string => {
          const attrs = Array.from(el.attributes)
            .filter((a) => !(root && (a.name === "width" || a.name === "height")))
            .map((a) => `${a.name}=${a.value}`)
            .sort()
            .join(" ");
          return `<${el.localName} ${attrs}>${Array.from(el.children).map((c) => norm(c, false)).join("")}</${el.localName}>`;
        };
        const exported = new DOMParser().parseFromString(file, "image/svg+xml").documentElement;
        const preview = document.querySelector('[data-testid="qr-preview"] svg')!;
        return { exported: norm(exported), preview: norm(preview) };
      }, bytes.toString("utf8"));
      expect(same.preview).toContain("<image");
      expect(same.exported).toBe(same.preview);
    });

    test("the logo follows the viewer's accent in the preview and in both files", async ({ page }) => {
      await openStudio(page);
      await setLogo(page, true);
      await page.evaluate(() => document.documentElement.style.setProperty("--accent", "#B4107A"));
      // The preview re-composes on its own; no reload, no control touched.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const href = document.querySelector('[data-testid="qr-preview"] image')?.getAttribute("href") ?? "";
            return atob(href.split(",")[1] ?? "");
          }),
        )
        .toContain('fill="#B4107A"');

      for (const format of ["svg", "png"] as const) {
        const { bytes } = await download(page, format);
        const seen = await inspect(page, format === "svg" ? "image/svg+xml" : "image/png", bytes, "#B4107A");
        expect(seen.decoded).toBe(shortUrlOf(page));
        expect(seen.accentShare, `${format}: logo in the new accent`).toBeGreaterThan(0.02);
      }
    });

    test("a long mixed-case link (a much bigger symbol) still decodes with the logo on, at L and H", async ({ page }) => {
      const slug = `Spring-Sale_2026-${"aB3".repeat(9)}`;
      await openStudio(page, slug);
      await setLogo(page, true);
      const accent = await pageAccent(page);
      for (const ecl of ["L", "H"] as const) {
        await setEcl(page, ecl);
        for (const format of ["svg", "png"] as const) {
          const { bytes } = await download(page, format);
          const seen = await inspect(page, format === "svg" ? "image/svg+xml" : "image/png", bytes, accent);
          const label = `${format} ECL ${ecl}`;
          expect(seen.decoded, label).toBe(shortUrlOf(page, slug));
          expect(seen.version, `${label}: a bigger symbol than the short link's`).toBeGreaterThan(3);
          expect(seen.quietModules, label).toBeGreaterThan(3.85);
          expect(seen.quietModules, label).toBeLessThan(4.15);
          expect(seen.accentShare, `${label}: logo present`).toBeGreaterThan(0.01);
        }
      }
    });

    test("the preview itself uses the 4-module quiet zone and shows the logo", async ({ page }) => {
      await openStudio(page);
      const info = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="qr-preview"] svg')!;
        const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
        const d = svg.querySelectorAll("path")[1].getAttribute("d")!;
        const first = /^M(\d+) (\d+)/.exec(d)!;
        return { total: vb[2], firstX: Number(first[1]), firstY: Number(first[2]), logo: !!svg.querySelector("image") };
      });
      expect(info.firstX).toBe(4);
      expect(info.firstY).toBe(4);
      expect(info.logo).toBe(true);
      await setLogo(page, false);
      await expect(page.getByTestId("qr-preview").locator("image")).toHaveCount(0);
    });
  });
}
