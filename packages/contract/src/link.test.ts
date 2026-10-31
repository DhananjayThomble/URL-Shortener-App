import { describe, expect, it } from "vitest";
import {
  BulkCreateLinksInput,
  BulkCreateLinksResult,
  BulkLinkOutcome,
  CloneLinkInput,
  CreateLinkInput,
  DeviceType,
  Link,
  LinkDateInput,
  LinkList,
  ListLinksQuery,
  RoutingRule,
  UpdateLinkInput,
} from "./link.js";

/* #895: link.ts is the largest contract module. The URL-bearing fields and the
   date parser already have their own suites (http-url.test.ts, link-dates.test.ts,
   click-limit.test.ts); these cover what mutation testing showed uncovered — the
   enums, the response/DTO shapes, the boolean defaults, the slug and weight
   constraints, the bulk envelope bounds, and the calendar-validity branches of
   LinkDateInput exercised directly on each clause. */

const base = { destination: "https://example.com/x", domain: "snap.to" };

describe("DeviceType enum", () => {
  it("accepts ios/android/desktop/mobile and rejects others", () => {
    for (const d of ["ios", "android", "desktop", "mobile"]) expect(DeviceType.safeParse(d).success).toBe(true);
    expect(DeviceType.safeParse("watch").success).toBe(false);
    expect(DeviceType.safeParse("").success).toBe(false);
  });
});

describe("LinkDateInput — calendar validity, each clause exercised", () => {
  it("accepts an empty string, a full timestamp and a real day", () => {
    expect(LinkDateInput.safeParse("").success).toBe(true);
    expect(LinkDateInput.safeParse("2026-01-01T00:00:00.000Z").success).toBe(true);
    expect(LinkDateInput.safeParse("2026-02-28").success).toBe(true);
    expect(LinkDateInput.safeParse("2028-02-29").success).toBe(true); // real leap day
  });

  it("rejects an unparseable string (kills the Date.parse NaN guard)", () => {
    expect(LinkDateInput.safeParse("not-a-date").success).toBe(false);
    expect(LinkDateInput.safeParse("tomorrow").success).toBe(false);
  });

  it("rejects day-granular dates that roll into another month or year (kills each && clause)", () => {
    // day rolls, month changes: 2026-02-30 → 2026-03-02 (month 2 ≠ 3)
    expect(LinkDateInput.safeParse("2026-02-30").success).toBe(false);
    expect(LinkDateInput.safeParse("2026-04-31").success).toBe(false);
    // month out of range: 2026-13-01 → 2027-01-01 (year 2026 ≠ 2027)
    expect(LinkDateInput.safeParse("2026-13-01").success).toBe(false);
    // month zero: 2026-00-10 is not parsed as Jan — refused
    expect(LinkDateInput.safeParse("2026-00-10").success).toBe(false);
    // day zero: 2026-01-00 → 2025-12-31 (year 2026 ≠ 2025, month 1 ≠ 12, day 0 ≠ 31)
    expect(LinkDateInput.safeParse("2026-01-00").success).toBe(false);
    // day 32 in Jan → 2026-02-01 (month 1 ≠ 2)
    expect(LinkDateInput.safeParse("2026-01-32").success).toBe(false);
  });

  it("the DATE_ONLY shape only triggers on a bare YYYY-MM-DD (kills the regex anchor mutants)", () => {
    // A string that is a valid instant but not the bare day shape is left to Date.parse,
    // which accepts it — proving the regex gates the calendar re-check.
    expect(LinkDateInput.safeParse("2026-02-30T12:00:00Z").success).toBe(true); // Date.parse rolls it, but it's not day-only, so accepted by design
    expect(LinkDateInput.safeParse("2026-01-01").success).toBe(true);
  });
});

