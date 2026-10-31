import { describe, expect, it } from "vitest";
import { HttpUrl, isDeniedHost, isDeniedIpv4, isDeniedIpv6 } from "./http-url.js";
import { CreateLinkInput, RoutingRule } from "./link.js";
import { AddDomainInput, CreateWebhookInput, UpdateDomainInput, UpsertBioPageInput } from "./workspace.js";

/* Issue #280: every URL-bearing field goes through HttpUrl, which rejects
   dangerous schemes and internal hosts before anything can emit them as a
   Location header or render them as a clickable <a href>. */

describe("HttpUrl — accepted", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "https://example.com/path?q=1#frag",
    "https://sub.example.co.uk/a/b/c",
    "https://example.com:8443/ok",
    "https://8.8.8.8/public-dns",
  ])("accepts %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(true);
  });
});

describe("HttpUrl — rejected schemes", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
    "tel:+15555555555",
    "ws://example.com/socket",
    "//example.com",
    "not a url",
  ])("rejects %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });
});

describe("HttpUrl — denylisted host ranges", () => {
  it.each([
    ["loopback name", "http://localhost/admin"],
    ["loopback name subdomain", "http://api.localhost/admin"],
    ["loopback v4", "http://127.0.0.1/x"],
    ["loopback v4 (127/8)", "http://127.99.1.2/x"],
    ["unspecified v4", "http://0.0.0.0/x"],
    ["private 10/8", "http://10.0.0.5/admin"],
    ["private 172.16/12", "http://172.16.0.1/x"],
    ["private 172.31/12", "http://172.31.255.255/x"],
    ["private 192.168/16", "http://192.168.1.1/x"],
    ["cgnat 100.64/10", "http://100.64.0.1/x"],
    ["link-local / metadata", "http://169.254.169.254/latest/meta-data/"],
    ["link-local range", "http://169.254.1.1/x"],
    ["ipv6 loopback", "http://[::1]/x"],
    ["ipv6 unspecified", "http://[::]/x"],
    ["ipv6 link-local", "http://[fe80::1]/x"],
    ["ipv6 link-local (outside fe80 literal, inside fe80::/10)", "http://[fe90::1]/x"],
    ["ipv6 link-local (top of fe80::/10 range)", "http://[febf::1]/x"],
    ["ipv6 unique-local", "http://[fd00::1]/x"],
    ["ipv4-mapped metadata", "http://[::ffff:169.254.169.254]/x"],
  ])("rejects %s: %s", (_label, url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });

  it("still allows public IPs that only look adjacent to private ranges", () => {
    expect(HttpUrl.safeParse("http://172.15.0.1/x").success).toBe(true); // just below 172.16/12
    expect(HttpUrl.safeParse("http://172.32.0.1/x").success).toBe(true); // just above 172.31
    expect(HttpUrl.safeParse("http://100.63.0.1/x").success).toBe(true); // just below CGNAT
    expect(HttpUrl.safeParse("http://100.128.0.1/x").success).toBe(true); // just above CGNAT
    expect(HttpUrl.safeParse("http://[fe7f::1]/x").success).toBe(true); // just below fe80::/10
    expect(HttpUrl.safeParse("http://[fec0::1]/x").success).toBe(true); // just above fe80::/10
  });
});

describe("isDeniedHost", () => {
  it("flags internal hosts and clears public ones", () => {
    expect(isDeniedHost("localhost")).toBe(true);
    expect(isDeniedHost("169.254.169.254")).toBe(true);
    expect(isDeniedHost("10.0.0.5")).toBe(true);
    expect(isDeniedHost("example.com")).toBe(false);
    expect(isDeniedHost("8.8.8.8")).toBe(false);
  });
});

/* #711 review, Minor-2: WHATWG URL silently strips tab/CR/LF while parsing,
   so `z.url()` accepted a value whose ORIGINAL string (the one persisted and
   later emitted as a Location header) still carried them. The redirect then
   threw ERR_INVALID_CHAR on every hit. No length cap either: a 200 KB value
   became a 200 KB Location header. */
