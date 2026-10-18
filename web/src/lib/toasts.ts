/* Toast queue rules and copy (#757).

   Everything here is pure so the behaviour a person feels -- how many toasts can
   pile up, how long one stays, what it says -- is decided and tested without a
   DOM (web tests run in plain Node). The component that renders them is
   components/ui/toast.tsx. */

export type ToastTone = "success" | "error";

export interface ToastAction {
  label: string;
  /** Runs when the person activates the action. The toast is dismissed first. */
  run: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  action?: ToastAction;
  /** Overrides the default dwell time. */
  durationMs?: number;
}

export interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

/** Three is enough to see what just happened; more is a wall the person has to clear. */
export const MAX_TOASTS = 3;
/* Long enough to read, and (for one with an action) to reach the action: WCAG
   2.2.1 asks for adjustable timing, which the viewport adds by pausing the timer
   while a toast is hovered or holds focus. */
export const DEFAULT_DURATION_MS = 5_000;
export const ACTION_DURATION_MS = 8_000;
export const ERROR_DURATION_MS = 8_000;

export function toastDuration(input: ToastInput): number {
  if (input.durationMs !== undefined) return input.durationMs;
  if (input.tone === "error") return ERROR_DURATION_MS;
  return input.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS;
}

export function makeToast(id: number, input: ToastInput): ToastItem {
  return {
    id,
    message: input.message,
    tone: input.tone ?? "success",
    ...(input.action ? { action: input.action } : {}),
    durationMs: toastDuration(input),
  };
}

/**
 * Add a toast, newest last.
 *
 * - The same words with the same tone replace the one already showing (it gets
 *   the new id, so its timer restarts) rather than stacking a duplicate.
 * - Past MAX_TOASTS the OLDEST goes: the newest message is the one the person
 *   just caused.
 */
export function addToast(state: ToastItem[], item: ToastItem): ToastItem[] {
  const without = state.filter((t) => !(t.message === item.message && t.tone === item.tone));
  return [...without, item].slice(-MAX_TOASTS);
}

export function dismissToast(state: ToastItem[], id: number): ToastItem[] {
  return state.some((t) => t.id === id) ? state.filter((t) => t.id !== id) : state;
}

/**
 * True for the 2nd+ click of a multi-click (`MouseEvent.detail`).
 *
 * Archiving removes the row, so the next row slides up under the cursor; the
 * second click of a double click then archives a link the person never aimed at.
 * Keyboard activation reports 0 and an ordinary click 1, so neither is affected.
 */
export function isRepeatClick(detail: number): boolean {
  return detail > 1;
}

interface LinkRef {
  domain: string;
  slug: string;
}

export const linkLabel = (l: LinkRef): string => `${l.domain}/${l.slug}`;

/* Plain sentences naming the link by its short URL: no ids, no field names. */
export const toastCopy = {
  created: (l: LinkRef) => `Created ${linkLabel(l)}`,
  updated: (l: LinkRef) => `Saved changes to ${linkLabel(l)}`,
  archived: (l: LinkRef) => `Archived ${linkLabel(l)}`,
  unarchived: (l: LinkRef) => `Unarchived ${linkLabel(l)}`,
  restored: (l: LinkRef) => `Restored ${linkLabel(l)}`,
  deleted: (l: LinkRef) => `Deleted ${linkLabel(l)}`,
  settingsSaved: "Settings saved",
  archiveFailed: (l: LinkRef) => `Couldn't archive ${linkLabel(l)}. Nothing was changed.`,
  unarchiveFailed: (l: LinkRef) => `Couldn't unarchive ${linkLabel(l)}. Nothing was changed.`,
  restoreFailed: (l: LinkRef) => `Couldn't restore ${linkLabel(l)}. It is still archived.`,
} as const;
