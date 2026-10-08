"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button, Toggle } from "@/components/ui";
import { EDIT_TABS as TABS, blankOptionalUrlsToUndefined, LinkFormFields, type LinkFormTabId } from "@/components/links/link-form-fields";
import { useUpdateLink } from "@/lib/api/hooks";
import { UpdateLinkInput, type CreateLinkFormValues, type Link } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type TabId = LinkFormTabId;

/**
 * Edit every field `UpdateLinkInput` accepts (#644).
 *
 * Before this, PATCH /links/:id — which the API has always accepted a full
 * `UpdateLinkInput` for — was reachable from the UI for `destination` only.
 * Changing a rule, password, expiry, UTM, social preview, tag/folder/comment
 * or archiving a link meant deleting and recreating it, which loses click
 * history and frees the slug for anyone else to take.
 *
 * Shares its field surface with CreateLinkDrawer via LinkFormFields so the
 * two forms cannot drift apart. `domain` and `slug` are intentionally not
 * editable here — see the comment on UpdateLinkInput in
 * packages/contract/src/link.ts: moving a link to a new slug 404s every
 * printed/shared copy of the old one.
 */
export function EditLinkDrawer({ open, onClose, link }: { open: boolean; onClose: () => void; link: Link }) {
  const [tab, setTab] = useState<TabId>("dest");
  const update = useUpdateLink();
  const drawerRef = useRef<HTMLElement>(null);

  // Same ref-indirection as CreateLinkDrawer's onCloseRef: the parent
  // (the link detail page) re-renders on every analytics/link refetch while
  // this is open, and a focus trap effect that depended on `onClose`
  // directly would tear down and re-run on each of those, yanking focus back
  // to the first field mid-edit.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const form = useForm<CreateLinkFormValues>({
    defaultValues: toFormValues(link),
  });
  const { register, handleSubmit, control, watch, reset, formState, setError } = form;
  const [archived, setArchived] = useState(link.status === "archived");
  // The server only reports `passwordProtected`, never the password. Clearing
  // it is therefore an explicit choice, not "left the field blank".
  const [removePassword, setRemovePassword] = useState(false);

  // Re-seed the form whenever a different link opens, or the same link's
  // server data changes underneath an open drawer (e.g. a background
  // refetch after another tab edited it).
  useEffect(() => {
    if (open) {
      reset(toFormValues(link));
      setArchived(link.status === "archived");
      setRemovePassword(false);
      setTab("dest");
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link, reset]);

  useEffect(() => {
    if (!open) return;
    const el = drawerRef.current;
    if (!el) return;

    const trigger = document.activeElement as HTMLElement | null;
    const FOCUSABLE =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const queryFocusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
      );

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
      } else if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open]);

  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    const { unsubscribe } = watch(() => {
      if (updateRef.current.isError) updateRef.current.reset();
    });
    return () => unsubscribe();
  }, [watch]);

  if (!open) return null;

  const onSubmit = handleSubmit(async (values) => {
    update.reset();
    const patch = { ...toUpdateInput(blankOptionalUrlsToUndefined(values), removePassword), archived };
    // UpdateLinkInput validates every field this patch can carry (it is
    // CreateLinkInput minus domain/slug, which toUpdateInput never sends).
    // Checked here, not via a zodResolver, because the resolver's inferred
    // input type requires `domain`/`slug` to be present (CreateLinkInput's
    // own shape) and this form — shared with LinkFormFields — is typed as
    // CreateLinkFormValues so it lines up with CreateLinkDrawer; the two
    // fields this drawer never touches don't need resolver-time validation.
    const parsed = UpdateLinkInput.safeParse(patch);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError((issue?.path[0] as keyof CreateLinkFormValues) ?? "destination", {
        message: issue?.message ?? "That doesn't look right.",
      });
      return;
    }
    try {
      await update.mutateAsync({ id: link.id, ...parsed.data });
      onClose();
    } catch {
      /* surfaced below via update.error */
    }
  });

  return (
    <>
      <div className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[100] backdrop-blur-[2px]" onClick={onClose} />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${link.domain}/${link.slug}`}
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[620px] bg-surface border-l border-line-2 z-[101] flex flex-col shadow-[var(--shadow-3)]"
      >
        <div className="flex items-center gap-3 px-5 py-[17px] border-b border-line">
          <h2 className="text-[17px] font-bold font-mono truncate">
            Edit {link.domain}/{link.slug}
          </h2>
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
              id={`edit-link-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`edit-link-tabpanel-${t.id}`}
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
                document.getElementById(`edit-link-tab-${nextId}`)?.focus();
              }}
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
            {tab === "dest" ? (
              <Toggle
                checked={archived}
                onChange={setArchived}
                title="Archived"
                description="An archived link keeps working for anyone who already has it, but moves out of your active lists and the Archived filter is where you'll find it again."
              />
            ) : null}
            <LinkFormFields
              tab={tab}
              idPrefix="edit-link"
              register={register}
              control={control}
              watch={watch}
              formState={formState}
              qrValue={`https://${link.domain}/${link.slug}`}
              passwordPlaceholder={link.passwordProtected ? "Type a new password to replace the current one" : "Leave blank for no password"}
              passwordSlot={
                link.passwordProtected ? (
                  <Toggle
                    checked={removePassword}
                    onChange={setRemovePassword}
                    title="Remove password"
                    description="This link is password protected. Turn this on and save to let visitors through without one. A password typed above replaces it instead."
                  />
                ) : null
              }
            />
          </div>

          <div className="flex items-center gap-[10px] px-5 py-[14px] border-t border-line bg-surface-2">
            {update.isError ? (
              <span className="text-[12px] text-bad">{(update.error as Error).message}</span>
            ) : (
              <span className="text-[11.5px] text-ink-3">The short link itself ({link.domain}/{link.slug}) never changes.</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </aside>
    </>
  );
}

/** The Link the API returned, reshaped into what the shared form fields read/write. */
function toFormValues(link: Link): CreateLinkFormValues {
  return {
    destination: link.destination,
    domain: link.domain,
    slug: link.slug,
    tags: link.tags,
    folder: link.folder ?? undefined,
    comment: link.comment ?? undefined,
    redirectType: link.redirectType,
    rules: link.rules,
    expiresAt: link.expiresAt ?? null,
    expiresTo: link.expiresTo ?? undefined,
    activatesAt: link.activatesAt ?? null,
    scheduledTo: link.scheduledTo ?? undefined,
    clickLimit: link.clickLimit ?? null,
    // The server never returns the password itself (it stores a hash). An
    // empty field here means "leave it alone" — see toUpdateInput, which
    // omits `password` from the PATCH entirely when it is blank, rather than
    // sending `password: ""` and clearing a protection the user never meant
    // to touch.
    password: undefined,
    forwardQuery: link.forwardQuery,
    deepLink: link.deepLink,
    hideReferrer: link.hideReferrer,
    publicPreview: link.publicPreview,
    utm: link.utm
      ? {
          source: link.utm.source ?? undefined,
          medium: link.utm.medium ?? undefined,
          campaign: link.utm.campaign ?? undefined,
          content: link.utm.content ?? undefined,
        }
      : undefined,
    social: link.social
      ? {
          title: link.social.title ?? undefined,
          description: link.social.description ?? undefined,
          image: link.social.image ?? undefined,
        }
      : undefined,
  };
}

/**
 * Form values back into the PATCH body.
 *
 * `password` follows the contract's tri-state (omit = leave alone, null =
 * clear, string = set). A blank field means "leave alone": the server never
 * echoes the password back, so the field always starts empty. Clearing is the
 * explicit `removePassword` switch, and a typed password wins over it.
 *
 * `expiresTo` / `scheduledTo` are sent as `null` when blank so emptying them
 * actually removes the override (omitting would leave the old URL in place).
 */
function toUpdateInput(values: CreateLinkFormValues, removePassword: boolean) {
  const { domain: _domain, slug: _slug, password, ...rest } = values;
  const withUrls = { ...rest, expiresTo: rest.expiresTo ?? null, scheduledTo: rest.scheduledTo ?? null };
  if (password) return { ...withUrls, password };
  return removePassword ? { ...withUrls, password: null } : withUrls;
}
