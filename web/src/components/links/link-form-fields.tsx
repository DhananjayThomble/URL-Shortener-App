"use client";

import { Controller, type Control, type FieldErrors, type UseFormRegister, type UseFormWatch } from "react-hook-form";
import { Button, Field, Input, SectionLabel, Segmented, Toggle } from "@/components/ui";
import { QrPreview } from "@/components/qr/qr-preview";
import { RoutingRulesEditor } from "@/components/links/routing-rules-editor";
import type { CreateLinkFormValues, RedirectType } from "@/lib/api/types";
import { dateInputToIso, isoToDateInput } from "@/components/links/link-form-values";

export { blankOptionalUrlsToUndefined } from "@/components/links/link-form-values";

/* ============================================================
 * The field surface shared by "create a link" and "edit a link".
 *
 * Factored out of create-link-drawer.tsx (G1/#644) so the two forms cannot
 * drift: every field a link can be created with, it can also be edited with,
 * because both render from this one component bound to the same
 * `CreateLinkFormValues` shape (`UpdateLinkInput` is `CreateLinkInput` minus
 * `domain`/`slug` plus `archived` — see packages/contract/src/link.ts).
 *
 * The "Destination" tab's back-half (domain + slug) fields are NOT here —
 * those stay in CreateLinkDrawer only, since moving a link to a new slug
 * would 404 every already-printed/shared copy of the old one (see the
 * comment on UpdateLinkInput in packages/contract).
 * ============================================================ */

export const EDIT_TABS = [
  { id: "dest", label: "Destination" },
  { id: "route", label: "Routing" },
  { id: "access", label: "Access" },
  { id: "utm", label: "UTM" },
  { id: "social", label: "Social preview" },
  { id: "qr", label: "QR" },
] as const;
export type LinkFormTabId = (typeof EDIT_TABS)[number]["id"];

