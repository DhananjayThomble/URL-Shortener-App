import { describe, expect, it } from "vitest";
import { blankOptionalUrlsToUndefined, dateInputToIso, isoToDateInput } from "./link-form-values";

/* #644 — the edit drawer binds <input type="date"> to a full ISO timestamp.
   A plain register() rendered every existing date as blank. */
describe("date input <-> ISO conversion", () => {
  it("shows the local calendar day of a stored ISO timestamp", () => {
    const iso = new Date(2030, 5, 15, 13, 45).toISOString();
    expect(isoToDateInput(iso)).toBe("2030-06-15");
  });

  it("is blank for unset / unparseable values instead of throwing", () => {
    expect(isoToDateInput(null)).toBe("");
    expect(isoToDateInput(undefined)).toBe("");
    expect(isoToDateInput("not a date")).toBe("");
  });

  it("round-trips: the day a user picks is the day that is shown back", () => {
    for (const endOfDay of [true, false]) {
      const iso = dateInputToIso("2031-01-02", endOfDay);
      expect(iso).not.toBeNull();
      expect(isoToDateInput(iso)).toBe("2031-01-02");
    }
  });

  it("expiry ends the day (23:59:59), go-live starts it (00:00:00)", () => {
    const end = new Date(dateInputToIso("2031-01-02", true)!);
    const start = new Date(dateInputToIso("2031-01-02", false)!);
    expect([end.getHours(), end.getMinutes(), end.getSeconds()]).toEqual([23, 59, 59]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("an emptied input clears the date", () => {
    expect(dateInputToIso("", true)).toBeNull();
  });
});

describe("blankOptionalUrlsToUndefined", () => {
  it("drops blank utm/social keys so a cleared value is removed and social.image never fails HttpUrl on ''", () => {
    const out = blankOptionalUrlsToUndefined({
      expiresTo: "",
      scheduledTo: "https://a.example/x",
      utm: { source: "", medium: "m", campaign: undefined },
      social: { title: "", image: "" },
    });
    expect(out.expiresTo).toBeUndefined();
    expect(out.scheduledTo).toBe("https://a.example/x");
    expect(out.utm).toEqual({ medium: "m" });
    expect(out.social).toEqual({});
  });

  it("leaves absent utm/social absent", () => {
    const out = blankOptionalUrlsToUndefined<{ utm?: unknown; social?: unknown }>({});
    expect(out.utm).toBeUndefined();
    expect(out.social).toBeUndefined();
  });
});
