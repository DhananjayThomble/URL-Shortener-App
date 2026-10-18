"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * A modal "are you sure?" for an action that destroys data (#780).
 *
 * `role="alertdialog"` + `aria-modal`, named by its title and described by its
 * body. Focus lands on Cancel (so an Enter that opened the dialog can't also
 * confirm it), Tab / Shift+Tab stay inside, Escape and a click on the backdrop
 * cancel, the page behind does not scroll, and on close focus goes back to the
 * element that was focused when it opened — or to `fallbackFocus()` when that
 * element is gone or disabled by then (e.g. a Save button with nothing left to
 * save after a Cancel).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  fallbackFocus,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  fallbackFocus?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const fallbackRef = useRef(fallbackFocus);
  fallbackRef.current = fallbackFocus;
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;

  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const trigger = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      const usable = (el: HTMLElement | null | undefined): el is HTMLElement =>
        Boolean(el && document.contains(el) && !(el as HTMLButtonElement).disabled);
      const target = usable(trigger) ? trigger : fallbackRef.current?.();
      if (usable(target)) target.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[110] backdrop-blur-[2px]" onClick={onCancel} aria-hidden="true" />
      <div className="fixed inset-0 z-[111] flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={ref}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className="pointer-events-auto w-full max-w-[460px] max-h-full overflow-y-auto bg-surface border border-line-2 rounded-[var(--radius)] shadow-[var(--shadow-3)] p-5 flex flex-col gap-3"
        >
          <h2 id={titleId} className="m-0 text-[16px] font-bold text-ink">
            {title}
          </h2>
          <p id={bodyId} className="m-0 text-[13px] text-ink-2 leading-[1.6]">
            {body}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button ref={cancelRef} onClick={onCancel} className="justify-center min-h-[40px]">
              {cancelLabel}
            </Button>
            <Button variant="danger" onClick={onConfirm} className="justify-center min-h-[40px]">
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
