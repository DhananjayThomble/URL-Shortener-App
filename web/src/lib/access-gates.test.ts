import { describe, expect, it } from "vitest";
import { CreateLinkInput, HttpUrl } from "@snapurl/contract";
import {
  FALLBACK_URL_PLACEHOLDERS,
  GATE_TITLES,
  dropUngatedUrls,
  gateOffPlaceholder,
  isGateOn,
  switchGate,
} from "./access-gates";

/* Oracle: the Access tab of the link drawers (issue #759).

   1. A placeholder is a promise of what to type. The two "send visitors to" fields used to
      read `acme.com/coming-soon` / `acme.com/offers`; typed verbatim they are refused by the
      contract's HttpUrl guard ("Enter an absolute http(s) URL"). Every placeholder must be a
      value the SAME guard the API applies accepts. Oracle: packages/contract/src/http-url.ts
      (HttpUrl) and link.ts (CreateLinkInput.scheduledTo / expiresTo).

   2. Every input on the tab that hangs off a switch is disabled while its switch is off, and
      the value the switch gates is not sent: "Until then, send visitors to" only means
      something with a go-live date (redirect: blocked === "scheduled" -> scheduledTo) and
      "Then send visitors to" only with an expiry date (blocked === "expired" -> expiresTo;
      a click limit is a separate gate, "click_limit", that never reads expiresTo).

   3. Switching a gate back on gives the value it had before it was switched off. */

