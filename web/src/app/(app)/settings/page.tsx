"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { ACCENTS, useAppearance, type Mode } from "@/components/theme/theme-provider";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Segmented, Skeleton, Toggle } from "@/components/ui";
import { useWorkspace } from "@/lib/api/hooks";
import type { RedirectType } from "@/lib/api/types";
import { cn, compact } from "@/lib/utils";

export default function SettingsPage() {
  const { data: ws, isLoading } = useWorkspace();
  const appearance = useAppearance();
  const [redirect, setRedirect] = useState<RedirectType>("302");
  const [privacy, setPrivacy] = useState({ cookieless: true, scan: true, previews: true });
  const [retention, setRetention] = useState("3");

  const usedPct = ws ? Math.min(100, Math.round((ws.clicksUsed / ws.clicksIncluded) * 100)) : 0;

  return (
    <>
      <PageHead title="Settings" sub={ws?.name ?? "Loading…"} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Workspace" />
            <CardBody className="flex flex-col gap-3.5">
              {isLoading ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Name">
                      <Input defaultValue={ws?.name} />
                    </Field>
                    <Field label="Slug">
                      <Input defaultValue={ws?.slug} className="font-mono text-[12.5px]" />
                    </Field>
                  </div>
                  <Field label="Default domain">
                    <Input defaultValue={ws?.defaultDomain} className="font-mono text-[12.5px]" />
                  </Field>
                  <Field label="Default redirect type" help="Applies to new links. Any link can override it.">
                    <Segmented<RedirectType>
                      value={redirect}
                      onChange={setRedirect}
                      options={[
                        { value: "301", label: "301" },
                        { value: "302", label: "302" },
                        { value: "307", label: "307" },
                      ]}
                    />
                  </Field>
                </>
              )}
            </CardBody>
          </Card>

          {/* ---- Appearance: the theming feature, wired to ThemeProvider ---- */}
          <Card id="appearance">
            <CardHeader title="Appearance" right={<Chip>Saved for you only</Chip>} />
            <CardBody className="flex flex-col gap-4">
              <p className="m-0 text-[13px] text-ink-2">
                Your choice is stored on this device and doesn&apos;t change what anyone else on the team sees.
              </p>

              <Field
                label="Accent colour"
                help="Charts keep a neutral second series, so they stay readable whichever accent you pick."
              >
                <div className="flex gap-[7px] flex-wrap">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.name}
                      title={a.name}
                      aria-label={a.name}
                      aria-pressed={appearance.accent === a.name}
                      onClick={() => appearance.set({ accent: a.name })}
                      style={{ background: a.light }}
                      className={cn(
                        "w-[26px] h-[26px] rounded-[var(--radius-sm)] border-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]",
                        appearance.accent === a.name ? "border-ink" : "border-transparent",
                      )}
                    />
                  ))}
                </div>
              </Field>

              <Field label="Theme">
                <Segmented<Mode>
                  value={appearance.mode}
                  onChange={(mode) => appearance.set({ mode })}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "", label: "Match system" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Density">
                  <Segmented
                    value={appearance.density}
                    onChange={(density) => appearance.set({ density })}
                    options={[
                      { value: "0.72", label: "Compact" },
                      { value: "1", label: "Default" },
                      { value: "1.35", label: "Roomy" },
                    ]}
                  />
                </Field>
                <Field label="Corners">
                  <Segmented
                    value={appearance.radius}
                    onChange={(radius) => appearance.set({ radius })}
                    options={[
                      { value: "2px", label: "Sharp" },
                      { value: "9px", label: "Soft" },
                      { value: "16px", label: "Round" },
                    ]}
                  />
                </Field>
              </div>

              <Toggle
                checked={appearance.reduceMotion}
                onChange={(reduceMotion) => appearance.set({ reduceMotion })}
                title="Reduce motion"
                description="Turns off transitions and animated chart reveals."
              />

              <Button size="sm" className="self-start" onClick={appearance.reset}>
                Reset to defaults
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Privacy & data" />
            <CardBody className="flex flex-col gap-3">
              <Toggle
                checked={privacy.cookieless}
                onChange={(v) => setPrivacy((p) => ({ ...p, cookieless: v }))}
                title="Cookieless analytics"
                description="Visitors are counted server-side with a daily-rotating hash. Nothing is stored on their device."
              />
              <Toggle
                checked={privacy.scan}
                onChange={(v) => setPrivacy((p) => ({ ...p, scan: v }))}
                title="Scan destinations on create"
                description="Checks every new link against Google Safe Browsing."
              />
              <Toggle
                checked={privacy.previews}
                onChange={(v) => setPrivacy((p) => ({ ...p, previews: v }))}
                title="Allow public link previews"
                description="Anyone can add + to a link to see where it goes first."
              />
              <Field label="Click data retention">
                <Segmented
                  value={retention}
                  onChange={setRetention}
                  options={[
                    { value: "1", label: "1 year" },
                    { value: "3", label: "3 years" },
                    { value: "forever", label: "Forever" },
                  ]}
                />
              </Field>
              <div className="px-[13px] py-[11px] bg-surface-3 rounded-[var(--radius-sm)] text-[12px] text-ink-2 leading-[1.55]">
                We set no cookies and never sell click data. What consent notice your own site needs is a question for
                your lawyer — we don&apos;t make that claim for you.
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Plan & usage" right={<Chip tone="accent">{ws?.plan ?? "—"}</Chip>} />
            <CardBody className="flex flex-col gap-3.5">
              <div>
                <div className="flex justify-between text-[11.5px] text-ink-3 mb-[6px]">
                  <span>Clicks this month</span>
                  <b className="text-ink-2 font-mono tnum">
                    {ws ? `${ws.clicksUsed.toLocaleString()} / ${ws.clicksIncluded.toLocaleString()}` : "—"}
                  </b>
                </div>
                <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
                  <i className="block h-full bg-accent rounded-full" style={{ width: `${usedPct}%` }} />
                </div>
              </div>
              <div className="flex flex-col">
                {["Links", "QR codes", "Destination edits", "Custom domains", "Bio pages", "Team members"].map((k) => (
                  <div key={k} className="flex justify-between py-[7px] border-b border-line last:border-b-0 text-[12.5px]">
                    <span className="text-ink-3">{k}</span>
                    <b className="text-good font-semibold">Unlimited</b>
                  </div>
                ))}
              </div>
              <div className="px-[13px] py-[11px] bg-wash-good rounded-[var(--radius-sm)] text-[12.5px] text-good leading-[1.5]">
                <b>Clicks are the only thing we count.</b>{" "}
                <span className="text-ink-2">Nothing else is metered, on any plan.</span>
              </div>
              <Button className="justify-center">Manage billing</Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Link permanence"
              right={
                <Chip tone="good" dot>
                  Guaranteed
                </Chip>
              }
            />
            <CardBody className="flex flex-col gap-3 text-[13px] text-ink-2">
              {[
                <>
                  Cancelling or downgrading makes your links <b className="text-ink">read-only</b> — they keep
                  redirecting forever.
                </>,
                <>No scan caps. A QR code that gets popular never stops working.</>,
                <>We never inject ads or interstitials into links already in the wild.</>,
                <>Your custom domain means you can leave and take every printed code with you.</>,
              ].map((line, i) => (
                <div key={i} className="flex gap-2.5 items-start leading-[1.55]">
                  <span className="text-good shrink-0 font-bold">✓</span>
                  <span>{line}</span>
                </div>
              ))}
              <Button size="sm" className="self-start mt-0.5">
                Read the guarantee
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Export & portability" />
            <CardBody className="flex flex-col gap-2">
              {[
                ["Export everything", "links · clicks · settings"],
                ["Import from Bitly", "CSV or API"],
                ["Import from Short.io", "API"],
                ["Self-host this workspace", "docker compose up"],
              ].map(([label, hint], i) => (
                <Button key={label} className="justify-between">
                  {label}
                  <span className={cn("font-mono text-[11px]", i === 3 ? "text-good" : "text-ink-3")}>{hint}</span>
                </Button>
              ))}
            </CardBody>
          </Card>

          <Card className="border-bad">
            <CardHeader title={<span className="text-bad">Danger zone</span>} className="border-b-bad" />
            <CardBody className="flex flex-col gap-2.5">
              <div className="text-[12.5px] text-ink-2 leading-[1.55]">
                Deleting a workspace breaks every link in it, including printed QR codes. We&apos;ll make you type the
                workspace name and wait 7 days first.
              </div>
              <Button variant="danger" className="justify-center">
                Delete workspace
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
