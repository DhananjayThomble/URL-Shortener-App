"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button, Field, Input } from "@/components/ui";
import { EDIT_TABS as TABS, blankOptionalUrlsToUndefined, LinkFormFields, type LinkFormTabId } from "@/components/links/link-form-fields";
import { tabsWithErrors } from "@/components/links/link-form-values";
import { useCreateLink, useDomains } from "@/lib/api/hooks";
import { CreateLinkInput, type CreateLinkFormValues } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type TabId = LinkFormTabId;

export function CreateLinkDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>("dest");
  const { data: domains } = useDomains();
  const create = useCreateLink();
  const drawerRef = useRef<HTMLElement>(null);

  // `onClose` is passed as a fresh inline closure by the parent on every one
  // of its own re-renders (e.g. a background refetch of links/domains/members
  // while the drawer is open). Reading it through a ref, rather than putting
  // it in the trap effect's dependency array below, means that effect's setup
  // — which seizes initial focus and captures `trigger` for restore-on-close —
  // runs exactly once per open/close, not on every unrelated parent re-render.
  // Previously it depended on `[open, onClose]`: any re-render with a new
  // `onClose` identity tore the trap down and re-ran it while the drawer was
  // still open, silently yanking focus back to the drawer's first field out
  // from under whatever the user was doing (mid Tab/Shift+Tab traversal, or
  // mid-typing) and re-capturing "trigger" from whatever had focus at that
  // moment instead of the element that actually opened the drawer.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const form = useForm<CreateLinkFormValues, unknown, CreateLinkInput>({
    // Wraps zodResolver so an untouched expiresTo/scheduledTo ("" — see
    // blankOptionalUrlsToUndefined's docblock) is treated as "not set"
    // before CreateLinkInput, unmodified, validates the rest.
    resolver: (values, context, options) => zodResolver(CreateLinkInput)(blankOptionalUrlsToUndefined(values), context, options),
    defaultValues: {
      destination: "",
      // Left blank here and filled from the workspace's own domains once they
      // load (see the effect below). Hardcoding a production domain like
      // "snap.to" made the first create in any other workspace fail with
      // "snap.to isn't a domain you can use" until the user changed it.
      domain: "",
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

  const { register, handleSubmit, control, watch, reset, setValue, formState } = form;
  const domain = watch("domain");
  const slug = watch("slug");

  // Only one tab's fields are mounted at a time, so a validation error on a
  // tab the user is not looking at would otherwise be invisible (#645: the
  // submit just did nothing). Surface which tabs hold errors.
  const invalidTabs = tabsWithErrors(formState.errors as Record<string, unknown>) as TabId[];

  // Default the back-half domain to the workspace's own first domain once the
  // list loads, unless the user has already picked one. Avoids hardcoding a
  // domain the workspace may not own.
  useEffect(() => {
    if (!domain && domains?.length) {
      setValue("domain", domains[0].domain);
    }
  }, [domains, domain, setValue]);

  // Escape closes; body scroll locks; focus is trapped inside the drawer while
  // it is open — Tab/Shift+Tab cycle within it, never leaking to content behind.
  useEffect(() => {
    if (!open) return;

    const el = drawerRef.current;
    if (!el) return;

    // Whatever had focus when the drawer opened (the "New link" trigger in the
    // sidebar/topbar) — restored on close so keyboard/AT users land back where
    // they were, however the drawer closes (Escape, ✕, Cancel, or a successful
    // submit all flow through the same `open` → false transition).
    const trigger = document.activeElement as HTMLElement | null;

    // Selector for anything that CAN receive keyboard focus in principle. Note
    // this alone is not sufficient: a native control given `tabIndex={-1}` as a
    // prop (e.g. the inactive tabs in the roving-tabindex tablist below) still
    // matches `button:not([disabled])` here, because the `[tabindex]:not(...)`
    // clause only excludes elements that rely on the tabindex *attribute* for
    // focusability — it does not override a match already won by another
    // comma-separated clause. Filtering on the live `.tabIndex` property below
    // (which reflects the actual prop, unlike a stale attribute selector) is
    // what keeps this list in sync with the browser's real Tab order.
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

    const queryFocusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
      );

    // Move initial focus to the first focusable element in the drawer.
    const first = queryFocusable()[0];
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = queryFocusable();
      if (focusable.length === 0) return;

      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
      // Restore focus to the trigger, but only if it is still attached and
      // still focusable — a route change or re-render could have removed it.
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open]);

  // Reset on BOTH transitions. Resetting only on open left a closed drawer
  // holding the abandoned attempt (typed values, errors, a stale server
  // error) until the next open; clearing at close means nothing from one
  // attempt can leak into the next, whichever way the drawer was dismissed.
  useEffect(() => {
    reset();
    setTab("dest");
    create.reset();
    // `create` is a stable mutation object; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset]);

  // `useMutation` returns a brand-new result object on every render (its
  // `mutate`/`mutateAsync` are wrapped per call, see @tanstack/react-query's
  // useMutation.js), so an effect with an empty-ish dependency array that
  // closes over `create` directly would freeze on whichever render it first
  // ran in — exactly the staleness this effect exists to fix, just moved into
  // the harness instead of the UI. Read it through a ref, same pattern as
  // `onCloseRef` above, so the subscription below always sees the current
  // mutation state without needing to resubscribe on every render.
  const createRef = useRef(create);
  createRef.current = create;

  // Clear a previous submission's server error the moment the user changes
  // anything, so a stale message (e.g. "…is already taken" for a back-half
  // that was since edited) never sits alongside, or in place of, a new error
  // for the current input (issue #640). `watch`'s callback form subscribes
  // without forcing a render on every keystroke; the subscription is torn
  // down on unmount/re-run via the returned `unsubscribe`.
  useEffect(() => {
    const { unsubscribe } = watch(() => {
      if (createRef.current.isError) createRef.current.reset();
    });
    return () => unsubscribe();
  }, [watch]);

  if (!open) return null;

  const onSubmit = handleSubmit(async (values) => {
    // Clear any previous failure before the new attempt lands, so a slow
    // request never leaves the old message on screen while this one is
    // in flight, and a validation-only resubmit (same values, now passing
    // react-hook-form's resolver) still drops the stale server error.
    create.reset();
    try {
      await create.mutateAsync(values);
      onClose();
    } catch {
      /* surfaced below via create.error */
    }
  }, (errors) => onInvalid(errors as Record<string, unknown>));

  // Submit rejected by validation: land the user on the first tab that holds
  // an error instead of leaving them on a tab where nothing looks wrong.
  const onInvalid = (errors: Record<string, unknown>) => {
    const bad = tabsWithErrors(errors) as TabId[];
    if (bad.length > 0 && !bad.includes(tab)) setTab(bad[0]);
  };
  const tabLabel = (id: TabId) => TABS.find((t) => t.id === id)?.label ?? id;

  return (
    <>
      <div className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[100] backdrop-blur-[2px]" onClick={onClose} />
      <aside
        ref={drawerRef}
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

        <div role="tablist" aria-label="Link settings" className="flex gap-px px-5 border-b border-line overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`create-link-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              data-invalid={invalidTabs.includes(t.id) ? "true" : undefined}
              aria-controls={`create-link-tabpanel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
                e.preventDefault();
                const currentIndex = TABS.findIndex((candidate) => candidate.id === tab);
                let nextIndex = currentIndex;
                if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
                if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
                if (e.key === "Home") nextIndex = 0;
                if (e.key === "End") nextIndex = TABS.length - 1;
                const nextId = TABS[nextIndex].id;
                setTab(nextId);
                document.getElementById(`create-link-tab-${nextId}`)?.focus();
              }}
              className={cn(
                "px-[13px] py-[10px] text-[12.5px] font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                tab === t.id ? "text-accent border-accent font-semibold" : "text-ink-3 border-transparent hover:text-ink",
              )}
            >
              {t.label}
              {invalidTabs.includes(t.id) ? (
                <>
                  <span aria-hidden="true" className="ml-[6px] inline-block w-[6px] h-[6px] rounded-full bg-bad align-middle" />
                  <span className="sr-only"> (has an error)</span>
                </>
              ) : null}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="flex-1 flex flex-col min-h-0">
          {invalidTabs.length > 0 ? (
            <div
              role="alert"
              className="px-5 py-[10px] border-b border-line bg-wash-bad text-[12.5px] text-bad flex flex-wrap items-center gap-x-2 gap-y-1"
            >
              <span>Can&apos;t create the link yet — fix the highlighted field on:</span>
              {invalidTabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                >
                  {tabLabel(id)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
            <LinkFormFields
              tab={tab}
              idPrefix="create-link"
              register={register}
              control={control}
              watch={watch}
              formState={formState}
              qrValue={`https://${domain}/${slug || "your-slug"}`}
              showBackHalf={
                <Field
                  label="Short link"
                  help="Leave blank for a random slug."
                  error={formState.errors.slug?.message}
                  controlId="create-link-slug"
                >
                  <div className="flex items-stretch">
                    <select
                      {...register("domain")}
                      aria-label="Short-link domain"
                      className="px-[11px] py-[9px] bg-surface-3 border border-line-2 border-r-0 rounded-l-[var(--radius-sm)] font-mono text-[12.5px] text-ink-2 focus:outline-none"
                    >
                      {(domains ?? []).map((d) => (
                        <option key={d.id} value={d.domain}>
                          {d.domain}
                        </option>
                      ))}
                    </select>
                    <Input
                      {...register("slug")}
                      id="create-link-slug"
                      aria-describedby="create-link-slug-hint"
                      placeholder="spring-sale"
                      className="rounded-l-none font-mono text-[12.5px]"
                      spellCheck={false}
                    />
                  </div>
                </Field>
              }
            />
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
