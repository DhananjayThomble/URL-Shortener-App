import QRCode from "qrcode";

/* One composition for every QR the studio shows or exports (#773).
   The preview, the SVG download and the PNG download all call buildQrSvg(), so a
   file can never differ from what was on screen: same quiet zone, same logo, same
   backing plate, same error-correction level. The PNG is this SVG rasterised.

   Nothing here fetches anything: the centre mark is generated below and embedded
   as an inline data: URI, so there is no logo URL to validate (SSRF) and nothing a
   CSP `img-src` would have to allow. */

export type QrEcl = "L" | "M" | "Q" | "H";

/** ISO/IEC 18004 §6.3.8: the quiet zone around a symbol is 4 modules wide. */
export const QR_QUIET_ZONE_MODULES = 4;

/** Lowest error-correction level that survives a centre logo. */
export const QR_LOGO_MIN_ECL: QrEcl = "Q";

/** Logo side and backing-plate ring, as fractions of the symbol width (quiet zone excluded). */
export const QR_LOGO_SIDE = 0.2;
export const QR_LOGO_RING = 0.03;

export const QR_DEFAULT_ACCENT = "#1C55BD";

const ECL_RANK: Record<QrEcl, number> = { L: 0, M: 1, Q: 2, H: 3 };

/**
 * The level the symbol is really generated at. A logo hides the middle of the code, which L
 * (~7% recoverable) cannot absorb, so with a logo on anything below Q is raised to Q.
 */
export function effectiveEcl(ecl: QrEcl, logo: boolean): QrEcl {
  return logo && ECL_RANK[ecl] < ECL_RANK[QR_LOGO_MIN_ECL] ? QR_LOGO_MIN_ECL : ecl;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/i;

/** A colour that is safe to write into an SVG attribute: `#rgb`, `#rrggbb` or `rgb()` → hex; else the fallback. */
export function safeColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  if (HEX.test(v)) return v;
  const m = RGB.exec(v);
  if (m) {
    const ch = [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
    return `#${ch.map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return fallback;
}

/* The workspace mark: an accent tile with a white "S", drawn as paths so it looks the same
   in every viewer and print shop (no font to embed). 100×100 box. */
function markSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" rx="22" fill="${accent}"/>` +
    `<path d="M68 33C64 25 55 22 48 22C36 22 30 30 32 38C34 46 44 48 52 51C62 54 69 58 69 66C69 75 60 80 50 80C41 80 33 76 30 68" ` +
    `fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

function toBase64(text: string): string {
  // The mark is pure ASCII; btoa exists in browsers and in Node >= 16.
  return btoa(text);
}

export type QrComposeOptions = {
  value: string;
  /** Rendered width/height in px (the viewBox stays in modules). */
  size: number;
  dark: string;
  light?: string;
  ecl?: QrEcl;
  logo?: boolean;
  /** Concrete accent colour of the mark (resolve `--accent` in the browser first). */
  accent?: string;
};

/** Where the logo lands, in viewBox (module) units, for a symbol of `modules` and a canvas of `total` modules. */
export function logoGeometry(modules: number, total: number) {
  const side = modules * QR_LOGO_SIDE;
  const ring = modules * QR_LOGO_RING;
  const plate = side + 2 * ring;
  return {
    side,
    ring,
    plate,
    x: (total - side) / 2,
    plateX: (total - plate) / 2,
    radius: side * 0.22,
    plateRadius: side * 0.22 + ring,
  };
}

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** The complete QR as an SVG document string (quiet zone included, logo composited when asked). */
export async function buildQrSvg(opts: QrComposeOptions): Promise<string> {
  const light = safeColor(opts.light, "#FFFFFF");
  const dark = safeColor(opts.dark, "#0C1219");
  const logo = opts.logo ?? false;
  const level = effectiveEcl(opts.ecl ?? "Q", logo);

  let svg = await QRCode.toString(opts.value || " ", {
    type: "svg",
    errorCorrectionLevel: level,
    margin: QR_QUIET_ZONE_MODULES,
    width: opts.size,
    color: { dark, light },
  });
  if (!logo) return svg;

  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!vb) throw new Error("qr: unexpected svg output");
  const total = Number(vb[1]);
  const modules = total - 2 * QR_QUIET_ZONE_MODULES;
  const g = logoGeometry(modules, total);
  const href = `data:image/svg+xml;base64,${toBase64(markSvg(safeColor(opts.accent, QR_DEFAULT_ACCENT)))}`;

  const overlay =
    `<rect data-qr-logo-plate="" x="${n(g.plateX)}" y="${n(g.plateX)}" width="${n(g.plate)}" height="${n(g.plate)}" ` +
    `rx="${n(g.plateRadius)}" fill="${light}" shape-rendering="geometricPrecision"/>` +
    `<image data-qr-logo="" x="${n(g.x)}" y="${n(g.x)}" width="${n(g.side)}" height="${n(g.side)}" ` +
    `href="${href}" xlink:href="${href}"/>`;

  svg = svg.replace("<svg ", '<svg xmlns:xlink="http://www.w3.org/1999/xlink" ');
  return svg.replace(/<\/svg>\s*$/, `${overlay}</svg>`);
}
