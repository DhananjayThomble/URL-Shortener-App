import { describe, expect, it } from "vitest";
import { closeAction, DISCARD_COPY, formValuesChanged } from "./discard-guard";

/* #761 — the drawers ask before throwing typed input away, but only when there is some. */
describe("formValuesChanged", () => {
  const blank = { destination: "", domain: "snap.test", tags: [], redirectType: "302", rules: [], forwardQuery: true };

  it("is false for the form exactly as it opened", () => {
    expect(formValuesChanged(blank, { ...blank })).toBe(false);
  });

  it("is true once a field holds something else", () => {
    expect(formValuesChanged(blank, { ...blank, destination: "https://example.com" })).toBe(true);
    expect(formValuesChanged(blank, { ...blank, redirectType: "301" })).toBe(true);
    expect(formValuesChanged(blank, { ...blank, forwardQuery: false })).toBe(true);
  });

  it("treats unset, null, empty text, [] and {} as the same nothing (an untouched input reads back \"\" where its default is undefined)", () => {
    const opened = { ...blank, folder: undefined, comment: undefined, clickLimit: null, utm: undefined, expiresTo: undefined };
    const afterInteraction = { ...blank, folder: "", comment: "", clickLimit: undefined, utm: { source: "", medium: "" }, expiresTo: "" };
    expect(formValuesChanged(opened, afterInteraction)).toBe(false);
    expect(formValuesChanged(afterInteraction, opened)).toBe(false);
  });

  it("is false when something was typed and then taken out again", () => {
    expect(formValuesChanged(blank, { ...blank, destination: "", tags: [], utm: { source: "" } })).toBe(false);
  });

  it("sees nested and list changes (utm, social, tags, rules)", () => {
    expect(formValuesChanged(blank, { ...blank, utm: { source: "news" } })).toBe(true);
    expect(formValuesChanged(blank, { ...blank, tags: ["a"] })).toBe(true);
    expect(formValuesChanged({ ...blank, tags: ["a"] }, { ...blank, tags: ["a", "b"] })).toBe(true);
    expect(formValuesChanged({ ...blank, tags: ["a", "b"] }, { ...blank, tags: ["b", "a"] })).toBe(true);
    expect(formValuesChanged(blank, { ...blank, rules: [{ when: { country: "IN" }, to: "https://example.com/in" }] })).toBe(true);
  });

  it("does not trim: a space is typing", () => {
    expect(formValuesChanged(blank, { ...blank, destination: " " })).toBe(true);
  });

  it("distinguishes 0 and false from unset (a click limit of 0, a switch turned off)", () => {
    expect(formValuesChanged({ ...blank, clickLimit: null }, { ...blank, clickLimit: 0 })).toBe(true);
    expect(formValuesChanged({ ...blank, hideReferrer: undefined }, { ...blank, hideReferrer: false })).toBe(true);
  });

  it("compares an edited link's saved values: same dates and numbers are unchanged, a different one is a change", () => {
    const saved = { destination: "https://example.com/a", expiresAt: "2030-01-01T23:59:59.999Z", clickLimit: 500, tags: ["x"] };
    expect(formValuesChanged(saved, { ...saved })).toBe(false);
    expect(formValuesChanged(saved, { ...saved, clickLimit: 501 })).toBe(true);
    expect(formValuesChanged(saved, { ...saved, expiresAt: null })).toBe(true);
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
