"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button, Field, Input, SectionLabel, Segmented, Toggle } from "@/components/ui";
import { QrPreview } from "@/components/qr/qr-preview";
import { RoutingRulesEditor } from "@/components/links/routing-rules-editor";
import { useCreateLink, useDomains } from "@/lib/api/hooks";
import { CreateLinkInput, type CreateLinkFormValues, type RedirectType } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "dest", label: "Destination" },
  { id: "route", label: "Routing" },
  { id: "access", label: "Access" },
  { id: "utm", label: "UTM" },
  { id: "social", label: "Social preview" },
  { id: "qr", label: "QR" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function CreateLinkDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("dest");
  const { data: domains } = useDomains();
  const create = useCreateLink();

  const form = useForm<CreateLinkFormValues, unknown, CreateLinkInput>({
    resolver: zodResolver(CreateLinkInput),
    defaultValues: {
      destination: "",
      domain: "snap.to",
      slug: "",
      tags: [],
      redirectType: "302",
      rules: [],
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    },
  });

  const { register, handleSubmit, control, watch, reset, formState } = form;
  const destination = watch("destination");
  const domain = watch("domain");
  const slug = watch("slug");
  const utm = watch("utm");

  // Escape closes; body scroll locks while the drawer owns the screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      reset();
      setTab("dest");
      create.reset();
    }
    // `create` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  if (!open) return null;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      onClose();
    } catch {
      /* surfaced below via create.error */
    }
  });

  const finalUrl = (() => {
    if (!destination) return "";
    const params = new URLSearchParams();
    if (utm?.source) params.set("utm_source", utm.source);
    if (utm?.medium) params.set("utm_medium", utm.medium);
    if (utm?.campaign) params.set("utm_campaign", utm.campaign);
    if (utm?.content) params.set("utm_content", utm.content);
    const qs = params.toString();
    return qs ? `${destination}${destination.includes("?") ? "&" : "?"}${qs}` : destination;
  })();

  return (
    <>
      <div className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[100] backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create a link"
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[620px] bg-surface border-l border-line-2 z-[101] flex flex-col shadow-[var(--shadow-3)]"
      >
        <div className="flex items-center gap-3 px-5 py-[17px] border-b border-line">
          <h2 className="text-[17px] font-bold">New link</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-ink-3 text-[18px] px-[9px] py-1 rounded-[5px] hover:bg-surface-3 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-px px-5 border-b border-line overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-[13px] py-[10px] text-[12.5px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                tab === t.id ? "text-accent border-accent font-semibold" : "text-ink-3 border-transparent hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
            {tab === "dest" && (
              <>
                <Field
                  label="Destination URL"
                  help="You can change this later without breaking the short link."
                  error={formState.errors.destination?.message}
                >
                  <Input {...register("destination")} placeholder="https://acme.com/collections/spring-2026" className="font-mono text-[12.5px]" spellCheck={false} />
                </Field>

                <Field label="Short link" help="Leave blank for a random slug." error={formState.errors.slug?.message}>
                  <div className="flex items-stretch">
                    <select
                      {...register("domain")}
                      className="px-[11px] py-[9px] bg-surface-3 border border-line-2 border-r-0 rounded-l-[var(--radius-sm)] font-mono text-[12.5px] text-ink-2 focus:outline-none"
                    >
                      {(domains ?? []).map((d) => (
                        <option key={d.id} value={d.domain}>
                          {d.domain}
                        </option>
                      ))}
                    </select>
                    <Input {...register("slug")} placeholder="spring-sale" className="rounded-l-none font-mono text-[12.5px]" spellCheck={false} />
                  </div>
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Folder">
                    <Input {...register("folder")} placeholder="Campaigns / Spring 2026" />
                  </Field>
                  <Field label="Tags">
                    <Controller
                      control={control}
                      name="tags"
                      render={({ field }) => (
                        <Input
                          value={field.value?.join(", ") ?? ""}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value
                                .split(",")
                                .map((t) => t.trim())
                                .filter(Boolean),
                            )
                          }
                          placeholder="campaign/spring, social"
                        />
                      )}
                    />
                  </Field>
                </div>

                <Field label={<>Comment <span className="font-normal text-ink-3">optional</span></>}>
                  <Input {...register("comment")} placeholder="What is this link for? Your team will thank you." />
                </Field>

              </>
            )}

            {tab === "route" && (
              <>
                <Field
                  label="Routing rules"
                  help="Rules are checked top to bottom at the edge. The first match wins; anything that matches nothing falls through to the default destination."
                >
                  <div />
                </Field>
                <Controller
                  control={control}
                  name="rules"
                  render={({ field }) => (
                    <RoutingRulesEditor
                      value={field.value ?? []}
                      onChange={field.onChange}
                      fallbackDestination={destination}
                    />
                  )}
                />

                <SectionLabel>Redirect behaviour</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Redirect type" help="302 keeps analytics accurate; 301 is better for permanent SEO moves.">
                    <Controller
                      control={control}
                      name="redirectType"
                      render={({ field }) => (
                        <Segmented<RedirectType>
                          value={field.value ?? "302"}
                          onChange={field.onChange}
                          options={[
                            { value: "301", label: "301" },
                            { value: "302", label: "302" },
                            { value: "307", label: "307" },
                          ]}
                        />
                      )}
                    />
                  </Field>
                  <Controller
                    control={control}
                    name="deepLink"
                    render={({ field }) => (
                      <Toggle
                        checked={field.value ?? false}
                        onChange={field.onChange}
                        title="Deep link into app"
                        description="Opens the native app when it is installed."
                      />
                    )}
                  />
                </div>
                <Controller
                  control={control}
                  name="forwardQuery"
                  render={({ field }) => (
                    <Toggle
                      checked={field.value ?? true}
                      onChange={field.onChange}
                      title="Forward query parameters"
                      description="Anything after the ? is passed through to the destination."
                    />
                  )}
                />
              </>
            )}

            {tab === "access" && (
              <>
                <Controller
                  control={control}
                  name="activatesAt"
                  render={({ field }) => (
                    <Toggle
                      checked={Boolean(field.value)}
                      onChange={(v) => field.onChange(v ? new Date(Date.now() + 7 * 864e5).toISOString() : null)}
                      title="Go live on a date"
                      description="The short link exists straight away — print it, share it — but does not carry anyone to the destination until then."
                    />
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Go live on">
                    <Input type="date" {...register("activatesAt")} />
                  </Field>
                  <Field label="Until then, send visitors to" help="Leave blank and they get a plain 'not live yet' page.">
                    <Input {...register("scheduledTo")} placeholder="acme.com/coming-soon" className="font-mono text-[12.5px]" />
                  </Field>
                </div>
                <Controller
                  control={control}
                  name="expiresAt"
                  render={({ field }) => (
                    <Toggle
                      checked={Boolean(field.value)}
                      onChange={(v) => field.onChange(v ? new Date(Date.now() + 30 * 864e5).toISOString() : null)}
                      title="Expire on a date"
                      description="The link stops working after the date you pick."
                    />
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Expiry date">
                    <Input type="date" {...register("expiresAt")} />
                  </Field>
                  <Field label="Then send visitors to">
                    <Input {...register("expiresTo")} placeholder="acme.com/offers" className="font-mono text-[12.5px]" />
                  </Field>
                </div>
                <Controller
                  control={control}
                  name="clickLimit"
                  render={({ field }) => (
                    <Toggle
                      checked={field.value != null}
                      onChange={(v) => field.onChange(v ? 500 : null)}
                      title="Expire after a click limit"
                      description="Useful for limited redemptions and private betas."
                    />
                  )}
                />
                <Field label="Password" help="Visitors enter it before the redirect happens.">
                  <Input type="password" {...register("password")} placeholder="Leave blank for no password" className="font-mono text-[12.5px]" />
                </Field>

                <SectionLabel>Privacy</SectionLabel>
                <Controller
                  control={control}
                  name="hideReferrer"
                  render={({ field }) => (
                    <Toggle
                      checked={field.value ?? false}
                      onChange={field.onChange}
                      title="Hide the referrer"
                      description="The destination will not see where the click came from."
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="publicPreview"
                  render={({ field }) => (
                    <Toggle
                      checked={field.value ?? true}
                      onChange={field.onChange}
                      title="Allow public preview"
                      description="Anyone can add + to check the destination before clicking."
                    />
                  )}
                />
              </>
            )}

            {tab === "utm" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="utm_source">
                    <Input {...register("utm.source")} placeholder="instagram" className="font-mono text-[12.5px]" />
                  </Field>
                  <Field label="utm_medium">
                    <Input {...register("utm.medium")} placeholder="social" className="font-mono text-[12.5px]" />
                  </Field>
                  <Field label="utm_campaign">
                    <Input {...register("utm.campaign")} placeholder="spring_2026" className="font-mono text-[12.5px]" />
                  </Field>
                  <Field label="utm_content">
                    <Input {...register("utm.content")} placeholder="story_swipe_up" className="font-mono text-[12.5px]" />
                  </Field>
                </div>
                <Field label="Final URL">
                  <div className="px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-3 text-ink-2 font-mono text-[12px] break-all leading-[1.7] min-h-[40px]">
                    {finalUrl || <span className="text-ink-3">Add a destination to see the final URL.</span>}
                  </div>
                </Field>
              </>
            )}

            {tab === "social" && (
              <>
                <Field
                  label="Custom social preview"
                  help="Overrides what WhatsApp, Slack, LinkedIn and X show when the link is pasted. Leave blank to use the destination's own tags."
                >
                  <div />
                </Field>
                <div className="border border-line rounded-[var(--radius)] overflow-hidden bg-surface-2">
                  <div className="h-[132px] grid place-items-center text-white font-display font-extrabold text-[22px] tracking-[-0.02em] bg-[linear-gradient(120deg,var(--accent)_0%,var(--violet)_100%)]">
                    {watch("social.title") || "Your preview image"}
                  </div>
                  <div className="px-[15px] py-[13px]">
                    <div className="font-mono text-[10px] text-ink-3 uppercase tracking-[0.1em]">
                      {(() => {
                        try {
                          return new URL(destination).hostname;
                        } catch {
                          return "acme.com";
                        }
                      })()}
                    </div>
                    <div className="font-bold text-[14px] mt-1">{watch("social.title") || "Spring Sale 2026 — up to 40% off"}</div>
                    <div className="text-[12.5px] text-ink-3 mt-[3px]">
                      {watch("social.description") || "Everything in the spring collection, now through 30 September."}
                    </div>
                  </div>
                </div>
                <Field label="Title">
                  <Input {...register("social.title")} placeholder="Spring Sale 2026 — up to 40% off" />
                </Field>
                <Field label="Description">
                  <Input {...register("social.description")} placeholder="Everything in the spring collection." />
                </Field>
              </>
            )}

            {tab === "qr" && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                  <div className="bg-surface-2 border border-line rounded-[var(--radius)] p-5 grid place-items-center">
                    <QrPreview value={`https://${domain}/${slug || "your-slug"}`} size={160} />
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-[13px] text-ink-2 m-0">
                      The code encodes your short link, so you can change the destination later and every printed copy
                      keeps working.
                    </p>
                    <Button type="button" className="justify-center">
                      SVG · PNG · PDF
                    </Button>
                  </div>
                </div>
                <div className="px-[13px] py-3 bg-wash-teal rounded-[var(--radius-sm)] text-[12.5px] text-teal leading-[1.5]">
                  <b>This QR is dynamic.</b>{" "}
                  <span className="text-ink-2">
                    Print it now and you can still change where it points later — the printed code never goes stale.
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-[10px] px-5 py-[14px] border-t border-line bg-surface-2">
            {create.isError ? (
              <span className="text-[12px] text-bad">{(create.error as Error).message}</span>
            ) : (
              <span className="text-[11.5px] text-ink-3">Links are never metered — only clicks are.</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create link"}
              </Button>
            </div>
          </div>
        </form>
      </aside>
    </>
  );
}