export function LinkFormFields({
  tab,
  idPrefix,
  register,
  control,
  watch,
  formState,
  qrValue,
  showBackHalf,
  passwordPlaceholder = "Leave blank for no password",
  passwordSlot,
}: {
  tab: LinkFormTabId;
  /** Namespaces tabpanel/tab ids so create and edit drawers never collide if ever mounted together. */
  idPrefix: string;
  register: UseFormRegister<CreateLinkFormValues>;
  control: Control<CreateLinkFormValues>;
  watch: UseFormWatch<CreateLinkFormValues>;
  formState: { errors: FieldErrors<CreateLinkFormValues> };
  /** What the QR tab encodes — already-known short link for edit, draft domain/slug for create. */
  qrValue: string;
  /** Renders the back-half (domain + slug) fields on the Destination tab. Off in edit mode — see module doc. */
  showBackHalf?: React.ReactNode;
  /** Placeholder for the password input (edit mode: the stored password is never echoed back). */
  passwordPlaceholder?: string;
  /** Rendered under the password input (edit mode: "remove password"). */
  passwordSlot?: React.ReactNode;
}) {
  const destination = watch("destination");
  const utm = watch("utm");

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
      {tab === "dest" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-dest`} aria-labelledby={`${idPrefix}-tab-dest`} className="flex flex-col gap-[18px]">
          <Field
            label="Destination URL"
            help="You can change this later without breaking the short link."
            error={formState.errors.destination?.message}
          >
            <Input {...register("destination")} placeholder="https://acme.com/collections/spring-2026" className="font-mono text-[12.5px]" spellCheck={false} />
          </Field>

          {showBackHalf}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Folder">
              <Input {...register("folder")} placeholder="Campaigns / Spring 2026" />
            </Field>
            <Field label="Tags" controlId={`${idPrefix}-tags`}>
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <Input
                    id={`${idPrefix}-tags`}
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
        </div>
      )}

      {tab === "route" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-route`} aria-labelledby={`${idPrefix}-tab-route`} className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-[6px]">
            <h4 className="text-[12.5px] font-semibold m-0">Routing rules</h4>
            <p className="text-[11.5px] text-ink-3 leading-[1.5] m-0">
              Rules are checked top to bottom at the edge. The first match wins; anything that matches nothing
              falls through to the default destination.
            </p>
          </div>
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
            <Field
              label="Redirect type"
              help="302 keeps analytics accurate; 301 is better for permanent SEO moves."
              controlId={`${idPrefix}-redirect-type`}
            >
              <Controller
                control={control}
                name="redirectType"
                render={({ field }) => (
                  <Segmented<RedirectType>
                    id={`${idPrefix}-redirect-type`}
                    aria-label="Redirect type"
                    aria-describedby={`${idPrefix}-redirect-type-hint`}
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
                  description="Android opens the app when it is installed and the browser when it isn't. iPhones already do this on their own, and desktops have no app to open."
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
        </div>
      )}

      {tab === "access" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-access`} aria-labelledby={`${idPrefix}-tab-access`} className="flex flex-col gap-[18px]">
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
            <Field label="Go live on" controlId={`${idPrefix}-activates-at`}>
              <Controller
                control={control}
                name="activatesAt"
                render={({ field }) => (
                  <Input
                    type="date"
                    id={`${idPrefix}-activates-at`}
                    value={isoToDateInput(field.value)}
                    onChange={(e) => field.onChange(dateInputToIso(e.target.value, false))}
                  />
                )}
              />
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
            <Field label="Expiry date" controlId={`${idPrefix}-expires-at`}>
              <Controller
                control={control}
                name="expiresAt"
                render={({ field }) => (
                  <Input
                    type="date"
                    id={`${idPrefix}-expires-at`}
                    value={isoToDateInput(field.value)}
                    onChange={(e) => field.onChange(dateInputToIso(e.target.value, true))}
                  />
                )}
              />
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
          <Field label="Click limit" controlId={`${idPrefix}-click-limit`}>
            <Controller
              control={control}
              name="clickLimit"
              render={({ field }) => (
                <Input
                  id={`${idPrefix}-click-limit`}
                  type="number"
                  min={1}
                  step={1}
                  disabled={field.value == null}
                  value={field.value ?? ""}
                  onChange={(e) => field.onChange(e.target.value === "" ? 1 : Math.max(1, Math.floor(Number(e.target.value))))}
                  placeholder="Turn on the click limit above"
                  className="font-mono text-[12.5px]"
                />
              )}
            />
          </Field>
          <Field label="Password" help="Visitors enter it before the redirect happens.">
            <Input type="password" {...register("password")} placeholder={passwordPlaceholder} className="font-mono text-[12.5px]" />
          </Field>
          {passwordSlot}

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
        </div>
      )}

      {tab === "utm" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-utm`} aria-labelledby={`${idPrefix}-tab-utm`} className="flex flex-col gap-[18px]">
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
        </div>
      )}

      {tab === "social" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-social`} aria-labelledby={`${idPrefix}-tab-social`} className="flex flex-col gap-[18px]">
          <div className="flex flex-col gap-[6px]">
            <h4 className="text-[12.5px] font-semibold m-0">Custom social preview</h4>
            <p className="text-[11.5px] text-ink-3 leading-[1.5] m-0">
              Overrides what WhatsApp, Slack, LinkedIn and X show when the link is pasted. Leave blank to use
              the destination&apos;s own tags.
            </p>
          </div>
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
          <Field
            label="Image URL"
            help="An absolute http(s) link to the picture shown in the preview."
            error={formState.errors.social?.image?.message}
          >
            <Input {...register("social.image")} placeholder="https://acme.com/og/spring.png" className="font-mono text-[12.5px]" spellCheck={false} />
          </Field>
        </div>
      )}

      {tab === "qr" && (
        <div role="tabpanel" id={`${idPrefix}-tabpanel-qr`} aria-labelledby={`${idPrefix}-tab-qr`} className="flex flex-col gap-[18px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="bg-surface-2 border border-line rounded-[var(--radius)] p-5 grid place-items-center">
              <QrPreview value={qrValue} size={160} />
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
        </div>
      )}
    </>
  );
}
