"use client";

import { useEffect, useState } from "react";
import { PageHead } from "@/components/app-shell";
import { ACCENTS, useAppearance, type Mode } from "@/components/theme/theme-provider";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Segmented, Skeleton, Toggle } from "@/components/ui";
import { useUpdateWorkspace, useWorkspace } from "@/lib/api/hooks";
import type { RedirectType, Workspace } from "@/lib/api/types";
import { cn, compact } from "@/lib/utils";

/* Retention is offered as three choices but stored as a number of years, so
   "Forever" has to land on something. 100 is the contract's maximum and is
   past the lifetime of any link anyone is planning for. */
const FOREVER_YEARS = 100;
const retentionValue = (years: number) => (years >= FOREVER_YEARS ? "forever" : String(years));

type Draft = Pick<
  Workspace,
  "name" | "slug" | "defaultDomain" | "defaultRedirect" | "retentionYears" | "cookielessAnalytics" | "scanOnCreate" | "publicPreviews"
>;

const draftOf = (ws: Workspace): Draft => ({
  name: ws.name,
  slug: ws.slug,
  defaultDomain: ws.defaultDomain,
  defaultRedirect: ws.defaultRedirect,
  retentionYears: ws.retentionYears,
  cookielessAnalytics: ws.cookielessAnalytics,
  scanOnCreate: ws.scanOnCreate,
  publicPreviews: ws.publicPreviews,
});

export default function SettingsPage() {
  const { data: ws, isLoading } = useWorkspace();
  const appearance = useAppearance();
  const save = useUpdateWorkspace();

  /* Every control below used to be uncontrolled -- defaultValue with no
     onChange and no submit -- so each edit survived exactly until the next
     reload and then silently reverted. The form is now held here and sent
     with the Save button. */
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Seeded once the workspace arrives, and re-seeded if it is refetched while
  // there is nothing unsaved to lose.
  useEffect(() => {
    if (ws && draft === null) setDraft(draftOf(ws));
  }, [ws, draft]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setProblem(null);
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  const dirty = Boolean(ws && draft && JSON.stringify(draft) !== JSON.stringify(draftOf(ws)));

  async function submit() {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }


  return (
    <>
      <PageHead title="Settings" sub={ws?.name ?? "Loading…"} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Workspace" />
            <CardBody className="flex flex-col gap-3.5">
              {isLoading || !draft ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Name">
                      <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
                    </Field>
                    <Field label="Slug" help="Lowercase letters, numbers and dashes.">
                      <Input
                        value={draft.slug}
                        onChange={(e) => set("slug", e.target.value)}
                        className="font-mono text-[12.5px]"
                      />
                    </Field>
                  </div>
                  <Field label="Default domain">
                    <Input
                      value={draft.defaultDomain}
                      onChange={(e) => set("defaultDomain", e.target.value)}
                      className="font-mono text-[12.5px]"
                    />
                  </Field>
                  <Field
                    label="Default redirect type"
                    help="Applies to new links. Any link can override it."
                    error={problem ?? undefined}
                  >
                    <Segmented<RedirectType>
                      value={draft.defaultRedirect}
                      onChange={(v) => set("defaultRedirect", v)}
                      options={[
                        { value: "301", label: "301" },
                        { value: "302", label: "302" },
                        { value: "307", label: "307" },
                      ]}
                    />
                  </Field>
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={submit} disabled={!dirty || save.isPending}>
                      {save.isPending ? "Saving…" : "Save changes"}
                    </Button>
                    {dirty ? (
                      <Button onClick={() => setDraft(ws ? draftOf(ws) : null)}>Discard</Button>
                    ) : (
                      <span className="text-[12px] text-ink-3">{save.isSuccess ? "Saved." : "No unsaved changes."}</span>
                    )}
                  </div>
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
                checked={draft?.cookielessAnalytics ?? true}
                onChange={(v) => set("cookielessAnalytics", v)}
                title="Cookieless analytics"
                description="Visitors are counted server-side with a daily-rotating hash. Nothing is stored on their device."
              />
              <Toggle
                checked={draft?.scanOnCreate ?? true}
                onChange={(v) => set("scanOnCreate", v)}
                title="Scan destinations on create"
                description="Checks every new link against Google Safe Browsing. Needs GOOGLE_SAFE_BROWSING_API_KEY to be set."
              />
              <Toggle
                checked={draft?.publicPreviews ?? true}
                onChange={(v) => set("publicPreviews", v)}
                title="Allow public link previews"
                description="Anyone can add + to a link to see where it goes first."
              />
              <Field
                label="Click data retention"
                help="Rollups are kept regardless; this is how long the raw click rows live. Rows may survive up to a day beyond this setting, since they expire a whole day at a time."
              >
                <Segmented
                  value={retentionValue(draft?.retentionYears ?? 3)}
                  onChange={(v) => set("retentionYears", v === "forever" ? FOREVER_YEARS : Number(v))}
                  options={[
                    { value: "1", label: "1 year" },
                    { value: "3", label: "3 years" },
                    { value: "forever", label: "Forever" },
                  ]}
                />
              </Field>
              <div className="px-[13px] py-[11px] bg-surface-3 rounded-[var(--radius-sm)] text-[12px] text-ink-2 leading-[1.55]">
                Your install sets a maximum retention; you can keep click data for less, but not longer, than that
                maximum, so &ldquo;Forever&rdquo; means up to the operator&apos;s limit. We set no cookies and never sell
                click data. What consent notice your own site needs is a question for your lawyer, and we don&apos;t
                make that claim for you.
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card>
            <CardHeader title="Usage" right={<Chip tone="accent">{ws?.plan ?? "—"}</Chip>} />
            <CardBody className="flex flex-col gap-3.5">
              {/* A real number, counted from the click rollups for the calendar
                  month. It used to be drawn as a bar against clicksIncluded,
                  which implied a cap — and nothing anywhere enforces one, so
                  the bar filled up and then simply kept going. A count that is
                  true beats a gauge that is not. */}
              <div className="flex justify-between items-baseline">
                <span className="text-[12.5px] text-ink-3">Clicks this month</span>
                <b className="text-ink font-mono tnum text-[17px]">
                  {ws ? ws.clicksUsed.toLocaleString() : "—"}
                </b>
              </div>
              <div className="flex flex-col">
                {["Links", "QR codes", "Destination edits", "Custom domains", "Bio pages", "Team members"].map((k) => (
                  <div key={k} className="flex justify-between py-[7px] border-b border-line last:border-b-0 text-[12.5px]">
                    <span className="text-ink-3">{k}</span>
                    <b className="text-good font-semibold">Unlimited</b>
                  </div>
                ))}
              </div>
              {/* The "Manage billing" button that used to sit here went
                  nowhere: there is no payment integration, no entitlement
                  enforcement and no upgrade path behind it. A control that
                  does nothing is worse than an absent one, because someone
                  eventually presses it. See docs/DECISIONS.md. */}
              <div className="px-[13px] py-[11px] bg-wash-good rounded-[var(--radius-sm)] text-[12.5px] text-good leading-[1.5]">
                <b>Everything is free while SnapURL is in development.</b>{" "}
                <span className="text-ink-2">
                  Nothing is metered and there is no billing to manage. Clicks are counted so you can see them, not
                  to charge for them.
                </span>
              </div>
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
