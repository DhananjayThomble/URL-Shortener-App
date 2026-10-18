import { describe, expect, it } from "vitest";
import { closeAction, DISCARD_COPY, hasDirtyFields } from "./discard-guard";

/* #761 — the drawers ask before throwing typed input away, but only when there is some. */
describe("hasDirtyFields", () => {
  it("is false for a pristine form (RHF reports an empty object)", () => {
    expect(hasDirtyFields({})).toBe(false);
    expect(hasDirtyFields(undefined)).toBe(false);
    expect(hasDirtyFields(null)).toBe(false);
  });

  it("is true when a top-level field is flagged", () => {
    expect(hasDirtyFields({ destination: true })).toBe(true);
  });

  it("walks nested objects (utm, social) and arrays (tags, rules)", () => {
    expect(hasDirtyFields({ utm: { source: true } })).toBe(true);
    expect(hasDirtyFields({ tags: [true] })).toBe(true);
    expect(hasDirtyFields({ rules: [{ when: { country: true } }] })).toBe(true);
  });

  it("is false when every leaf is unflagged (RHF leaves false/empty containers behind after an undo)", () => {
    expect(hasDirtyFields({ utm: { source: false }, tags: [], rules: [{ when: {} }] })).toBe(false);
    expect(hasDirtyFields({ destination: false })).toBe(false);
  });
});

describe("closeAction", () => {
  it("asks when there is something to lose", () => {
    expect(closeAction(true, false)).toBe("ask");
  });

  it("closes at once when there is not", () => {
    expect(closeAction(false, false)).toBe("close");
  });

  it("ignores a second request while the confirmation is already open, dirty or not", () => {
    expect(closeAction(true, true)).toBe("ignore");
    expect(closeAction(false, true)).toBe("ignore");
  });
});

describe("DISCARD_COPY", () => {
  it("names the action and the way out for both drawers, with no raw field or zod text", () => {
    for (const c of [DISCARD_COPY.create, DISCARD_COPY.edit]) {
      expect(c.title.endsWith("?")).toBe(true);
      expect(c.body).toMatch(/lost/);
      expect(c.body).not.toMatch(/[a-z]+:[a-z]/i);
    }
    expect(DISCARD_COPY.confirmLabel).not.toBe(DISCARD_COPY.cancelLabel);
  });
});
