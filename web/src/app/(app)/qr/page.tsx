"use client";

import { useMemo, useState } from "react";
import { PageHead } from "@/components/app-shell";
import { QrPreview } from "@/components/qr/qr-preview";
import { Button, Card, CardBody, CardHeader, Field, Segmented, Skeleton, Toggle } from "@/components/ui";
import { useLinks } from "@/lib/api/hooks";
import { buildQrSvg } from "@/lib/qr-compose";
import { eclHelp } from "@/lib/qr-ecl";
import { readAccent, saveBlob, svgToPngBlob } from "@/lib/qr-export";
import { cn, shortUrlHref } from "@/lib/utils";

const FOREGROUNDS = ["#0C1219", "#1F5FD4", "#0B6E80", "#5B4BC4"];

export default function QrStudioPage() {
  const { data, isLoading } = useLinks();
  const links = data?.items ?? [];
  const [selected, setSelected] = useState(0);
  const [fg, setFg] = useState(FOREGROUNDS[0]);
  const [ecl, setEcl] = useState<"L" | "M" | "Q" | "H">("Q");
  const [logo, setLogo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const eclInfo = eclHelp(ecl, logo);

  const link = links[selected];
  const value = link ? shortUrlHref(link.domain, link.slug) : "";

  const filename = useMemo(() => (link ? `${link.domain}-${link.slug}` : "snapurl"), [link]);

  /** Downloads happen client-side; nothing round-trips through a server. The file is the
      preview's own composition (lib/qr-compose.ts): same quiet zone, same logo (#773). */
  async function download(format: "svg" | "png") {
    if (!value) return;
    setBusy(true);
    setDownloadError(null);
    try {
      const px = format === "svg" ? 1024 : 2048;
      const svg = await buildQrSvg({ value, size: px, dark: fg, light: "#FFFFFF", ecl, logo, accent: readAccent() });
      const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml" }) : await svgToPngBlob(svg, px);
      saveBlob(blob, `${filename}.${format}`);
    } catch {
      setDownloadError("Couldn't prepare the download. Try again.");
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
                aria-label="Select link for QR code"
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
                      aria-label={`Foreground colour ${c}`}
                      onClick={() => setFg(c)}
                      style={{ background: c }}
                      /* Every swatch carries a theme-token outline (--ink-3: >= 3:1 on every surface in
                         both themes, WCAG 1.4.11), so the near-black one no longer vanishes into the
                         dark card (#774). The picked one adds a gap + --ink ring. */
                      className={cn(
                        "w-[26px] h-[26px] rounded-[var(--radius-sm)] border border-ink-3",
                        fg === c && "shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--ink)]",
                      )}
                    />
                  ))}
                </div>
              </Field>
              <Field
                label="Error correction"
                controlId="qr-error-correction"
                help={
                  <>
                    <span data-testid="qr-ecl-help">{eclInfo.text}</span>
                    {/* Always mounted so assistive tech announces the notice when it appears. */}
                    <span role="status" data-testid="qr-ecl-notice" className="block text-amber">
                      {eclInfo.notice}
                    </span>
                  </>
                }
              >
                <Segmented
                  id="qr-error-correction"
                  aria-label="Error correction"
                  aria-describedby="qr-error-correction-hint"
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
              {downloadError ? (
                <p role="alert" className="text-[12px] text-bad">
                  {downloadError}
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