describe("HttpUrl — control characters and length", () => {
  const controls = [
    ["CR LF (header-splitting shape)", "https://example.org/\r\nSet-Cookie: pwn=1"],
    ["LF", "https://example.org/a\nb"],
    ["CR", "https://example.org/a\rb"],
    ["TAB", "https://example.org/a\tb"],
    ["NUL", "https://example.org/\u0000"],
    ["BEL (other C0)", "https://example.org/a\u0007b"],
    ["unit separator (last C0)", "https://example.org/a\u001fb"],
    ["DEL", "https://example.org/a\u007fb"],
    ["leading control", "\u0001https://example.org/"],
  ] as const;
  it.each(controls)("rejects %s", (_label, url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });

  it("accepts printable non-ASCII and percent-encoded controls", () => {
    expect(HttpUrl.safeParse("https://example.org/caf\u00e9").success).toBe(true);
    expect(HttpUrl.safeParse("https://example.org/a%0D%0Ab").success).toBe(true);
    expect(HttpUrl.safeParse("https://example.org/a b").success).toBe(true); // space is not C0
  });

  it("caps length at 2048 characters (2048 ok, 2049 refused)", () => {
    const base = "https://example.org/";
    const at = base + "a".repeat(2048 - base.length);
    expect(at).toHaveLength(2048);
    expect(HttpUrl.safeParse(at).success).toBe(true);
    expect(HttpUrl.safeParse(at + "a").success).toBe(false);
    expect(HttpUrl.safeParse(base + "a".repeat(200_000)).success).toBe(false);
  });

  it("applies to both domain create and PATCH", () => {
    const long = "https://example.org/" + "a".repeat(2100);
    for (const v of [controls[0][1], controls[7][1], long]) {
      expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: v }).success).toBe(false);
      expect(AddDomainInput.safeParse({ domain: "acme.com", notFoundRedirect: v }).success).toBe(false);
      expect(UpdateDomainInput.safeParse({ rootRedirect: v }).success).toBe(false);
      expect(UpdateDomainInput.safeParse({ notFoundRedirect: v }).success).toBe(false);
    }
  });
});

/* Issue #712 item 2: a URL that embeds credentials in its authority
   (`user@host` / `user:pass@host`) must be refused. Those forms are a classic
   phishing disguise — the visible host looks legitimate while the real target
   is whatever follows the `@` — and the leaked credentials would otherwise be
   stored and later emitted as a Location header. An `@` that appears only in
   the path or query is harmless and must still pass. */
describe("HttpUrl — embedded credentials", () => {
  it.each([
    ["username only", "http://user@example.com/x"],
    ["username and password", "https://user:pass@example.com/x"],
    ["password only", "https://:pass@example.com/x"],
    ["credentials and denied host", "http://user@169.254.169.254/x"],
  ])("rejects %s: %s", (_label, url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });

  it("still accepts an '@' that appears only in the path or query", () => {
    expect(HttpUrl.safeParse("https://example.com/u@h").success).toBe(true);
    expect(HttpUrl.safeParse("https://example.com/?e=a@b.com").success).toBe(true);
  });

  it("propagates to domain create, domain update and link create", () => {
    const creds = "https://user:pass@evil.com/";
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: creds }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com", notFoundRedirect: creds }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: creds }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: creds, domain: "d" }).success).toBe(false);
  });
});

