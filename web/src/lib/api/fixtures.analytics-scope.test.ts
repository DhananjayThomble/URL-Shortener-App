import { describe, expect, it } from "vitest";
import { Analytics, type AnalyticsRange } from "@snapurl/contract";
import { fixtureRequest, LINKS } from "./fixtures";

/* #768 — fixtures mode must not re-create the scope bug the issue is about.
   The real API scopes GET /analytics?range&linkId to the link AND the window;
   the fixture used to ignore `range` and hand back the link's ALL-TIME counters
   as the range totals, so switching the range changed only the label while the
   page showed "18,402 last 24h" next to "18,402 all-time".

   Oracle: the acceptance criteria — the headline total is range-scoped (so a
   narrower range is strictly smaller than a wider one and than all-time), every
   breakdown sums to it, and one link's analytics never carry another's. */

const get = (linkId: string, range: AnalyticsRange) =>
  fixtureRequest(`/analytics?range=${range}&linkId=${linkId}`, Analytics);
const sum = (rows: { value: number }[]) => rows.reduce((n, r) => n + r.value, 0);

const link = LINKS.find((l) => l.clicks > 0)!;
const other = LINKS.filter((l) => l.id !== link.id && l.clicks > 0)[0]!;

describe("fixture /analytics is range-scoped per link (#768)", () => {
  it("a narrower range returns fewer clicks than a wider one, and 12m is the all-time figure", async () => {
    const [h24, d30, m12] = await Promise.all([get(link.id, "24h"), get(link.id, "30d"), get(link.id, "12m")]);
    expect(h24.totals.clicks).toBeLessThan(d30.totals.clicks);
    expect(d30.totals.clicks).toBeLessThan(m12.totals.clicks);
    // The widest window is the all-time counter; the shorter ones are NOT it.
    expect(m12.totals.clicks).toBe(link.clicks);
    expect(h24.totals.clicks).not.toBe(link.clicks);
    expect(d30.totals.clicks).not.toBe(link.clicks);
  });

  it("every breakdown sums to that range's headline total", async () => {
    for (const range of ["24h", "30d", "12m"] as const) {
      const a = await get(link.id, range);
      expect(sum(a.countries), `${range} countries`).toBe(a.totals.clicks);
      expect(sum(a.devices), `${range} devices`).toBe(a.totals.clicks);
    }
  });

  it("uniques never exceed clicks and shrink with the range", async () => {
    const [h24, m12] = await Promise.all([get(link.id, "24h"), get(link.id, "12m")]);
    expect(h24.totals.unique).toBeLessThanOrEqual(h24.totals.clicks);
    expect(h24.totals.unique).toBeLessThan(m12.totals.unique);
  });

  it("does not mix links: a second link's totals are its own, not the first's", async () => {
    const [a, b] = await Promise.all([get(link.id, "30d"), get(other.id, "30d")]);
    expect(a.totals.clicks).not.toBe(b.totals.clicks);
    expect(b.totals.clicks).toBeLessThan(other.clicks + 1);
  });

  it("without a linkId it is the whole-workspace figures (unchanged)", async () => {
    const a = await get("", "30d");
    // The workspace fixture totals are far larger than any single link's window.
    expect(a.totals.clicks).toBeGreaterThan(link.clicks);
  });
});
