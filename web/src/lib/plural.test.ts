import { describe, expect, it } from "vitest";
import { countedDomains, hasHave, memberCounts, memberSummary, plural, pluralNoun } from "./plural";

describe("plural (#793)", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "link")).toBe("1 link");
    expect(plural(1, "domain")).toBe("1 domain");
    expect(plural(1, "rule")).toBe("1 rule");
    expect(plural(1, "member")).toBe("1 member");
  });

  it("uses the plural for zero and for more than one", () => {
    expect(plural(0, "link")).toBe("0 links");
    expect(plural(2, "domain")).toBe("2 domains");
    expect(plural(11, "rule")).toBe("11 rules");
  });

  it("groups large numbers and honours a custom formatter", () => {
    expect(plural(2431, "link", { format: (n) => n.toLocaleString("en-US") })).toBe("2,431 links");
    expect(plural(84_392, "click", { format: () => "84.4k" })).toBe("84.4k clicks");
    // 1,000 clicks is plural even though compact() would print "1.0k".
    expect(plural(1000, "click", { format: () => "1.0k" })).toBe("1.0k clicks");
  });

  it("takes an irregular plural", () => {
    expect(plural(1, "country", { plural: "countries" })).toBe("1 country");
    expect(plural(3, "country", { plural: "countries" })).toBe("3 countries");
  });

  it("treats a negative one like one, and a decimal as plural", () => {
    expect(pluralNoun(-1, "day")).toBe("day");
    expect(pluralNoun(1.5, "day")).toBe("days");
  });

  it("agrees the verb", () => {
    expect(hasHave(1)).toBe("has");
    expect(hasHave(0)).toBe("have");
    expect(hasHave(2)).toBe("have");
  });
});

const m = (status: "active" | "invited") => ({ status });

describe("memberCounts / memberSummary (#793 — a pending invite is not a member)", () => {
  it("one member plus one pending invite reads '1 member · 1 pending', not '2 members'", () => {
    const list = [m("active"), m("invited")];
    expect(memberCounts(list)).toEqual({ active: 1, pending: 1 });
    expect(memberSummary(list)).toBe("1 member · 1 pending");
  });

  it("omits the pending part when nobody is pending", () => {
    expect(memberSummary([m("active")])).toBe("1 member");
    expect(memberSummary([m("active"), m("active"), m("active")])).toBe("3 members");
  });

  it("handles only-invites, empty and not-yet-loaded lists", () => {
    expect(memberSummary([m("invited"), m("invited")])).toBe("0 members · 2 pending");
    expect(memberSummary([])).toBe("0 members");
    expect(memberCounts(undefined)).toEqual({ active: 0, pending: 0 });
  });
});

describe("countedDomains (#793 — unverified domains do not count)", () => {
  const d = (status: "live" | "verifying" | "failed", links: number) => ({ status, links });

  it("excludes a domain that is still verifying and holds no links", () => {
    const list = [d("live", 1), d("verifying", 0)];
    expect(countedDomains(list)).toHaveLength(1);
  });

  it("keeps a live domain with no links and a non-live domain that holds links", () => {
    expect(countedDomains([d("live", 0)])).toHaveLength(1);
    expect(countedDomains([d("failed", 4)])).toHaveLength(1);
  });

  it("is empty for undefined", () => {
    expect(countedDomains(undefined)).toEqual([]);
  });
});