describe("every contract field routes through HttpUrl", () => {
  const bad = "javascript:alert(1)";
  const metadata = "http://169.254.169.254/latest/meta-data/";
  const good = "https://example.com/ok";

  /* Exhaustive by construction, not by enumeration.

     The cases below name specific fields, and that is exactly how expiresTo and
     scheduledTo came to be emitted verbatim as Location headers: both were added
     later as bare z.string(), and a test that lists fields by hand cannot notice
     a field nobody added to the list. http-url.ts states the intent — "a URL
     field added to the contract later cannot quietly skip the check" — so assert
     that mechanically: walk the schema's own keys, pick out the ones whose names
     denote a URL, and require each to reject a dangerous value. A new URL-ish
     field on CreateLinkInput now fails here until it is piped through HttpUrl. */
  const URLISH = /^(then|destination|href|endpoint|image)$|(To|Redirect|Url|Uri|Image|Href)$/;

  it("every URL-denoting field on CreateLinkInput rejects a dangerous value", () => {
    const keys = Object.keys(CreateLinkInput.shape).filter((k) => URLISH.test(k));

    // Guard the guard: if this finds nothing, the heuristic broke and the test
    // would pass vacuously.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain("expiresTo");
    expect(keys).toContain("scheduledTo");
    expect(keys).toContain("destination");

    for (const key of keys) {
      const payload = { destination: good, domain: "d", [key]: bad };
      expect(CreateLinkInput.safeParse(payload).success, `${key} accepted ${bad}`).toBe(false);
      const meta = { destination: good, domain: "d", [key]: metadata };
      expect(CreateLinkInput.safeParse(meta).success, `${key} accepted ${metadata}`).toBe(false);
    }
  });

  it("CreateLinkInput.destination rejects dangerous URLs", () => {
    expect(CreateLinkInput.safeParse({ destination: bad, domain: "d" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: metadata, domain: "d" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: good, domain: "d" }).success).toBe(true);
  });

  it("CreateLinkInput.social.image rejects dangerous URLs", () => {
    expect(
      CreateLinkInput.safeParse({ destination: good, domain: "d", social: { image: bad } }).success,
    ).toBe(false);
    expect(
      CreateLinkInput.safeParse({ destination: good, domain: "d", social: { image: good } }).success,
    ).toBe(true);
  });

  it("RoutingRule.then rejects dangerous URLs", () => {
    const base = { id: "r1", when: {} };
    expect(RoutingRule.safeParse({ ...base, then: bad }).success).toBe(false);
    expect(RoutingRule.safeParse({ ...base, then: metadata }).success).toBe(false);
    expect(RoutingRule.safeParse({ ...base, then: good }).success).toBe(true);
  });

  it("AddDomainInput.rootRedirect and notFoundRedirect reject dangerous URLs", () => {
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: bad }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com", notFoundRedirect: metadata }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: good }).success).toBe(true);
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: null }).success).toBe(true);
  });

  it("UpdateDomainInput (#648) reuses the same guard and allows null to clear", () => {
    expect(UpdateDomainInput.safeParse({ rootRedirect: bad }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ notFoundRedirect: metadata }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: "data:text/html,hi" }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: good }).success).toBe(true);
    expect(UpdateDomainInput.safeParse({ notFoundRedirect: good }).success).toBe(true);
    expect(UpdateDomainInput.safeParse({ rootRedirect: null, notFoundRedirect: null }).success).toBe(true);
    // Nothing to change, or something this route may not change.
    expect(UpdateDomainInput.safeParse({}).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ domain: "acme.com" }).success).toBe(false);
    expect(UpdateDomainInput.safeParse({ rootRedirect: null, isSystem: true }).success).toBe(false);
  });

  it("CreateWebhookInput.endpoint rejects dangerous URLs", () => {
    expect(CreateWebhookInput.safeParse({ endpoint: bad, events: ["link.created"] }).success).toBe(false);
    expect(CreateWebhookInput.safeParse({ endpoint: metadata, events: ["link.created"] }).success).toBe(false);
    expect(CreateWebhookInput.safeParse({ endpoint: good, events: ["link.created"] }).success).toBe(true);
  });

  it("UpsertBioPageInput block href rejects dangerous URLs", () => {
    const base = {
      domain: "d",
      slug: "me",
      profile: { name: "Me", bio: "" },
    };
    const block = (href: string) => ({ kind: "link" as const, title: "t", href });
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(bad)] }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(metadata)] }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(good)] }).success).toBe(true);
  });
});


/* ── SSRF denylist, exercised directly on the exported guards (#895) ──────────
   The URL-level tests above prove the schema rejects internal hosts, but they
   route through zod's `.url()` normalisation, which hides which *branch* of the
   range logic did the rejecting — so a mutant that flips one octet comparison
   can survive if another branch happens to catch the same literal. These tests
   call `isDeniedIpv4`/`isDeniedIpv6`/`isDeniedHost` directly and pin each range
   boundary and each guard clause, so every mutant in that logic is killed by a
   test that would turn green→red if the guard weakened. This is the SSRF guard;
   a surviving mutant here is a security test gap, never an equivalent. */