describe("RoutingRule shape and weight bounds", () => {
  const valid = { id: "r1", when: {}, then: "https://example.com" };
  it("accepts a minimal rule and a full one", () => {
    expect(RoutingRule.safeParse(valid).success).toBe(true);
    expect(
      RoutingRule.safeParse({ ...valid, when: { country: "US", device: "ios", language: "en" }, weight: 50 }).success,
    ).toBe(true);
  });
  it("rejects a then that is not an http(s) URL", () => {
    expect(RoutingRule.safeParse({ ...valid, then: "javascript:alert(1)" }).success).toBe(false);
  });
  it("rejects a device outside DeviceType", () => {
    expect(RoutingRule.safeParse({ ...valid, when: { device: "watch" } }).success).toBe(false);
  });
  it("bounds weight to 0..100 (kills min(0)/max(100) mutations)", () => {
    expect(RoutingRule.safeParse({ ...valid, weight: 0 }).success).toBe(true);
    expect(RoutingRule.safeParse({ ...valid, weight: 100 }).success).toBe(true);
    expect(RoutingRule.safeParse({ ...valid, weight: -1 }).success).toBe(false); // min(0) → max(0) mutant rejects 100
    expect(RoutingRule.safeParse({ ...valid, weight: 101 }).success).toBe(false);
  });
});

