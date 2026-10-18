import { afterEach, describe, expect, it } from "vitest";
import { EXPIRY_IN_PAST_MESSAGE } from "@snapurl/domain";
import { dateInputToIso, isoToDateInput } from "../components/links/link-form-values";
import { expiryProblem } from "./expiry-input";

/* Issue #754 — the drawer's "Expiry date" let you pick a day that has already
   passed and created a link that was expired from birth. The field now says so
   inline. Oracle: the shared domain rule (validateExpiry) — the same one the API
   enforces — and the field's own mapping, which turns a picked DAY into the END
   of that day in the viewer's local time ("stops working after the date you
   pick"). So the first day that can be refused is yesterday, in the viewer's own
   calendar — whatever day it is in UTC. */

const originalTz = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTz;
});

/** The "Expiry date" field's value for a picked day, exactly as the drawer stores it. */
const picked = (day: string) => dateInputToIso(day, true);

describe("expiryProblem (#754)", () => {
  it("no expiry is never a problem", () => {
    expect(expiryProblem(null, { original: null })).toBeUndefined();
    expect(expiryProblem(undefined, { original: null })).toBeUndefined();
    expect(expiryProblem("", { original: null })).toBeUndefined();
  });

  it("uses the shared domain message (the same words the API answers with)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(expiryProblem("2026-01-01T00:00:00.000Z", { original: null, now })).toBe(EXPIRY_IN_PAST_MESSAGE);
  });

  it.each([
    // [timezone, now (UTC), today in that zone, yesterday in that zone]
    ["UTC", "2026-06-15T12:00:00.000Z", "2026-06-15", "2026-06-14"],
    ["Asia/Kolkata", "2026-06-15T20:00:00.000Z", "2026-06-16", "2026-06-15"], // 01:30 next day local
    ["Pacific/Kiritimati", "2026-06-15T12:00:00.000Z", "2026-06-16", "2026-06-15"], // UTC+14: already tomorrow
    ["Pacific/Pago_Pago", "2026-06-15T09:00:00.000Z", "2026-06-14", "2026-06-13"], // UTC-11: still yesterday
    ["America/New_York", "2026-03-08T12:00:00.000Z", "2026-03-08", "2026-03-07"], // DST starts that day
    ["America/New_York", "2026-11-01T12:00:00.000Z", "2026-11-01", "2026-10-31"], // DST ends that day
    ["Europe/London", "2026-03-29T00:30:00.000Z", "2026-03-29", "2026-03-28"], // 00:30 GMT, an hour before the clocks go forward
  ])("in %s at %s: picking today (%s) is fine, yesterday (%s) is refused", (tz, nowIso, today, yesterday) => {
    process.env.TZ = tz;
    const now = new Date(nowIso);
    expect(isoToDateInput(now.toISOString())).toBe(today); // sanity: the field's own idea of "today"
    expect(expiryProblem(picked(today), { original: null, now })).toBeUndefined();
    expect(expiryProblem(picked(yesterday), { original: null, now })).toBe(EXPIRY_IN_PAST_MESSAGE);
  });

  it("the last moment of today is still fine; one millisecond past midnight it is yesterday's date and refused", () => {
    process.env.TZ = "Asia/Kolkata";
    const day = "2026-06-15";
    const endOfDay = new Date(picked(day)!);
    expect(expiryProblem(picked(day), { original: null, now: new Date(endOfDay.getTime() - 1) })).toBeUndefined();
    // Past the tolerance after the end of that day.
    expect(expiryProblem(picked(day), { original: null, now: new Date(endOfDay.getTime() + 2 * 60_000) })).toBe(EXPIRY_IN_PAST_MESSAGE);
  });

  it("a slightly fast browser clock never flags a value the server would still accept (one-minute tolerance)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(expiryProblem("2026-06-15T11:59:30.000Z", { original: null, now })).toBeUndefined();
    expect(expiryProblem("2026-06-15T11:58:00.000Z", { original: null, now })).toBe(EXPIRY_IN_PAST_MESSAGE);
  });

  describe("edit drawer (original = the expiry the link was opened with)", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    const expired = "2026-03-01T10:00:00.000Z";

    it("an expired link's untouched expiry is not flagged, so its other fields stay editable", () => {
      expect(expiryProblem(expired, { original: expired, now })).toBeUndefined();
    });

    it("picking a different past day on an expired link is flagged", () => {
      process.env.TZ = "UTC";
      expect(expiryProblem(picked("2026-02-01"), { original: expired, now })).toBe(EXPIRY_IN_PAST_MESSAGE);
    });

    it("re-picking the link's own past day is a NEW value (end of that day, not the original instant) and is flagged", () => {
      process.env.TZ = "UTC";
      expect(picked("2026-03-01")).not.toBe(expired);
      expect(expiryProblem(picked("2026-03-01"), { original: expired, now })).toBe(EXPIRY_IN_PAST_MESSAGE);
    });

    it("moving an expired link's expiry into the future, or switching it off, is fine", () => {
      process.env.TZ = "UTC";
      expect(expiryProblem(picked("2026-07-01"), { original: expired, now })).toBeUndefined();
      expect(expiryProblem(null, { original: expired, now })).toBeUndefined();
    });
  });

  it("text that is not a date is left to the contract ('Enter a valid date'), not called past", () => {
    expect(expiryProblem("not-a-date", { original: null })).toBeUndefined();
  });
});
