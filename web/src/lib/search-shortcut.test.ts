import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  isMacPlatform,
  isSearchShortcut,
  searchShortcutFor,
  type ShortcutKeyEvent,
} from "./search-shortcut";

/* Oracle: issue #791 (BUG-043). The top-bar search showed a hard-coded "⌘K" hint
   and nothing listened for it, so Ctrl+K did nothing on Linux/Windows.

   The platform's own modifier is the contract: Cmd+K on Mac, Ctrl+K elsewhere.
   The OTHER platform's modifier must not fire (Ctrl+K on a Mac is "kill line" in
   a text field; Cmd+K on Windows is the Windows key), and any extra modifier
   (Shift/Alt) means a different shortcut that is not ours to take. */

const ev = (over: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: "k",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...over,
});

describe("isMacPlatform", () => {
  it("prefers userAgentData.platform when the browser exposes it", () => {
    expect(isMacPlatform({ userAgentDataPlatform: "macOS", platform: "Win32" })).toBe(true);
    expect(isMacPlatform({ userAgentDataPlatform: "Linux", platform: "MacIntel" })).toBe(false);
    expect(isMacPlatform({ userAgentDataPlatform: "Windows" })).toBe(false);
  });

  it("falls back to navigator.platform", () => {
    expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
    expect(isMacPlatform({ platform: "MacPPC" })).toBe(true);
    expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isMacPlatform({ platform: "Win32" })).toBe(false);
  });

  it("treats iPhone/iPad as Apple (Cmd) platforms", () => {
    expect(isMacPlatform({ platform: "iPhone" })).toBe(true);
    expect(isMacPlatform({ platform: "iPad" })).toBe(true);
  });

  it("falls back to the user agent, and defaults to non-Mac when nothing is known", () => {
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(true);
    expect(isMacPlatform({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130" })).toBe(false);
    expect(isMacPlatform({})).toBe(false);
    expect(isMacPlatform({ platform: "", userAgentDataPlatform: "", userAgent: "" })).toBe(false);
  });

  it("does not mistake 'Darwin'-less look-alikes (e.g. Pixel Android) for a Mac", () => {
    expect(isMacPlatform({ platform: "Linux armv81", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7)" })).toBe(false);
  });
});

describe("searchShortcutFor", () => {
  it("Mac: ⌘K hint, Meta+K for assistive tech", () => {
    expect(searchShortcutFor(true)).toEqual({ hint: "⌘K", ariaKeyShortcuts: "Meta+K" });
  });
  it("non-Mac: Ctrl K hint, Control+K for assistive tech", () => {
    expect(searchShortcutFor(false)).toEqual({ hint: "Ctrl K", ariaKeyShortcuts: "Control+K" });
  });
});

describe("isSearchShortcut", () => {
  it("non-Mac: Ctrl+K matches, Cmd+K does not", () => {
    expect(isSearchShortcut(ev({ ctrlKey: true }), false)).toBe(true);
    expect(isSearchShortcut(ev({ metaKey: true }), false)).toBe(false);
  });

  it("Mac: Cmd+K matches, Ctrl+K does not", () => {
    expect(isSearchShortcut(ev({ metaKey: true }), true)).toBe(true);
    expect(isSearchShortcut(ev({ ctrlKey: true }), true)).toBe(false);
  });

  it("is case-insensitive (Caps Lock)", () => {
    expect(isSearchShortcut(ev({ key: "K", ctrlKey: true }), false)).toBe(true);
    expect(isSearchShortcut(ev({ key: "K", metaKey: true }), true)).toBe(true);
  });

  it("ignores the bare key and other keys", () => {
    expect(isSearchShortcut(ev(), false)).toBe(false);
    expect(isSearchShortcut(ev({ key: "j", ctrlKey: true }), false)).toBe(false);
    expect(isSearchShortcut(ev({ key: "Control", ctrlKey: true }), false)).toBe(false);
    expect(isSearchShortcut(ev({ key: "", ctrlKey: true }), false)).toBe(false);
  });

  it("ignores chords with extra modifiers (Ctrl+Shift+K opens devtools in Firefox)", () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(isSearchShortcut(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isSearchShortcut(ev({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isSearchShortcut(ev({ metaKey: true, altKey: true }), true)).toBe(false);
    // Windows AltGr reports ctrl+alt: not a Ctrl+K press.
    expect(isSearchShortcut(ev({ ctrlKey: true, altKey: true }), false)).toBe(false);
  });

  it("ignores key presses made while an IME composition is in progress", () => {
    expect(isSearchShortcut(ev({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });
});

describe("isEditableTarget", () => {
  const el = (tagName: string, extra: Partial<{ isContentEditable: boolean; type: string }> = {}) => ({
    tagName,
    isContentEditable: false,
    ...extra,
  });

  it("text-like fields are editable", () => {
    expect(isEditableTarget(el("INPUT", { type: "text" }))).toBe(true);
    expect(isEditableTarget(el("INPUT", { type: "url" }))).toBe(true);
    expect(isEditableTarget(el("INPUT"))).toBe(true);
    expect(isEditableTarget(el("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(el("SELECT"))).toBe(true);
    expect(isEditableTarget(el("DIV", { isContentEditable: true }))).toBe(true);
  });

  it("buttons, checkboxes, links and the page body are not", () => {
    expect(isEditableTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditableTarget(el("INPUT", { type: "radio" }))).toBe(false);
    expect(isEditableTarget(el("INPUT", { type: "button" }))).toBe(false);
    expect(isEditableTarget(el("BUTTON"))).toBe(false);
    expect(isEditableTarget(el("A"))).toBe(false);
    expect(isEditableTarget(el("BODY"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