describe("isDeniedIpv4 — structural guards and every range boundary", () => {
  it("only treats a 4-part dotted quad as an IPv4 address (kills parts.length !== 4)", () => {
    // Fewer or more than four parts is not a v4 address and must not be denied.
    expect(isDeniedIpv4("10.0.0")).toBe(false); // 3 parts — not an address
    expect(isDeniedIpv4("10.0.0.0.0")).toBe(false); // 5 parts — not an address
    expect(isDeniedIpv4("10")).toBe(false);
    // The same literal WITH four parts IS denied, so the check is load-bearing.
    expect(isDeniedIpv4("10.0.0.0")).toBe(true);
  });

  it("rejects any octet that is non-integer or out of 0..255 (kills the .some octet guard)", () => {
    // Each of these has exactly one bad octet; a weakened guard would classify
    // them against the 10/8 or 192.168 rule instead of bailing to false.
    expect(isDeniedIpv4("10.0.0.256")).toBe(false); // > 255
    expect(isDeniedIpv4("10.0.0.-1")).toBe(false); // < 0
    expect(isDeniedIpv4("10.0.0.1.5")).toBe(false); // not 4 parts anyway
    expect(isDeniedIpv4("10.0.0.x")).toBe(false); // NaN octet
    expect(isDeniedIpv4("192.168.0.999")).toBe(false); // bad octet on an otherwise-private prefix
    expect(isDeniedIpv4("999.168.0.1")).toBe(false);
    // A valid, in-range private address still denies — proves the guard only
    // rejects the malformed ones (kills .some→.every and the || → && mutants:
    // .every would be false here because the first octet IS a valid integer).
    expect(isDeniedIpv4("192.168.0.1")).toBe(true);
  });

  it("denies 0.0.0.0/8, 10/8 and 127/8 but not neighbours", () => {
    expect(isDeniedIpv4("0.0.0.0")).toBe(true);
    expect(isDeniedIpv4("0.1.2.3")).toBe(true);
    expect(isDeniedIpv4("10.255.255.255")).toBe(true);
    expect(isDeniedIpv4("127.0.0.1")).toBe(true);
    expect(isDeniedIpv4("126.0.0.1")).toBe(false);
    expect(isDeniedIpv4("128.0.0.1")).toBe(false);
    expect(isDeniedIpv4("11.0.0.1")).toBe(false);
    expect(isDeniedIpv4("1.2.3.4")).toBe(false);
  });

  it("denies 169.254/16 only when BOTH octets match (kills && → || and branch forcing)", () => {
    expect(isDeniedIpv4("169.254.169.254")).toBe(true); // the metadata address
    expect(isDeniedIpv4("169.254.0.0")).toBe(true);
    // a === 169 but b !== 254 must be ALLOWED; a || mutant would deny this.
    expect(isDeniedIpv4("169.1.1.1")).toBe(false);
    expect(isDeniedIpv4("169.253.0.1")).toBe(false);
    // b === 254 but a !== 169 must be ALLOWED; a || mutant would deny this.
    expect(isDeniedIpv4("8.254.0.1")).toBe(false);
  });

  it("denies 172.16.0.0/12 across its range only (kills the b>=16 && b<=31 boundary)", () => {
    expect(isDeniedIpv4("172.16.0.1")).toBe(true); // bottom of range
    expect(isDeniedIpv4("172.31.255.255")).toBe(true); // top of range
    expect(isDeniedIpv4("172.23.0.1")).toBe(true); // mid range
    expect(isDeniedIpv4("172.15.0.1")).toBe(false); // just below
    expect(isDeniedIpv4("172.32.0.1")).toBe(false); // just above
    expect(isDeniedIpv4("171.16.0.1")).toBe(false); // a !== 172
  });

  it("denies 192.168/16 only when BOTH octets match (kills && → ||)", () => {
    expect(isDeniedIpv4("192.168.1.1")).toBe(true);
    expect(isDeniedIpv4("192.167.1.1")).toBe(false); // a === 192, b !== 168
    expect(isDeniedIpv4("8.168.1.1")).toBe(false); // b === 168, a !== 192
  });

  it("denies 100.64.0.0/10 across its range only (kills the b>=64 && b<=127 boundary)", () => {
    expect(isDeniedIpv4("100.64.0.1")).toBe(true); // bottom
    expect(isDeniedIpv4("100.127.255.255")).toBe(true); // top
    expect(isDeniedIpv4("100.100.0.1")).toBe(true); // mid
    expect(isDeniedIpv4("100.63.0.1")).toBe(false); // just below
    expect(isDeniedIpv4("100.128.0.1")).toBe(false); // just above
    expect(isDeniedIpv4("99.64.0.1")).toBe(false); // a !== 100
  });

  it("a public address matching no rule is allowed (kills the final return true mutant)", () => {
    expect(isDeniedIpv4("8.8.8.8")).toBe(false);
    expect(isDeniedIpv4("1.1.1.1")).toBe(false);
    expect(isDeniedIpv4("203.0.113.7")).toBe(false);
  });
});

