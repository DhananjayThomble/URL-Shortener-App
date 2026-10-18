"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { closeAction, DISCARD_COPY } from "@/lib/discard-guard";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Makes every way of dismissing a link drawer — Esc, the backdrop, ✕ and Cancel —
 * ask first when the form holds something the user typed (#761).
 *
 * `requestClose` is the ONE function all four call. It is stable (reads the latest
 * `isDirty` / `onClose` through refs), so the drawer's document-level Esc listener,
 * which is set up once per open, always sees current values.
 *
 * Successful saves keep calling the plain `onClose`: a save is not a discard.
 */
export function useDiscardGuard({
  open,
  isDirty,
  onClose,
  drawerRef,
}: {
  open: boolean;
  isDirty: () => boolean;
  onClose: () => void;
  drawerRef: RefObject<HTMLElement | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** What had focus when the question was asked, to put focus back on "Keep editing". */
  const askedFrom = useRef<HTMLElement | null>(null);

  // The drawer component stays mounted while closed; never carry a question over to the next open.
  useEffect(() => {
    setConfirming(false);
  }, [open]);

  const requestClose = useCallback(() => {
    const action = closeAction(isDirtyRef.current(), confirmingRef.current);
    if (action === "ignore") return;
    if (action === "close") {
      onCloseRef.current();
      return;
    }
    askedFrom.current = document.activeElement as HTMLElement | null;
    setConfirming(true);
  }, []);

  const keepEditing = useCallback(() => {
    setConfirming(false);
    // ConfirmDialog returns focus to whatever had it when it opened. A mouse click on ✕ or
    // Cancel in Safari, or on the backdrop, can leave that as <body>, which would drop the
    // user out of the drawer's focus trap; make sure focus lands inside the drawer instead.
    window.setTimeout(() => {
      const drawer = drawerRef.current;
      if (!drawer || drawer.contains(document.activeElement)) return;
      const from = askedFrom.current;
      const target =
        from && drawer.contains(from) && !(from as HTMLButtonElement).disabled
          ? from
          : drawer.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 0);
  }, [drawerRef]);

  const discard = useCallback(() => {
    setConfirming(false);
    onCloseRef.current();
  }, []);

  return { confirming, requestClose, keepEditing, discard };
}

/** The shared "Discard …?" question, rendered by both link drawers. */
export function DiscardDialog({
  open,
  kind,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean;
  kind: "create" | "edit";
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const copy = DISCARD_COPY[kind];
  return (
    <ConfirmDialog
      open={open}
      title={copy.title}
      body={copy.body}
      confirmLabel={DISCARD_COPY.confirmLabel}
      cancelLabel={DISCARD_COPY.cancelLabel}
      onConfirm={onDiscard}
      onCancel={onKeepEditing}
    />
  );
}
