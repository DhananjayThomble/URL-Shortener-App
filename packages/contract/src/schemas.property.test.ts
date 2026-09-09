import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { HttpUrl, isDeniedHost } from "./http-url.js";
import { BulkLinkOutcome, CreateLinkInput, Link } from "./link.js";

/* Property tests for the contract schemas (issue #356). packages/contract is the
   single source of truth for every payload shape; these generate inputs biased
   toward the boundaries hand-written tests miss. Seeded so CI is deterministic. */

const SEED = 4356;
const runs = { numRuns: 500, seed: SEED };

/* ------------------------------------------------------------------ *
 * 1. HttpUrl — the SSRF guard. Generators biased at the denylist edges.
 *    Every generated internal host MUST be rejected. A genuine miss here is a
 *    security bug to REPORT as its own issue, never to accommodate by loosening
 *    the test.
 * ------------------------------------------------------------------ */
describe("HttpUrl rejects internal hosts (SSRF guard)", () => {
  const octet = fc.integer({ min: 0, max: 255 });

  // Private / loopback / link-local / CGNAT IPv4, generated across each range
  // and its edges rather than a fixed list.
  const deniedIpv4 = fc.oneof(
    fc.tuple(fc.constant(0), octet, octet, octet), // 0.0.0.0/8
    fc.tuple(fc.constant(10), octet, octet, octet), // 10/8
    fc.tuple(fc.constant(127), octet, octet, octet), // 127/8 loopback
    fc.tuple(fc.constant(169), fc.constant(254), octet, octet), // 169.254/16 metadata
    fc.tuple(fc.constant(172), fc.integer({ min: 16, max: 31 }), octet, octet), // 172.16/12
    fc.tuple(fc.constant(192), fc.constant(168), octet, octet), // 192.168/16
    fc.tuple(fc.constant(100), fc.integer({ min: 64, max: 127 }), octet, octet), // 100.64/10 CGNAT
  ).map((o) => o.join("."));

  it("rejects every private/loopback/link-local IPv4", () => {
    fc.assert(
      fc.property(deniedIpv4, fc.constantFrom("http", "https"), (host, scheme) => {
        expect(HttpUrl.safeParse(`${scheme}://${host}/path`).success).toBe(false);
      }),
      runs,
    );
  });

  it("rejects IPv6 loopback, link-local and unique-local, incl. IPv4-mapped metadata", () => {
    const deniedIpv6 = fc.constantFrom(
      "::1",
      "::",
      "[::1]",
      "fe80::1",
      "fd00::1",
      "fc00::1",
      "[fe80::abcd]",
      "::ffff:169.254.169.254",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    );
    fc.assert(
      fc.property(deniedIpv6, (host) => {
        expect(HttpUrl.safeParse(`http://[${host.replace(/^\[|\]$/g, "")}]/`).success).toBe(false);
      }),
      runs,
    );
  });

  it("rejects localhost and *.localhost regardless of case", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("localhost", "LOCALHOST", "LocalHost", "foo.localhost", "a.b.localhost"),
        (host) => {
          expect(isDeniedHost(host)).toBe(true);
          expect(HttpUrl.safeParse(`https://${host}/`).success).toBe(false);
        },
      ),
      runs,
    );
  });

  it("rejects non-http(s) schemes outright", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "javascript:alert(1)",
          "data:text/html;base64,PHNjcmlwdD4=",
          "file:///etc/passwd",
          "ftp://example.com/x",
          "gopher://example.com",
        ),
        (url) => {
          expect(HttpUrl.safeParse(url).success).toBe(false);
        },
      ),
      runs,
    );
  });

  it("accepts ordinary public https URLs (no false positives on public hosts)", () => {
    // Public IPv4: first octet not in any denied leading range, kept simple.
    const publicHost = fc.constantFrom(
      "example.com",
      "sub.example.co.uk",
      "8.8.8.8",
      "1.1.1.1",
      "93.184.216.34",
      "github.com",
    );
    fc.assert(
      fc.property(publicHost, (host) => {
        expect(HttpUrl.safeParse(`https://${host}/path?q=1`).success).toBe(true);
      }),
      runs,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. Tri-state fields: undefined / null / value are each accepted, and the
 *    parsed value distinguishes them (they have different service semantics).
 * ------------------------------------------------------------------ */
describe("tri-state nullable+optional fields keep all three states distinct", () => {
  const base = { destination: "https://example.com/x", domain: "snap.to" };

  it("expiresAt: undefined, null and a string are each preserved as-is", () => {
    // Note: expiresAt is .nullable().optional() on the INPUT schema. (comment is
    // deliberately optional-only on CreateLinkInput even though Link.comment is
    // nullable — an intentional input/response asymmetry, not a bug.)
    fc.assert(
      fc.property(fc.option(fc.option(fc.string({ maxLength: 40 }), { nil: null }), { nil: undefined }), (value) => {
        const parsed = CreateLinkInput.safeParse({ ...base, expiresAt: value });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.expiresAt).toStrictEqual(value);
      }),
      runs,
    );
  });

  it("clickLimit: undefined, null and a number stay distinct", () => {
    fc.assert(
      fc.property(fc.option(fc.option(fc.integer(), { nil: null }), { nil: undefined }), (value) => {
        const parsed = CreateLinkInput.safeParse({ ...base, clickLimit: value });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.clickLimit).toStrictEqual(value);
      }),
      runs,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. Discriminated union: no input parses as two variants.
 * ------------------------------------------------------------------ */
describe("BulkLinkOutcome discriminated union is mutually exclusive", () => {
  const okVariant = fc.record({
    ok: fc.constant(true),
    index: fc.integer(),
    link: fc.constant(exampleLink()),
  });
  const errVariant = fc.record({
    ok: fc.constant(false),
    index: fc.integer(),
    destination: fc.string(),
    error: fc.string(),
  });

  it("a valid outcome parses as exactly one variant, keyed on ok", () => {
    fc.assert(
      fc.property(fc.oneof(okVariant, errVariant), (outcome) => {
        const parsed = BulkLinkOutcome.safeParse(outcome);
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.ok).toBe(outcome.ok);
      }),
      { numRuns: 200, seed: SEED },
    );
  });

  it("a wrong-shape-for-its-discriminant object is rejected", () => {
    // ok:true but carrying the error branch's fields (and no link) must fail.
    fc.assert(
      fc.property(fc.string(), fc.integer(), (error, index) => {
        expect(BulkLinkOutcome.safeParse({ ok: true, index, destination: "x", error }).success).toBe(false);
      }),
      { numRuns: 200, seed: SEED },
    );
  });
});

/* ------------------------------------------------------------------ *
 * 4. Round-trip stability: a value the schema accepts re-parses unchanged.
 * ------------------------------------------------------------------ */
describe("Link response schema round-trips", () => {
  it("parse(x) then parse(parse(x)) is stable", () => {
    const link = exampleLink();
    const once = Link.parse(link);
    const twice = Link.parse(once);
    expect(twice).toStrictEqual(once);
  });
});

/* A minimal valid Link built from the schema's required fields, so the union and
   round-trip tests never hand-roll a shape that drifts from the contract. */
function exampleLink(): z.infer<typeof Link> {
  return Link.parse({
    id: "lnk_1",
    domain: "snap.to",
    slug: "spring-sale",
    destination: "https://example.com/x",
    status: "active",
    clicks: 0,
    createdAt: new Date().toISOString(),
    tags: [],
    rules: [],
    redirectType: "302",
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    sparkline: [],
    safeBrowsing: { status: "clean", checkedAt: new Date().toISOString() },
  });
}
