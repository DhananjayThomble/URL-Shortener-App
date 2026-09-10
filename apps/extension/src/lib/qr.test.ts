import { describe, expect, it, vi } from "vitest";

import { qrFilenameStem, toPngDataUrl, toSvgString } from "./qr.js";
import type { QrImpl } from "./qr.js";

/*
 * QR wrapper tests. The bundled `qrcode` dependency is injected so these run
 * without touching the real library — they assert the wrapper's contract
 * (options passed through, empty input rejected, filename derivation).
 */

function fakeImpl(): QrImpl {
  return {
    toDataURL: vi.fn(async (text: string) => `data:image/png;base64,${btoa(text)}`),
    toString: vi.fn(async (text: string) => `<svg data-text="${text}"></svg>`),
  };
}

describe("toPngDataUrl", () => {
  it("returns a png data url and forwards sizing options", async () => {
    const impl = fakeImpl();
    const out = await toPngDataUrl("https://snp.li/abc", { impl, width: 512 });
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    const opts = (impl.toDataURL as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(opts.width).toBe(512);
    expect(opts.errorCorrectionLevel).toBe("M");
  });

  it("rejects empty input", async () => {
    await expect(toPngDataUrl("", { impl: fakeImpl() })).rejects.toThrow();
  });
});

describe("toSvgString", () => {
  it("returns an svg string with type svg forwarded", async () => {
    const impl = fakeImpl();
    const out = await toSvgString("https://snp.li/abc", { impl });
    expect(out).toContain("<svg");
    const opts = (impl.toString as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(opts.type).toBe("svg");
  });
});

describe("qrFilenameStem", () => {
  it("derives a filename-safe stem from a short url", () => {
    expect(qrFilenameStem("https://snp.li/abc")).toBe("snapurl-snp-li-abc");
    expect(qrFilenameStem("http://localhost:3002/x")).toBe("snapurl-localhost-3002-x");
  });
});