describe("isDeniedIpv6 — bracket stripping, fe80::/10 and IPv4-mapped forms", () => {
  it("strips surrounding brackets and the zone id before matching (kills the replace() regexes)", () => {
    expect(isDeniedIpv6("[::1]")).toBe(true); // brackets stripped → ::1 loopback
    expect(isDeniedIpv6("[fe80::1%eth0]")).toBe(true); // brackets + zone id stripped
    expect(isDeniedIpv6("::1")).toBe(true); // already bare
    expect(isDeniedIpv6("fe80::1%25eth0")).toBe(true); // zone split on %
  });

  it("denies the unspecified and loopback addresses", () => {
    expect(isDeniedIpv6("::")).toBe(true);
    expect(isDeniedIpv6("::1")).toBe(true);
  });

  it("denies the whole fe80::/10 link-local block, not just the fe80 literal", () => {
    expect(isDeniedIpv6("fe80::1")).toBe(true); // bottom of range
    expect(isDeniedIpv6("fe90::1")).toBe(true); // inside range, outside fe80 literal
    expect(isDeniedIpv6("fea0::1")).toBe(true);
    expect(isDeniedIpv6("febf::1")).toBe(true); // top of range
    expect(isDeniedIpv6("fe7f::1")).toBe(false); // just below the range
    expect(isDeniedIpv6("fec0::1")).toBe(false); // just above the range
  });

  it("denies fc00::/7 unique-local (fc and fd prefixes)", () => {
    expect(isDeniedIpv6("fc00::1")).toBe(true);
    expect(isDeniedIpv6("fd12:3456::1")).toBe(true);
    expect(isDeniedIpv6("fe00::1")).toBe(false); // neither fc/fd nor in fe80::/10
  });

  it("denies IPv4-mapped metadata in BOTH dotted and compressed hex forms (kills the ::ffff: parsing)", () => {
    // Dotted-quad tail → the `tail.includes(".")` branch.
    expect(isDeniedIpv6("::ffff:169.254.169.254")).toBe(true);
    expect(isDeniedIpv6("::ffff:10.0.0.1")).toBe(true);
    // Two-hex-group tail → the else branch that rebuilds the dotted quad.
    // a9fe:a9fe == 169.254.169.254; 0a00:0001 == 10.0.0.1.
    expect(isDeniedIpv6("::ffff:a9fe:a9fe")).toBe(true);
    expect(isDeniedIpv6("::ffff:0a00:0001")).toBe(true);
    // A mapped PUBLIC address is allowed — proves the rebuild feeds the v4 rules
    // rather than denying every ::ffff: address (kills the force-true mutants).
    expect(isDeniedIpv6("::ffff:8.8.8.8")).toBe(false);
    expect(isDeniedIpv6("::ffff:0808:0808")).toBe(false); // 8.8.8.8 in hex
  });

  it("a public IPv6 address is allowed (kills the final return true mutant)", () => {
    expect(isDeniedIpv6("2001:4860:4860::8888")).toBe(false); // Google DNS v6
    expect(isDeniedIpv6("2606:4700:4700::1111")).toBe(false); // Cloudflare v6
  });
});

