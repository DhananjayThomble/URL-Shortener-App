import { deriveStatus } from "@snapurl/domain";
import { afterEach, describe, expect, it } from "vitest";
import { lifecycleSummary, type LifecycleFields } from "./link-lifecycle";
import { formatDate } from "./utils";

/* #760 — the Archived filter showed "Never expires" for a link that was
   scheduled to go live. The row built its details line from `link.status`, and
   an archived link's status is just "archived", so the schedule (which the API
   still returns) was never consulted. Archiving a link does not change when it
   goes live or stops working — the summary must read the same either way. */

const NOW = new Date("2026-06-15T12:00:00.000Z");
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const DAY = 86_400_000;

/* The summary only needs the schedule fields; `status` is what the API sends
   alongside them, which is "archived" whenever the link is archived. */
function link(over: Partial<LifecycleFields> = {}, archived = false): LifecycleFields {
  const base = {
    activatesAt: null,
    expiresAt: null,
    clickLimit: null,
    clicks: 0,
    ...over,
  };
  return { ...base, status: archived ? "archived" : deriveStatus(base, NOW) };
}

const CASES: Array<{ name: string; over: Partial<LifecycleFields>; expected: (fmt: (s: string) => string) => string }> = [
  { name: "scheduled", over: { activatesAt: iso(9 * DAY) }, expected: (f) => `Goes live ${f(iso(9 * DAY))}` },
  { name: "active with an expiry", over: { expiresAt: iso(30 * DAY) }, expected: (f) => `Expires ${f(iso(30 * DAY))}` },
  { name: "expiring soon", over: { expiresAt: iso(2 * DAY) }, expected: (f) => `Expires ${f(iso(2 * DAY))}` },
  { name: "expired by date", over: { expiresAt: iso(-3 * DAY) }, expected: (f) => `Expired ${f(iso(-3 * DAY))}` },
  { name: "click limit not reached", over: { clickLimit: 1500, clicks: 3 }, expected: () => "Expires after 1.5k clicks" },
  { name: "click limit reached", over: { clickLimit: 50, clicks: 50 }, expected: () => "Expired after 50 clicks" },
  { name: "never expires", over: {}, expected: () => "Never expires" },
  {
    name: "scheduled with an expiry",
    over: { activatesAt: iso(2 * DAY), expiresAt: iso(20 * DAY) },
    expected: (f) => `Goes live ${f(iso(2 * DAY))}`,
  },
];

describe("lifecycleSummary", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const want = c.expected(formatDate);

      it("reads as expected on an unarchived link", () => {
        expect(lifecycleSummary(link(c.over), NOW)).toBe(want);
      });

      it("reads the same once the link is archived", () => {
        expect(lifecycleSummary(link(c.over, true), NOW)).toBe(want);
      });
    });
  }

  it("never calls a scheduled link 'Never expires', archived or not", () => {
    for (const archived of [false, true]) {
      expect(lifecycleSummary(link({ activatesAt: iso(DAY) }, archived), NOW)).not.toMatch(/never expires/i);
    }
  });

  it("agrees with deriveStatus on what the link would be if it were not archived", () => {
    const instants = [-2 * DAY, -1, 0, 1, DAY, 8 * DAY].map(iso);
    const nullable = [null, ...instants];
    for (const activatesAt of nullable) {
      for (const expiresAt of nullable) {
        for (const [clickLimit, clicks] of [[null, 0], [10, 9], [10, 10], [10, 11]] as const) {
          const fields = { activatesAt, expiresAt, clickLimit, clicks };
          const underlying = deriveStatus(fields, NOW);
          const expectStart =
            underlying === "scheduled" ? /^Goes live / : underlying === "expired" ? /^Expired / : /^(Expires|Never expires)/;
          for (const archived of [false, true]) {
            const text = lifecycleSummary({ ...fields, status: archived ? "archived" : underlying }, NOW);
            expect(text, JSON.stringify({ fields, archived, underlying })).toMatch(expectStart);
          }
        }
      }
    }
  });

  describe("instant boundaries (mirror deriveStatus: activates is > now, expires is <= now)", () => {
    it("a link whose start is exactly now is live, not scheduled", () => {
      expect(lifecycleSummary(link({ activatesAt: iso(0) }, true), NOW)).toBe("Never expires");
    });

    it("a link whose start is 1 ms away is scheduled", () => {
      expect(lifecycleSummary(link({ activatesAt: iso(1) }, true), NOW)).toMatch(/^Goes live /);
    });

    it("a link whose expiry is exactly now has expired", () => {
      expect(lifecycleSummary(link({ expiresAt: iso(0) }, true), NOW)).toMatch(/^Expired /);
    });

    it("a link whose expiry is 1 ms away has not", () => {
      expect(lifecycleSummary(link({ expiresAt: iso(1) }, true), NOW)).toMatch(/^Expires /);
    });

    it("crosses the boundary as the clock moves, without the status changing", () => {
      const archived = link({ activatesAt: iso(DAY) }, true);
      expect(lifecycleSummary(archived, NOW)).toMatch(/^Goes live /);
      expect(lifecycleSummary(archived, new Date(NOW.getTime() + DAY))).toBe("Never expires");
    });

    it("ignores an unparseable timestamp rather than printing it as a date", () => {
      expect(lifecycleSummary(link({ activatesAt: "not-a-date" }, true), NOW)).toBe("Never expires");
    });
  });

  describe("timezone boundaries", () => {
    const original = process.env.TZ;
    afterEach(() => {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    });

    /* 2026-07-01T00:30:00+05:30 is 2026-06-30T19:00:00Z: the calendar day the
       row prints depends on the viewer's zone, but the decision (scheduled)
       does not. */
    const GOES_LIVE = "2026-06-30T19:00:00.000Z";
    const before = new Date("2026-06-30T18:59:59.999Z");

    it("prints the viewer's calendar day for the same instant", () => {
      process.env.TZ = "Asia/Kolkata";
      expect(lifecycleSummary(link({ activatesAt: GOES_LIVE }, true), before)).toBe(`Goes live ${formatDate(GOES_LIVE)}`);
      expect(formatDate(GOES_LIVE)).toContain("1");
      expect(formatDate(GOES_LIVE)).toMatch(/Jul/);

      process.env.TZ = "America/Los_Angeles";
      expect(lifecycleSummary(link({ activatesAt: GOES_LIVE }, true), before)).toBe(`Goes live ${formatDate(GOES_LIVE)}`);
      expect(formatDate(GOES_LIVE)).toMatch(/Jun/);
    });

    it("makes the same scheduled/live decision in every zone", () => {
      for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "UTC"]) {
        process.env.TZ = tz;
        expect(lifecycleSummary(link({ activatesAt: GOES_LIVE }, true), before), tz).toMatch(/^Goes live /);
        expect(lifecycleSummary(link({ activatesAt: GOES_LIVE }, true), new Date(GOES_LIVE)), tz).toBe("Never expires");
      }
    });
  });
});
