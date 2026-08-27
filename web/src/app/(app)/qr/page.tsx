"use client";

import { useMemo, useState } from "react";
import QRCode from "qrcode";
import { PageHead } from "@/components/app-shell";
import { QrPreview } from "@/components/qr/qr-preview";
import { Button, Card, CardBody, CardHeader, Field, Segmented, Skeleton, Toggle } from "@/components/ui";
import { useLinks } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

const FOREGROUNDS = ["#0C1219", "#1F5FD4", "#0B6E80", "#5B4BC4"];

export default function QrStudioPage() {
  const { data, isLoading } = useLinks();
  const links = data?.items ?? [];
  const [selected, setSelected] = useState(0);
  const [fg, setFg] = useState(FOREGROUNDS[0]);
  const [ecl, setEcl] = useState<"L" | "M" | "Q" | "H">("Q");
  const [logo, setLogo] = useState(true);
  const [busy, setBusy] = useState(false);

  const link = links[selected];
  const value = link ? `https://${link.domain}/${link.slug}` : "";

  const filename = useMemo(() => (link ? `${link.domain}-${link.slug}` : "snapurl"), [link]);

  /** Downloads happen client-side; nothing round-trips through a server. */
  async function download(format: "svg" | "png") {
    if (!value) return;
    setBusy(true);
    try {
      let blob: Blob;
      if (format === "svg") {
        const svg = await QRCode.toString(value, {
          type: "svg",
          errorCorrectionLevel: ecl,
          margin: 1,
          width: 1024,
          color: { dark: fg, light: "#FFFFFF" },
        });
        blob = new Blob([svg], { type: "image/svg+xml" });
      } else {
        const dataUrl = await QRCode.toDataURL(value, {
          errorCorrectionLevel: ecl,
          margin: 1,
          width: 2048,
          color: { dark: fg, light: "#FFFFFF" },
        });
        blob = await (await fetch(dataUrl)).blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filename}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="QR studio"
        sub="Every code is dynamic — re-point it after it is printed, and the printed code keeps working."
        actions={
          <>
            <Button>Bulk generate</Button>
            <Button variant="primary" disabled={busy || !value} onClick={() => download("png")}>
              {busy ? "Preparing…" : "Download"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 items-start">
        <div className="bg-surface-2 border border-line rounded-[var(--radius)] grid place-items-center p-8 min-h-[300px]">
          {isLoading ? (
            <Skeleton className="w-[236px] h-[280px]" />
          ) : link ? (
            <div className="bg-white p-5 rounded-xl shadow-[var(--shadow-2)] flex flex-col items-center gap-3">
              <QrPreview value={value} size={196} dark={fg} ecl={ecl} logo={logo} />
              <div className="font-display text-[12px] font-bold text-[#0C1219] tracking-[0.02em]">
                {link.domain}/{link.slug}
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">Create a link first and its QR code will appear here.</p>
          )}
        </div>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Link" />
            <CardBody>
              <select
                value={selected}
                onChange={(e) => setSelected(Number(e.target.value))}
                className="w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[13px] font-mono focus:outline-none focus:border-accent"
              >
                {links.map((l, i) => (
                  <option key={l.id} value={i}>
                    {l.domain}/{l.slug}
                  </option>
                ))}
              </select>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Style" />
            <CardBody className="flex flex-col gap-3.5">
              <Field label="Foreground">
                <div className="flex gap-[7px] flex-wrap">
                  {FOREGROUNDS.map((c) => (
                    <button
                      key={c}
                      aria-pressed={fg === c}
                      onClick={() => setFg(c)}
                      style={{ background: c }}
                      className={cn(
                        "w-[26px] h-[26px] rounded-[var(--radius-sm)] border-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]",
                        fg === c ? "border-ink" : "border-transparent",
                      )}
                    />
                  ))}
                </div>
              </Field>
              <Field label="Error correction" help="Q tolerates a centre logo and light print wear.">
                <Segmented
                  value={ecl}
                  onChange={setEcl}
                  options={[
                    { value: "L", label: "L" },
                    { value: "M", label: "M" },
                    { value: "Q", label: "Q" },
                    { value: "H", label: "H" },
                  ]}
                />
              </Field>
              <Toggle checked={logo} onChange={setLogo} title="Centre logo" description="Uses your workspace mark." />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Export" />
            <CardBody className="flex flex-col gap-2">
              <Button className="justify-between" disabled={busy || !value} onClick={() => download("svg")}>
                SVG <span className="font-mono text-[11px] text-ink-3">vector, print</span>
              </Button>
              <Button className="justify-between" disabled={busy || !value} onClick={() => download("png")}>
                PNG <span className="font-mono text-[11px] text-ink-3">2048 px</span>
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
