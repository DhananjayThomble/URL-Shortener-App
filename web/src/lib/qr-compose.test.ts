import { describe, expect, it } from "vitest";
import {
  QR_QUIET_ZONE_MODULES,
  buildQrSvg,
  effectiveEcl,
  logoGeometry,
  safeColor,
  type QrEcl,
} from "./qr-compose";

/* #773 — QR downloads dropped the centre logo and used a 1-module quiet zone.

   Oracles (none read from the implementation under test):
   - Quiet zone: ISO/IEC 18004 §6.3.8 — 4 modules of light on every side of the symbol.
   - Logo present: the issue's acceptance criteria — the exported SVG contains the logo
     element when the toggle is on, and none when it is off.
   - Scannability with the logo on is decoded for real (jsQR) in
     e2e/mocked-api/qr-export.spec.ts against the downloaded files. */

const VALUE = "https://snap.to/limited";
const ECLS: QrEcl[] = ["L", "M", "Q", "H"];

/** Dark cells of the qrcode lib's own SVG path ("M{x} {y}.5h{run}m{gap} 0h{run}…"), independent of buildQrSvg's logic. */
function darkCells(svg: string): Array<[number, number]> {
  const d = /<path stroke="[^"]+" d="([^"]+)"/.exec(svg)?.[1] ?? "";
  const cells: Array<[number, number]> = [];
  for (const row of d.split("M").filter(Boolean)) {
    const head = /^(\d+) (\d+)(?:\.5)?/.exec(row);
    if (!head) continue;
    let x = Number(head[1]);
    const y = Number(head[2]);
    for (const m of row.slice(head[0].length).matchAll(/([hm])(\d+)/g)) {
      const run = Number(m[2]);
      if (m[1] === "h") for (let i = 0; i < run; i++) cells.push([x + i, y]);
      x += run;
    }
  }
  return cells;
}

function viewBoxSize(svg: string): number {
  return Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1]);
}

describe("quiet zone (ISO/IEC 18004: 4 modules)", () => {
  it("is 4 modules on every side, with and without a logo, at every level", async () => {
    expect(QR_QUIET_ZONE_MODULES).toBe(4);
    for (const logo of [false, true]) {
      for (const ecl of ECLS) {
        const svg = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", ecl, logo });
        const total = viewBoxSize(svg);
        const cells = darkCells(svg);
        expect(cells.length, `${ecl} logo=${logo}`).toBeGreaterThan(100);
        const xs = cells.map((c) => c[0]);
        const ys = cells.map((c) => c[1]);
        expect(Math.min(...xs), `left, ${ecl} logo=${logo}`).toBe(4);
        expect(Math.min(...ys), `top, ${ecl} logo=${logo}`).toBe(4);
        expect(Math.max(...xs), `right, ${ecl} logo=${logo}`).toBe(total - 5);
        expect(Math.max(...ys), `bottom, ${ecl} logo=${logo}`).toBe(total - 5);
      }
    }
  });
});

