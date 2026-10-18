/* The top-bar search shortcut (issue #791): ⌘K on Apple platforms, Ctrl+K everywhere else.

   Pure on purpose — web tests run in Node, so the platform sniffing and the key
   matching are plain functions of plain values. The component reads
   `navigator` and DOM events and hands the values here. */

export interface PlatformInfo {
  /** `navigator.userAgentData?.platform` (Chromium) — "macOS", "Windows", "Linux"… */
  userAgentDataPlatform?: string | undefined;
  /** `navigator.platform` — deprecated but still the widest-supported signal. */
  platform?: string | undefined;
  /** `navigator.userAgent` — last resort. */
  userAgent?: string | undefined;
}

/** True on macOS and iOS/iPadOS, where the shortcut modifier is Cmd (⌘). */
export function isMacPlatform(info: PlatformInfo): boolean {
  const isApple = (s: string) => /mac|iphone|ipad|ipod/i.test(s);
  // First non-empty signal wins, so a spoofed/odd `platform` cannot override a
  // browser that states its platform explicitly.
  if (info.userAgentDataPlatform) return isApple(info.userAgentDataPlatform);
  if (info.platform) return isApple(info.platform);
  if (info.userAgent) return isApple(info.userAgent);
  return false;
}

export interface SearchShortcut {
  /** Visible hint text. */
  hint: string;
  /** Value for `aria-keyshortcuts` (WAI-ARIA key names: Control, Meta). */
  ariaKeyShortcuts: string;
}

export function searchShortcutFor(isMac: boolean): SearchShortcut {
  return isMac
    ? { hint: "⌘K", ariaKeyShortcuts: "Meta+K" }
    : { hint: "Ctrl K", ariaKeyShortcuts: "Control+K" };
}

/** The subset of `KeyboardEvent` the matcher reads. */
export interface ShortcutKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean | undefined;
}

/**
 * Is this key event the search shortcut on this platform? Exactly the platform's
 * modifier plus K: the other platform's modifier, and any extra Shift/Alt (which
 * also covers Windows AltGr = Ctrl+Alt), are different shortcuts and not ours.
 */
export function isSearchShortcut(event: ShortcutKeyEvent, isMac: boolean): boolean {
  if (event.isComposing) return false;
  if (event.key.toLowerCase() !== "k") return false;
  if (event.altKey || event.shiftKey) return false;
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The subset of `HTMLElement` the editable check reads. */
export interface TargetInfo {
  tagName: string;
  isContentEditable?: boolean | undefined;
  type?: string | undefined;
}

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Is the key event's target somewhere the user is typing (or choosing from a
 * native select)? The shortcut stays out of those: a hidden-field steal would eat
 * Ctrl+K in the link drawers' inputs, and in a textarea / contenteditable the key
 * may belong to the editor. Buttons, checkboxes, links and the page itself are
 * not editable, so the shortcut works from them.
 */
export function isEditableTarget(target: TargetInfo | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUT_TYPES.has((target.type ?? "text").toLowerCase());
  return false;
}
