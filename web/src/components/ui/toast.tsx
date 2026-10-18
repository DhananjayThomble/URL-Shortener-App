"use client";

import * as React from "react";
import {
  addToast,
  dismissToast,
  makeToast,
  type ToastInput,
  type ToastItem,
} from "@/lib/toasts";
import { cn } from "@/lib/utils";

/* One small toast system for the signed-in app (#757). No dependency: the rules
   live in lib/toasts.ts (pure, tested); this file is the DOM.

   Accessibility
   - Two live regions that are ALWAYS mounted (a region inserted together with its
     text is often not announced): a polite one for confirmations and an assertive
     one for failures. They carry aria-live rather than role=status / role=alert so
     the page does not gain two permanent, empty status/alert elements (the
     importer's own result is a role=status the e2e suite addresses unscoped).
   - Reachable by keyboard: the viewport sits at the end of the document, so F8
     jumps to the newest toast and Tab / Shift+Tab move between its buttons.
     Focus goes back to where it was when the toast closes.
   - Dismissible: every toast has a close button; each also leaves on its own, but
     the timer pauses while the toast is hovered or holds focus.
   - Never steals focus when it appears. */

interface ToastApi {
  show: (input: ToastInput) => number;
  dismiss: (id: number) => void;
}

/* Outside a provider (an isolated component test, say) showing a toast is a
   no-op rather than a crash. */
const ToastContext = React.createContext<ToastApi>({ show: () => 0, dismiss: () => {} });

export const useToast = (): ToastApi => React.useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => setToasts((s) => dismissToast(s, id)), []);
  const show = React.useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((s) => addToast(s, makeToast(id, input)));
    return id;
  }, []);

  const api = React.useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const INSET_VAR = "--toast-inset";

function ToastViewport({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  /* Keep the page scrollable past the toasts: the shell adds this much bottom
     padding, so nothing is ever stuck underneath one. */
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty(INSET_VAR, toasts.length ? `${el.offsetHeight + 24}px` : "0px");
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [toasts.length]);
  React.useEffect(
    () => () => {
      document.documentElement.style.removeProperty(INSET_VAR);
    },
    [],
  );

  /* F8: move focus to the newest toast's first button. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F8" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const items = rootRef.current?.querySelectorAll<HTMLElement>('[data-testid="toast"]');
      const last = items?.[items.length - 1];
      const target = last?.querySelector<HTMLElement>("button");
      if (!target) return;
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && !rootRef.current?.contains(active)) returnFocus.current = active;
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* A toast that held focus was removed (Undo, Dismiss, or its timer): hand focus
     back to where the person was instead of dropping it on <body>. */
  React.useEffect(() => {
    const back = returnFocus.current;
    if (!back) return;
    const root = rootRef.current;
    if (root?.contains(document.activeElement)) return; // still on a toast
    returnFocus.current = null;
    if (back.isConnected && (document.activeElement === document.body || document.activeElement === null)) {
      back.focus({ preventScroll: true });
    }
  }, [toasts]);

  const polite = toasts.filter((t) => t.tone !== "error");
  const assertive = toasts.filter((t) => t.tone === "error");

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Notifications"
      aria-keyshortcuts="F8"
      className={cn(
        "fixed z-[200] pointer-events-none flex flex-col gap-2",
        // A phone gets the full width less a gutter; a larger screen a fixed card at the corner.
        "inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))]",
        "sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[380px]",
      )}
    >
      <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {polite.map((t) => (
          <ToastView key={t.id} toast={t} dismiss={dismiss} />
        ))}
      </div>
      <div aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
        {assertive.map((t) => (
          <ToastView key={t.id} toast={t} dismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

/* Width comes from padding or an explicit w-: `.flex > * { min-width: 0 }` in
   globals.css outranks a min-w- utility on a flex child. */
const BTN =
  "pointer-events-auto inline-flex shrink-0 items-center justify-center min-h-[36px] rounded-[6px] text-[13px] font-semibold " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

function ToastView({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  const [paused, setPaused] = React.useState(false);
  const remaining = React.useRef(toast.durationMs);
  const dismissRef = React.useRef(dismiss);
  dismissRef.current = dismiss;

  /* Count down only while nobody is reading it: hover or focus pauses, and the
     time left carries over. */
  React.useEffect(() => {
    if (paused) return;
    const startedAt = Date.now();
    const h = setTimeout(() => dismissRef.current(toast.id), remaining.current);
    return () => {
      clearTimeout(h);
      remaining.current = Math.max(1_000, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, toast.id]);

  const isError = toast.tone === "error";
  return (
    <div
      data-testid="toast"
      data-tone={toast.tone}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      className={cn(
        "pointer-events-auto flex items-center gap-2 pl-[14px] pr-[6px] py-[6px] min-h-[44px] rounded-[var(--radius-sm)] text-[13px] shadow-[var(--shadow-2)]",
        isError ? "bg-surface text-ink border-2 border-bad" : "bg-ink text-surface",
      )}
    >
      <span className="flex-1 min-w-0 break-words leading-[1.4]">{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className={cn(BTN, "px-[10px] underline underline-offset-2 hover:bg-surface/15")}
          onClick={() => {
            dismiss(toast.id);
            toast.action!.run();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss notification"
        className={cn(BTN, "w-[36px]", isError ? "hover:bg-surface-3" : "hover:bg-surface/15")}
        onClick={() => dismiss(toast.id)}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
