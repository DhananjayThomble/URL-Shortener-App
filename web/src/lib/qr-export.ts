import { QR_DEFAULT_ACCENT, safeColor } from "./qr-compose";

/* Browser-only helpers for the QR studio: resolve the accent, rasterise the composed SVG to
   a PNG, and hand a blob to the user. Kept apart from qr-compose.ts so that file stays pure
   (and unit-testable under Node). */

/** The viewer's current accent as a concrete colour (the preview mark cannot use `var(--accent)` inside a data: URI). */
export function readAccent(): string {
  if (typeof document === "undefined") return QR_DEFAULT_ACCENT;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  return safeColor(raw, QR_DEFAULT_ACCENT);
}

/** Rasterise a composed QR SVG to a square PNG of `px` × `px`. */
export async function svgToPngBlob(svg: string, px: number): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterise the QR code."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(img, 0, 0, px, px);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the PNG."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Not revoked synchronously: some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