describe("isDeniedHost — dispatch between name, IPv6 and IPv4", () => {
  it("denies localhost and its subdomains, case-insensitively", () => {
    expect(isDeniedHost("localhost")).toBe(true);
    expect(isDeniedHost("LOCALHOST")).toBe(true);
    expect(isDeniedHost("api.localhost")).toBe(true);
    expect(isDeniedHost("notlocalhost")).toBe(false); // does not end in .localhost and isn't localhost
    expect(isDeniedHost("localhost.example.com")).toBe(false); // a real public host
  });

  it("routes bracketless colon-bearing hosts to the IPv6 guard and the rest to IPv4", () => {
    expect(isDeniedHost("fe80::1")).toBe(true); // has a colon → v6 path
    expect(isDeniedHost("::ffff:169.254.169.254")).toBe(true);
    expect(isDeniedHost("10.0.0.1")).toBe(true); // no colon → v4 path
    expect(isDeniedHost("example.com")).toBe(false);
    expect(isDeniedHost("8.8.8.8")).toBe(false);
  });
});


/* #895: the last SSRF-guard mutants, pinned so http-url.ts has zero unjustified
   survivors. These exercise the bracket-strip anchors, the ::ffff: prefix
   anchor and the hex-group reconstruction guards directly, and the HttpUrl
   scheme regex and its three product-copy messages. */
describe("isDeniedIpv6 — guard-clause edges (kills the remaining logic mutants)", () => {
  it("only strips a bracket at the host boundary, not one in the middle (kills the ^/$ anchor drops on the replace)", () => {
    // A string with brackets in the WRONG places: with the anchors, nothing is
    // stripped and it is not a recognised address → false. Drop either anchor
    // and the brackets are stripped anywhere, exposing "::1" → would deny.
    expect(isDeniedIpv6("]::1[")).toBe(false);
  });

  it("recognises the ::ffff: prefix only at the START of the host (kills the ^ anchor drop on the match)", () => {
    // Prefixed with junk: the anchored regex does not match, so the mapped-v4
    // path is skipped and the address is not denied. Drop the ^ and it matches
    // mid-string, reconstructs the metadata v4 and would deny a non-mapped host.
    expect(isDeniedIpv6("x::ffff:169.254.169.254")).toBe(false);
  });

  it("only reconstructs a two-group hex tail (kills groups.length === 2 → true)", () => {
    // Three groups is not the ::ffff:hi:lo shape; forcing the branch true would
    // take the first two groups (a9fe:a9fe = 169.254.169.254) and deny it.
    expect(isDeniedIpv6("::ffff:a9fe:a9fe:0")).toBe(false);
  });

  it("requires BOTH hex groups to parse as integers (kills the && → || and the forced-true)", () => {
    // One valid group, one unparseable: with && the branch is skipped → false.
    // With || (or forcing the condition true), NaN >> 8 === 0 rebuilds
    // 169.254.0.0 and would wrongly deny it.
    expect(isDeniedIpv6("::ffff:a9fe:zzzz")).toBe(false);
    expect(isDeniedIpv6("::ffff:zzzz:a9fe")).toBe(false);
    // the genuinely-mapped metadata address in hex form is still denied
    expect(isDeniedIpv6("::ffff:a9fe:a9fe")).toBe(true);
  });
});

describe("HttpUrl — scheme regex anchors and the three guard messages", () => {
  it("anchors the http(s) scheme at both ends (kills /^https?/ and /https?$/)", () => {
    // Dropping the $ anchor would accept a scheme that merely STARTS with http(s);
    // dropping the ^ would accept one that merely ENDS with it.
    expect(HttpUrl.safeParse("httpsx://example.com").success).toBe(false); // trailing junk → needs $
    expect(HttpUrl.safeParse("xhttps://example.com").success).toBe(false); // leading junk → needs ^
    expect(HttpUrl.safeParse("https://example.com").success).toBe(true);
  });

  it("surfaces the length, control-character and credential messages (kills the {error} → {} object mutants)", () => {
    const msg = (v: string) => {
      const r = HttpUrl.safeParse(v);
      return r.success ? null : r.error.issues[0]?.message;
    };
    const longValid = "https://example.com/" + "a".repeat(2049 - 20);
    expect(longValid).toHaveLength(2049);
    expect(msg(longValid)).toBe("Keep it under 2048 characters");
    expect(msg("https://example.com/\u0000")).toBe("That URL contains a control character");
    expect(msg("https://user:pass@example.com/")).toBe("A URL can't include a username or password");
  });
});
