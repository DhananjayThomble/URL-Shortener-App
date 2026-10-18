import { describe, expect, it } from "vitest";
import { EXPIRY_IN_PAST_MESSAGE, EXPIRY_SKEW_TOLERANCE_MS, deriveStatus, validateExpiry, validateSchedule } from "./destination.js";

/* Issue #754 — a link could be created with an expiry date in the past, so it
   was born expired (status "expired", every click a 410).

   Oracle: `deriveStatus` is what the product shows and the redirect service
   obeys, and it calls a link expired when `expiresAt <= now`. So a NEW expiry
   is acceptable only when deriveStatus would not already call it expired —
   strictly after "now". An expiry the row already had is not "new" and must
   never block an unrelated edit of a link that has since expired. */

const now = new Date("2026-06-15T12:00:00.000Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta).toISOString();

describe("validateExpiry (#754)", () => {
  it("no expiry (null / undefined / empty) is always fine", () => {
    expect(validateExpiry(null, { now })).toEqual([]);
    expect(validateExpiry(undefined, { now })).toEqual([]);
    expect(validateExpiry("", { now })).toEqual([]);
  });

  it("a past expiry is refused with a human message", () => {
    expect(validateExpiry("2026-01-01T00:00:00.000Z", { now })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    expect(EXPIRY_IN_PAST_MESSAGE).not.toMatch(/expiresAt|zod|:/);
  });

  it("the boundary is exactly deriveStatus's: 'now' itself is refused, 1 ms later is accepted", () => {
    expect(deriveStatus({ expiresAt: now }, now)).toBe("expired");
    expect(validateExpiry(now, { now })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    expect(validateExpiry(ms(now, -1), { now })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    expect(deriveStatus({ expiresAt: ms(now, 1) }, now)).not.toBe("expired");
    expect(validateExpiry(ms(now, 1), { now })).toEqual([]);
  });

  it("a future expiry is fine, including far future", () => {
    expect(validateExpiry("2026-06-16T00:00:00.000Z", { now })).toEqual([]);
    expect(validateExpiry("9999-12-31T23:59:59.999Z", { now })).toEqual([]);
  });

  it("accepts a Date as well as a string, and defaults now to the real clock", () => {
    expect(validateExpiry(new Date(Date.now() - 60_000))).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    expect(validateExpiry(new Date(Date.now() + 60_000))).toEqual([]);
  });

  it("compares instants, not wall-clock text: the same instant in another offset is the same answer", () => {
    // 2026-06-15T12:00:00Z === 2026-06-15T17:30:00+05:30 === 2026-06-15T05:00:00-07:00
    expect(validateExpiry("2026-06-15T17:30:00+05:30", { now })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    expect(validateExpiry("2026-06-15T05:00:00.001-07:00", { now })).toEqual([]);
    // "Today" in UTC+14 is already "tomorrow" in UTC; the instant decides, not the date text.
    expect(validateExpiry("2026-06-16T01:00:00+14:00", { now })).toEqual([EXPIRY_IN_PAST_MESSAGE]); // = 11:00Z
    expect(validateExpiry("2026-06-16T03:00:00+14:00", { now })).toEqual([]); // = 13:00Z
  });

  describe("on edit (previous = the expiry the row already has)", () => {
    const expired = "2026-03-01T10:00:00.000Z";

    it("an unchanged past expiry does not block the edit (the link simply stays expired)", () => {
      expect(validateExpiry(expired, { now, previous: expired })).toEqual([]);
      // Same instant, different spelling (a client re-serialising the value it was sent).
      expect(validateExpiry("2026-03-01T15:30:00+05:30", { now, previous: expired })).toEqual([]);
      expect(validateExpiry(expired, { now, previous: new Date(expired) })).toEqual([]);
    });

    it("re-setting a DIFFERENT past expiry is refused", () => {
      expect(validateExpiry("2026-02-01T00:00:00.000Z", { now, previous: expired })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
      expect(validateExpiry("2026-01-01T00:00:00.000Z", { now, previous: null })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    });

    it("extending an expired link into the future, or clearing its expiry, is fine", () => {
      expect(validateExpiry("2026-07-01T00:00:00.000Z", { now, previous: expired })).toEqual([]);
      expect(validateExpiry(null, { now, previous: expired })).toEqual([]);
    });

    it("an unparseable previous value never makes a past expiry acceptable", () => {
      expect(validateExpiry(expired, { now, previous: "garbage" })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    });
  });

  describe("clock-skew tolerance", () => {
    it("the shared tolerance is small: one minute", () => {
      expect(EXPIRY_SKEW_TOLERANCE_MS).toBe(60_000);
    });

    it("with a tolerance, a value up to that far behind 'now' is accepted (an 'expire it now' sent from a slightly slow clock)", () => {
      const t = EXPIRY_SKEW_TOLERANCE_MS;
      expect(validateExpiry(ms(now, -1_000), { now, toleranceMs: t })).toEqual([]);
      expect(validateExpiry(ms(now, -t + 1), { now, toleranceMs: t })).toEqual([]);
      expect(validateExpiry(ms(now, -t), { now, toleranceMs: t })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
      expect(validateExpiry("2026-06-14T12:00:00.000Z", { now, toleranceMs: t })).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    });

    it("a negative tolerance is treated as none", () => {
      expect(validateExpiry(ms(now, 1), { now, toleranceMs: -5_000 })).toEqual([]);
    });
  });

  it("an unparseable value is left to the contract (it cannot be judged past or future here)", () => {
    expect(validateExpiry("not-a-date", { now })).toEqual([]);
  });

  it("is independent of validateSchedule's ordering rule: both can be reported together", () => {
    const activates = "2026-07-01T00:00:00.000Z";
    const expires = "2026-01-01T00:00:00.000Z";
    expect([...validateSchedule(activates, expires), ...validateExpiry(expires, { now })]).toEqual([
      "A link cannot be scheduled to start after it expires.",
      EXPIRY_IN_PAST_MESSAGE,
    ]);
  });
});
