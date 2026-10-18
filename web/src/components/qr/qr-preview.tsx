"use client";

import { useEffect, useState } from "react";
import { buildQrSvg, type QrEcl } from "@/lib/qr-compose";
import { readAccent } from "@/lib/qr-export";

/* Renders a real, scannable QR as SVG. It is the SAME composition the studio exports
   (lib/qr-compose.ts: 4-module quiet zone, centre mark on a backing plate), so the
   preview and the SVG/PNG downloads cannot drift apart (#773). */
export function QrPreview({
  value,
  size = 196,
  dark = "#0C1219",
  light = "#FFFFFF",
  ecl = "Q",
  logo = true,
}: {
  value: string;
  size?: number;
  dark?: string;
  light?: string;
  ecl?: QrEcl;
  logo?: boolean;
}) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [accent, setAccent] = useState<string>(() => readAccent());

  // The mark follows the viewer's accent; Settings → Appearance rewrites it on <html> at runtime.
  useEffect(() => {
    const sync = () => setAccent(readAccent());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    buildQrSvg({ value, size, dark, light, ecl, logo, accent })
      .then((out) => {
        if (!cancelled) {
          setSvg(out);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("That value is too long to encode as a QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, dark, light, ecl, logo, accent]);

  if (error) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid place-items-center text-[11px] text-bad text-center p-4 border border-line rounded-lg"
      >
        {error}
      </div>
    );
  }

  return (
    <div
      className="relative inline-block leading-none [&>svg]:block [&>svg]:w-full [&>svg]:h-full"
      style={{ width: size, height: size }}
      data-testid="qr-preview"
      // The SVG is composed locally by buildQrSvg() from `value` and sanitised colours — nothing is fetched.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
