import { describe, expect, it } from "vitest";
import {
  ACTION_DURATION_MS,
  DEFAULT_DURATION_MS,
  ERROR_DURATION_MS,
  MAX_TOASTS,
  addToast,
  dismissToast,
  isRepeatClick,
  linkLabel,
  makeToast,
  toastCopy,
  toastDuration,
  type ToastItem,
} from "./toasts";

/* #757 — create / archive / unarchive / delete / settings-save showed nothing.
   The queue rules (cap, de-duplication, how long a toast stays) and the copy are
   pure, so they are decided and pinned here; the DOM is proven by the mocked-api
   spec e2e/mocked-api/toast-feedback.spec.ts. */

const t = (id: number, message: string, over: Partial<ToastItem> = {}): ToastItem =>
  makeToast(id, { message, ...over });

describe("addToast", () => {
  it("appends in arrival order", () => {
    const s = addToast(addToast([], t(1, "a")), t(2, "b"));
    expect(s.map((x) => x.message)).toEqual(["a", "b"]);
  });

  it("never holds more than MAX_TOASTS: the oldest is dropped, not the newest", () => {
    let s: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 4; i++) s = addToast(s, t(i, `m${i}`));
    expect(s).toHaveLength(MAX_TOASTS);
    expect(s[s.length - 1].message).toBe(`m${MAX_TOASTS + 4}`);
    expect(s[0].message).toBe(`m${MAX_TOASTS + 2}`);
  });

  it("an identical message replaces the one on screen instead of stacking a copy", () => {
    const s = addToast(addToast([], t(1, "Settings saved")), t(2, "Settings saved"));
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe(2); // a fresh id restarts the dismiss timer
  });

  it("the same words with a different tone are different toasts", () => {
    const s = addToast(addToast([], t(1, "x")), t(2, "x", { tone: "error" }));
    expect(s).toHaveLength(2);
  });

  it("two archives of different links both keep their own Undo", () => {
    const s = addToast(
      addToast([], t(1, "Archived snap.to/a", { action: { label: "Undo", run: () => {} } })),
      t(2, "Archived snap.to/b", { action: { label: "Undo", run: () => {} } }),
    );
    expect(s).toHaveLength(2);
  });
});

describe("dismissToast", () => {
  it("removes only the named toast and ignores an unknown id", () => {
    const s = addToast(addToast([], t(1, "a")), t(2, "b"));
    expect(dismissToast(s, 1).map((x) => x.id)).toEqual([2]);
    expect(dismissToast(s, 99)).toEqual(s);
  });
});

describe("toastDuration", () => {
  it("gives a toast with an action longer than a plain one, and errors longer still", () => {
    expect(toastDuration({ message: "m" })).toBe(DEFAULT_DURATION_MS);
    expect(toastDuration({ message: "m", action: { label: "Undo", run: () => {} } })).toBe(ACTION_DURATION_MS);
    expect(toastDuration({ message: "m", tone: "error" })).toBe(ERROR_DURATION_MS);
    expect(ACTION_DURATION_MS).toBeGreaterThan(DEFAULT_DURATION_MS);
  });

  it("an explicit duration wins", () => {
    expect(toastDuration({ message: "m", durationMs: 1234 })).toBe(1234);
  });

  it("is long enough to read and to act on (WCAG 2.2.1)", () => {
    expect(ACTION_DURATION_MS).toBeGreaterThanOrEqual(7000);
    expect(DEFAULT_DURATION_MS).toBeGreaterThanOrEqual(4000);
  });
});

describe("copy", () => {
  const link = { domain: "snap.to", slug: "spring-sale" };

  it("names the link by its short URL", () => {
    expect(linkLabel(link)).toBe("snap.to/spring-sale");
  });

  it("says what happened, to which link, with no raw ids or field names", () => {
    expect(toastCopy.created(link)).toBe("Created snap.to/spring-sale");
    expect(toastCopy.archived(link)).toBe("Archived snap.to/spring-sale");
    expect(toastCopy.unarchived(link)).toBe("Unarchived snap.to/spring-sale");
    expect(toastCopy.deleted(link)).toBe("Deleted snap.to/spring-sale");
    expect(toastCopy.updated(link)).toBe("Saved changes to snap.to/spring-sale");
    expect(toastCopy.settingsSaved).toBe("Settings saved");
  });

  it("does not leak undefined for an odd link", () => {
    for (const s of Object.values({ a: toastCopy.created({ domain: "d.test", slug: "é🔗" }) })) {
      expect(s).not.toMatch(/undefined|null/);
    }
  });
});

describe("isRepeatClick", () => {
  it("is true only for the 2nd+ click of a multi-click (a double click)", () => {
    expect(isRepeatClick(0)).toBe(false); // keyboard Enter / Space
    expect(isRepeatClick(1)).toBe(false);
    expect(isRepeatClick(2)).toBe(true);
    expect(isRepeatClick(3)).toBe(true);
  });
});