describe("centre logo", () => {
  it("is absent when the toggle is off", async () => {
    const svg = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", logo: false });
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("data-qr-logo");
  });

  it("is embedded as an inline data: URI with a backing plate when on — and nothing external", async () => {
    const svg = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", logo: true, accent: "#1F5FD4" });
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg).toContain("data-qr-logo-plate");

    const href = /<image [^>]*\bhref="([^"]+)"/.exec(svg)![1];
    expect(href.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const mark = Buffer.from(href.split(",")[1], "base64").toString("utf8");
    expect(mark).toContain('fill="#1F5FD4"');

    // No remote reference of any kind: the only URL in the document is the SVG namespace.
    const urls = [...svg.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]);
    expect(urls.every((u) => u.startsWith("http://www.w3.org/"))).toBe(true);
    expect(mark).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("sits exactly in the centre, inside the symbol, on a plate that clears it", async () => {
    const svg = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", logo: true });
    const total = viewBoxSize(svg);
    const num = (tag: string, attr: string) => Number(new RegExp(`<${tag}[^>]* ${attr}="([\\d.]+)"`).exec(svg)![1]);
    const img = { x: num("image", "x"), w: num("image", "width") };
    const plate = { x: num("rect data-qr-logo-plate=\"\"", "x"), w: num("rect data-qr-logo-plate=\"\"", "width") };
    expect(img.x + img.w / 2).toBeCloseTo(total / 2, 2);
    expect(plate.x + plate.w / 2).toBeCloseTo(total / 2, 2);
    expect(plate.w).toBeGreaterThan(img.w);
    // Stays inside the symbol, never into the quiet zone.
    expect(plate.x).toBeGreaterThan(QR_QUIET_ZONE_MODULES);
    // Hides well under what level Q can recover (~25% of codewords).
    const modules = total - 2 * QR_QUIET_ZONE_MODULES;
    expect((plate.w * plate.w) / (modules * modules)).toBeLessThan(0.08);
  });

  it("leaves the modules untouched: the logo is composited on top of the same symbol", async () => {
    const off = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", ecl: "H", logo: false });
    const on = await buildQrSvg({ value: VALUE, size: 1024, dark: "#0C1219", ecl: "H", logo: true });
    expect(darkCells(on)).toEqual(darkCells(off));
  });

  it("follows the accent, and refuses a value that is not a plain colour", async () => {
    const a = await buildQrSvg({ value: VALUE, size: 256, dark: "#0C1219", logo: true, accent: "#73abff" });
    const b = await buildQrSvg({ value: VALUE, size: 256, dark: "#0C1219", logo: true, accent: '"/><script>alert(1)</script>' });
    const markOf = (svg: string) => Buffer.from(/\bhref="data:image\/svg\+xml;base64,([^"]+)"/.exec(svg)![1], "base64").toString("utf8");
    expect(markOf(a)).toContain('fill="#73abff"');
    expect(markOf(b)).toContain('fill="#1C55BD"');
    expect(b).not.toContain("<script");
  });

  it("scales with the symbol, not with the canvas", () => {
    const small = logoGeometry(21, 29);
    const big = logoGeometry(57, 65);
    expect(small.side / 21).toBeCloseTo(big.side / 57, 6);
    expect(small.plateX).toBeGreaterThan(QR_QUIET_ZONE_MODULES);
  });
});

describe("error-correction level", () => {
  it("is raised to Q when a logo is on, never lowered, and untouched without one", () => {
    expect(effectiveEcl("L", true)).toBe("Q");
    expect(effectiveEcl("M", true)).toBe("Q");
    expect(effectiveEcl("Q", true)).toBe("Q");
    expect(effectiveEcl("H", true)).toBe("H");
    for (const ecl of ECLS) expect(effectiveEcl(ecl, false)).toBe(ecl);
  });

  it("generates the symbol at the raised level (L + logo is the same symbol as Q + logo)", async () => {
    const l = await buildQrSvg({ value: VALUE, size: 512, dark: "#0C1219", ecl: "L", logo: true });
    const q = await buildQrSvg({ value: VALUE, size: 512, dark: "#0C1219", ecl: "Q", logo: true });
    expect(darkCells(l)).toEqual(darkCells(q));
  });
});

describe("inputs", () => {
  it("encodes unicode and long-but-valid values; rejects one too long for any QR", async () => {
    const uni = await buildQrSvg({ value: "https://snap.to/héllo-🚀", size: 256, dark: "#0C1219", logo: true });
    expect(uni).toContain("data-qr-logo");
    const long = await buildQrSvg({ value: `https://snap.to/${"a".repeat(300)}`, size: 256, dark: "#0C1219", logo: true });
    expect(viewBoxSize(long)).toBeGreaterThan(60);
    await expect(buildQrSvg({ value: "x".repeat(4000), size: 256, dark: "#0C1219", logo: true })).rejects.toThrow();
  });

  it("does not throw on an empty value (the studio renders before a link is chosen)", async () => {
    await expect(buildQrSvg({ value: "", size: 196, dark: "#0C1219", logo: true })).resolves.toContain("<svg");
  });
});

describe("safeColor", () => {
  it("passes hex, converts rgb(), and falls back on anything else", () => {
    expect(safeColor("#abc", "#000000")).toBe("#abc");
    expect(safeColor(" #1F5FD4 ", "#000000")).toBe("#1F5FD4");
    expect(safeColor("rgb(31, 95, 212)", "#000000")).toBe("#1F5FD4");
    expect(safeColor("rgb(31 95 212 / 0.5)", "#000000")).toBe("#1F5FD4");
    expect(safeColor("", "#123456")).toBe("#123456");
    expect(safeColor(undefined, "#123456")).toBe("#123456");
    expect(safeColor("red", "#123456")).toBe("#123456");
    expect(safeColor('#fff" onload="x', "#123456")).toBe("#123456");
  });
});