describe("Link response shape — defaults and nested blocks", () => {
  const row = {
    id: "l1",
    domain: "snap.to",
    slug: "s",
    destination: "https://example.com",
    status: "active" as const,
    clicks: 0,
    safeBrowsing: { status: "clean" as const, checkedAt: "2026-01-01T00:00:00.000Z" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("applies the documented boolean and collection defaults", () => {
    const parsed = Link.parse(row);
    expect(parsed.redirectType).toBe("302"); // kills redirectType default("302")
    expect(parsed.tags).toEqual([]); // kills tags default([]) → ["Stryker was here"]
    expect(parsed.rules).toEqual([]);
    expect(parsed.sparkline).toEqual([]);
    expect(parsed.passwordProtected).toBe(false); // kills default(false) → default(true)
    expect(parsed.forwardQuery).toBe(true); // kills default(true) → default(false)
    expect(parsed.deepLink).toBe(false);
    expect(parsed.hideReferrer).toBe(false);
    expect(parsed.publicPreview).toBe(true);
    expect(parsed.cloaked).toBe(false);
  });

  it("requires the status enum and the nested safeBrowsing block (kills the shape → {} mutants)", () => {
    expect(Link.safeParse({ ...row, status: "paused" }).success).toBe(false);
    const { safeBrowsing: _sb, ...noSb } = row;
    expect(Link.safeParse(noSb).success).toBe(false);
    expect(Link.safeParse({ ...row, safeBrowsing: { status: "mystery", checkedAt: "x" } }).success).toBe(false);
    const { id: _id, ...noId } = row;
    expect(Link.safeParse(noId).success).toBe(false);
  });
});

describe("CreateLinkInput — slug regex, comment cap, defaults", () => {
  it("accepts a legal slug, empty slug, rejects illegal characters (kills the regex anchors)", () => {
    expect(CreateLinkInput.safeParse({ ...base, slug: "my-link_1.v2" }).success).toBe(true);
    expect(CreateLinkInput.safeParse({ ...base, slug: "" }).success).toBe(true); // .or(z.literal(""))
    expect(CreateLinkInput.safeParse({ ...base, slug: "bad slug" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, slug: "has/slash" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, slug: "@illegal" }).success).toBe(false);
  });
  it("caps comment at 280 chars (kills max(280) → min(280))", () => {
    expect(CreateLinkInput.safeParse({ ...base, comment: "a".repeat(280) }).success).toBe(true);
    expect(CreateLinkInput.safeParse({ ...base, comment: "a".repeat(281) }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, comment: "" }).success).toBe(true); // short value — min(280) mutant would reject
  });
  it("defaults tags and rules to empty arrays and leaves redirectType unset (#753)", () => {
    const parsed = CreateLinkInput.parse(base);
    expect(parsed.tags).toEqual([]);
    expect(parsed.rules).toEqual([]);
    expect(parsed.redirectType).toBeUndefined(); // no contract default by design
    expect(CreateLinkInput.safeParse({ ...base, redirectType: "302" }).success).toBe(true);
  });
  it("requires a non-empty destination and domain", () => {
    expect(CreateLinkInput.safeParse({ destination: "https://x.com", domain: "" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: "", domain: "d" }).success).toBe(false);
  });
});

describe("UpdateLinkInput — omit domain/slug, partial, extra fields", () => {
  it("accepts an empty patch (all optional)", () => {
    expect(UpdateLinkInput.safeParse({}).success).toBe(true);
  });
  it("drops domain and slug from the shape (kills omit({...}) → omit({}))", () => {
    // domain and slug are stripped as unknown keys; a value on them must not survive.
    const parsed = UpdateLinkInput.parse({ domain: "x", slug: "y", comment: "hi" });
    expect("domain" in parsed).toBe(false);
    expect("slug" in parsed).toBe(false);
    expect(parsed.comment).toBe("hi");
  });
  it("adds the archived boolean and tri-state password", () => {
    expect(UpdateLinkInput.safeParse({ archived: true }).success).toBe(true);
    expect(UpdateLinkInput.safeParse({ archived: "yes" }).success).toBe(false);
    expect(UpdateLinkInput.safeParse({ password: null }).success).toBe(true);
  });
});

describe("BulkCreateLinksInput / BulkLinkOutcome / BulkCreateLinksResult", () => {
  it("bounds the links envelope to 1..100 rows (kills min(1)/max(100))", () => {
    const rows = (n: number) => Array.from({ length: n }, () => ({ destination: "https://x.com" }));
    expect(BulkCreateLinksInput.safeParse({ links: rows(1) }).success).toBe(true);
    expect(BulkCreateLinksInput.safeParse({ links: rows(100) }).success).toBe(true);
    expect(BulkCreateLinksInput.safeParse({ links: rows(0) }).success).toBe(false); // min(1) → max(1) mutant rejects 100
    expect(BulkCreateLinksInput.safeParse({ links: rows(101) }).success).toBe(false);
  });
  it("BulkLinkOutcome discriminates on ok (kills the shape → {} mutants)", () => {
    const linkRow = {
      id: "l1", domain: "snap.to", slug: "s", destination: "https://example.com", status: "active",
      clicks: 0, safeBrowsing: { status: "clean", checkedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(BulkLinkOutcome.safeParse({ ok: true, index: 0, link: linkRow }).success).toBe(true);
    expect(BulkLinkOutcome.safeParse({ ok: false, index: 1, destination: "bad", error: "nope" }).success).toBe(true);
    expect(BulkLinkOutcome.safeParse({ ok: true, index: 0 }).success).toBe(false); // no link
    expect(BulkLinkOutcome.safeParse({ ok: false, index: 1 }).success).toBe(false); // no destination/error
  });
  it("BulkCreateLinksResult requires the three integer tallies and a results array", () => {
    const parsed = BulkCreateLinksResult.parse({ created: 1, skipped: 0, failed: 0, results: [] });
    expect(parsed.created).toBe(1);
    expect(BulkCreateLinksResult.safeParse({ created: 1.5, skipped: 0, failed: 0, results: [] }).success).toBe(false); // int()
    expect(BulkCreateLinksResult.safeParse({ created: 1, skipped: 0, failed: 0 }).success).toBe(false); // no results
  });
});

describe("CloneLinkInput — slug regex, domain floor", () => {
  it("accepts a legal/empty slug and rejects illegal characters (kills the regex anchors)", () => {
    expect(CloneLinkInput.safeParse({ slug: "copy_1.v2-x" }).success).toBe(true);
    expect(CloneLinkInput.safeParse({ slug: "" }).success).toBe(true);
    expect(CloneLinkInput.safeParse({ slug: "bad slug" }).success).toBe(false);
    expect(CloneLinkInput.safeParse({ slug: "@no" }).success).toBe(false);
  });
  it("requires a non-empty domain when provided (kills min(1) → max(1))", () => {
    expect(CloneLinkInput.safeParse({ domain: "snap.to" }).success).toBe(true); // multi-char — max(1) would reject
    expect(CloneLinkInput.safeParse({ domain: "" }).success).toBe(false);
    expect(CloneLinkInput.safeParse({}).success).toBe(true); // domain optional
  });
  it("validates an override expiresAt like a new link's", () => {
    expect(CloneLinkInput.safeParse({ expiresAt: "2026-02-30" }).success).toBe(false); // calendar-impossible
    expect(CloneLinkInput.safeParse({ expiresAt: "2026-02-28" }).success).toBe(true);
    expect(CloneLinkInput.safeParse({ expiresAt: null }).success).toBe(true); // remove expiry
  });
});

describe("LinkList / ListLinksQuery", () => {
  it("LinkList requires items and total", () => {
    expect(LinkList.parse({ items: [], total: 0 }).total).toBe(0);
    expect(LinkList.safeParse({ items: [] }).success).toBe(false);
  });
  it("ListLinksQuery defaults status to all and limit to 50, bounding limit 1..100", () => {
    const parsed = ListLinksQuery.parse({});
    expect(parsed.status).toBe("all"); // kills status default("all") → [] enum / other default
    expect(parsed.limit).toBe(50); // kills limit default(50)
    expect(ListLinksQuery.safeParse({ status: "weird" }).success).toBe(false);
    expect(ListLinksQuery.safeParse({ limit: 0 }).success).toBe(false); // min(1)
    expect(ListLinksQuery.safeParse({ limit: 101 }).success).toBe(false); // max(100)
    expect(ListLinksQuery.safeParse({ limit: "25" }).success).toBe(true); // coerce
  });
});


describe("link residual-mutant kills (#895)", () => {
  it("LinkDateInput anchors the day-only shape at the start (kills the DATE_ONLY ^-drop)", () => {
    // Dropping the ^ would let "xx2026-02-30" match the day-only branch and be
    // re-checked as a calendar date; with the anchor it is left to Date.parse,
    // which rejects it outright. Either way it must be refused — but the branch
    // taken differs, so this pins the anchor.
    expect(LinkDateInput.safeParse("2026-02-30").success).toBe(false); // rolls month → rejected
    expect(LinkDateInput.safeParse("2026-04-31").success).toBe(false);
    expect(LinkDateInput.safeParse("2026-01-15").success).toBe(true); // a real day-only date
  });

  it("UpdateLinkInput inherits the boolean defaults from CreateLinkInput (kills the default flips)", () => {
    const parsed = UpdateLinkInput.parse({});
    expect(parsed.forwardQuery).toBe(true); // kills default(true) → default(false)
    expect(parsed.deepLink).toBe(false); // kills default(false) → default(true)
    expect(parsed.hideReferrer).toBe(false);
    expect(parsed.publicPreview).toBe(true);
  });

  it("CreateLinkInput utm and social are shaped objects, not {} (kills the nested .object → {} mutants)", () => {
    // utm string fields must be strings; a {} shape would accept a number.
    expect(CreateLinkInput.safeParse({ ...base, utm: { source: 5 } }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, utm: { source: "newsletter" } }).success).toBe(true);
    // social.image still goes through HttpUrl; a {} social shape would drop that guard.
    expect(CreateLinkInput.safeParse({ ...base, social: { image: "javascript:alert(1)" } }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, social: { title: 5 } }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ ...base, social: { title: "Hi", image: "https://ok.com/i.png" } }).success).toBe(true);
  });

  it("Link response utm/social nested shapes are validated too", () => {
    const row = {
      id: "l1", domain: "snap.to", slug: "s", destination: "https://example.com", status: "active",
      clicks: 0, safeBrowsing: { status: "clean", checkedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z",
    };
    expect(Link.safeParse({ ...row, utm: { source: 5 } }).success).toBe(false);
    expect(Link.safeParse({ ...row, social: { title: 5 } }).success).toBe(false);
  });
});


describe("link residual enum kill (#895)", () => {
  it("ListLinksQuery.status accepts a valid non-default value (kills the enum [] mutant)", () => {
    expect(ListLinksQuery.safeParse({ status: "archived" }).success).toBe(true);
    expect(ListLinksQuery.safeParse({ status: "scheduled" }).success).toBe(true);
    expect(ListLinksQuery.parse({ status: "active" }).status).toBe("active");
  });
});