describe("fallback URL placeholders", () => {
  it("are accepted by the contract's HttpUrl guard, verbatim", () => {
    for (const [field, placeholder] of Object.entries(FALLBACK_URL_PLACEHOLDERS)) {
      expect(HttpUrl.safeParse(placeholder).success, `${field}: ${placeholder}`).toBe(true);
    }
  });

  it("are accepted by CreateLinkInput as the scheduledTo / expiresTo of a link", () => {
    const base = { destination: "https://example.com/start", domain: "snap.test", slug: "abc" };
    expect(CreateLinkInput.safeParse({ ...base, scheduledTo: FALLBACK_URL_PLACEHOLDERS.scheduledTo }).success).toBe(true);
    expect(CreateLinkInput.safeParse({ ...base, expiresTo: FALLBACK_URL_PLACEHOLDERS.expiresTo }).success).toBe(true);
  });

  it("carry an explicit https:// scheme (the old scheme-less examples were refused)", () => {
    for (const placeholder of Object.values(FALLBACK_URL_PLACEHOLDERS)) expect(placeholder).toMatch(/^https:\/\//);
    expect(HttpUrl.safeParse("acme.com/coming-soon").success).toBe(false);
    expect(HttpUrl.safeParse("acme.com/offers").success).toBe(false);
  });
});

describe("gateOffPlaceholder", () => {
  it("names the switch that has to be turned on", () => {
    expect(gateOffPlaceholder("activatesAt")).toContain(GATE_TITLES.activatesAt);
    expect(gateOffPlaceholder("expiresAt")).toContain(GATE_TITLES.expiresAt);
    expect(gateOffPlaceholder("clickLimit")).toContain(GATE_TITLES.clickLimit);
  });

  it("is never itself a value that could be mistaken for a URL example", () => {
    for (const gate of ["activatesAt", "expiresAt", "clickLimit"] as const) {
      expect(gateOffPlaceholder(gate)).not.toMatch(/^https?:\/\//);
    }
  });
});

describe("isGateOn", () => {
  it("is on for a date and off for null / undefined / empty", () => {
    expect(isGateOn("activatesAt", "2026-11-01T00:00:00.000Z")).toBe(true);
    expect(isGateOn("expiresAt", null)).toBe(false);
    expect(isGateOn("expiresAt", undefined)).toBe(false);
    expect(isGateOn("expiresAt", "")).toBe(false);
  });

  it("is on for ANY click limit the user is still typing, off only for null / undefined", () => {
    expect(isGateOn("clickLimit", 500)).toBe(true);
    expect(isGateOn("clickLimit", 0)).toBe(true); // a bad number is still "on": the field explains it
    expect(isGateOn("clickLimit", "")).toBe(true); // emptied while on is an unfinished entry, not "off"
    expect(isGateOn("clickLimit", "abc")).toBe(true);
    expect(isGateOn("clickLimit", null)).toBe(false);
    expect(isGateOn("clickLimit", undefined)).toBe(false);
  });
});

describe("switchGate", () => {
  const FALLBACK = "2026-12-01T23:59:59.999Z";

  it("on, first time: the fallback", () => {
    expect(switchGate(true, null, null, FALLBACK)).toEqual({ value: FALLBACK, remembered: null });
  });

  it("off: the value is null and the one that was set is remembered", () => {
    expect(switchGate(false, "2026-11-05T23:59:59.999Z", null, FALLBACK)).toEqual({
      value: null,
      remembered: "2026-11-05T23:59:59.999Z",
    });
  });

  it("off -> on gives back the remembered value, not the fallback", () => {
    const off = switchGate(false, "2026-11-05T23:59:59.999Z", null, FALLBACK);
    expect(switchGate(true, off.value, off.remembered, FALLBACK).value).toBe("2026-11-05T23:59:59.999Z");
  });

  it("off twice in a row does not forget what was remembered", () => {
    const off = switchGate(false, 42, null, 500);
    expect(switchGate(false, off.value, off.remembered, 500).remembered).toBe(42);
  });

  it("a value that cannot be restored is not remembered", () => {
    const isNumber = (v: number | string): v is number => typeof v === "number";
    expect(switchGate<number | string>(false, "abc", null, 500, isNumber)).toEqual({ value: null, remembered: null });
    expect(switchGate<number | string>(false, 0, null, 500, (v) => typeof v === "number" && v >= 1).remembered).toBeNull();
    expect(switchGate<number | string>(false, 7, null, 500, isNumber).remembered).toBe(7);
  });
});

describe("dropUngatedUrls", () => {
  const SCHEDULED = "https://example.com/soon";
  const EXPIRED = "https://example.com/gone";

  it("drops expiresTo when there is no expiry date, keeps it when there is one", () => {
    expect(dropUngatedUrls({ expiresAt: null, expiresTo: EXPIRED }).expiresTo).toBeUndefined();
    expect(dropUngatedUrls({ expiresAt: undefined, expiresTo: EXPIRED }).expiresTo).toBeUndefined();
    expect(dropUngatedUrls({ expiresAt: "2026-12-01T23:59:59.999Z", expiresTo: EXPIRED }).expiresTo).toBe(EXPIRED);
  });

  it("drops scheduledTo when there is no go-live date, keeps it when there is one", () => {
    expect(dropUngatedUrls({ activatesAt: null, scheduledTo: SCHEDULED }).scheduledTo).toBeUndefined();
    expect(dropUngatedUrls({ activatesAt: "2026-11-01T00:00:00.000Z", scheduledTo: SCHEDULED }).scheduledTo).toBe(SCHEDULED);
  });

  it("the two gates are independent", () => {
    const out = dropUngatedUrls({ activatesAt: "2026-11-01T00:00:00.000Z", scheduledTo: SCHEDULED, expiresAt: null, expiresTo: EXPIRED });
    expect(out.scheduledTo).toBe(SCHEDULED);
    expect(out.expiresTo).toBeUndefined();
  });

  it("an invalid URL typed behind an off switch can no longer block the save", () => {
    const base = { destination: "https://example.com/start", domain: "snap.test", slug: "abc" };
    const typed = { ...base, expiresAt: null, expiresTo: "not a url", activatesAt: null, scheduledTo: "acme.com/x" };
    expect(CreateLinkInput.safeParse(typed).success).toBe(false); // what the form used to send
    expect(CreateLinkInput.safeParse(dropUngatedUrls(typed)).success).toBe(true);
  });

  it("leaves every other field alone, including a click limit with no URL of its own", () => {
    const values = { destination: "https://example.com/start", clickLimit: 5, expiresAt: null, expiresTo: EXPIRED };
    const out = dropUngatedUrls(values);
    expect(out).toMatchObject({ destination: values.destination, clickLimit: 5, expiresAt: null });
    expect("expiresTo" in out ? out.expiresTo : undefined).toBeUndefined();
  });
});
