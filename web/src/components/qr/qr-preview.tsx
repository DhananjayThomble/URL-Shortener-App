"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/* Renders a real, scannable QR as SVG. Unlike the prototype's decorative
   stand-in this encodes the actual short link, so it can be exported and
   printed straight from the UI. */
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
  ecl?: "L" | "M" | "Q" | "H";
  logo?: boolean;
}) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value || " ", {
      type: "svg",
      errorCorrectionLevel: ecl,
      margin: 1,
      width: size,
      color: { dark, light },
    })
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
  }, [value, size, dark, light, ecl]);

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
    <div className="relative inline-block leading-none" style={{ width: size, height: size }}>
      <div
        className="[&>svg]:block [&>svg]:w-full [&>svg]:h-full"
        // qrcode's SVG output is generated locally from `value`, not fetched.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {logo && svg ? (
        <span
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-[6px] font-display font-extrabold text-white"
          style={{
            width: size * 0.2,
            height: size * 0.2,
            background: "var(--accent)",
            fontSize: size * 0.12,
            boxShadow: `0 0 0 ${size * 0.025}px ${light}`,
          }}
        >
          S
        </span>
      ) : null}
    </div>
  );
}
