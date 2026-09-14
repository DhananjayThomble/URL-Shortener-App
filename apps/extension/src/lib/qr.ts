/* QR code generation, wrapping the bundled `qrcode` dependency.
 *
 * MV3 forbids remote code, so `qrcode` is bundled by esbuild into popup.js — no
 * CDN, no eval. This module is a thin, DOM-free wrapper exposing exactly the two
 * outputs the popup offers as downloads: a PNG data URL (for an <img> preview +
 * download) and an SVG string (a crisp, dependency-free vector download). Both
 * are pure functions of the input text, so they are unit-testable without a
 * browser by injecting a fake `qrcode`-shaped module.
 */

import QRCode from "qrcode";

/** The subset of the `qrcode` API we use; injectable for tests. */
export interface QrImpl {
  toDataURL: (text: string, opts?: Record<string, unknown>) => Promise<string>;
  toString: (text: string, opts?: Record<string, unknown>) => Promise<string>;
}

const defaultImpl: QrImpl = {
  toDataURL: (text, opts) => QRCode.toDataURL(text, opts),
  toString: (text, opts) => QRCode.toString(text, opts),
};

/** Rendering options shared by both formats. */
export interface QrOptions {
  /** Pixel size of the PNG (SVG is vector so this only affects the raster path). */
  width?: number;
  /** Error-correction level; medium is the QR default and fine for short URLs. */
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  /** Quiet-zone margin in modules. */
  margin?: number;
  impl?: QrImpl;
}

const BASE_OPTS = { errorCorrectionLevel: "M", margin: 2 } as const;

/** A `data:image/png;base64,…` URL for the given text, for preview and download. */
export async function toPngDataUrl(text: string, options: QrOptions = {}): Promise<string> {
  if (!text) throw new Error("Nothing to encode.");
  const impl = options.impl ?? defaultImpl;
  return impl.toDataURL(text, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? BASE_OPTS.errorCorrectionLevel,
    margin: options.margin ?? BASE_OPTS.margin,
    width: options.width ?? 256,
  });
}

/** An `<svg>…</svg>` string for the given text, for a vector download. */
export async function toSvgString(text: string, options: QrOptions = {}): Promise<string> {
  if (!text) throw new Error("Nothing to encode.");
  const impl = options.impl ?? defaultImpl;
  return impl.toString(text, {
    errorCorrectionLevel: options.errorCorrectionLevel ?? BASE_OPTS.errorCorrectionLevel,
    margin: options.margin ?? BASE_OPTS.margin,
    type: "svg",
  });
}

/** A filename-safe stem derived from a short URL, e.g. `snp.li/abc` → `snapurl-snp-li-abc`. */
export function qrFilenameStem(shortUrl: string): string {
  const stripped = shortUrl
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `snapurl-${stripped || "qr"}`;
}
