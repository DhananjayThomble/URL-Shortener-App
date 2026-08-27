import { describe, expect, it } from "vitest";
import { REDIRECT_STATUS, buildDestination, cacheHeadersFor, deriveStatus } from "./destination.js";
import { isBot, parseBrowser, parseDevice, parseLanguage, parseReferrerHost, visitorHash } from "./visitor.js";
import { RESERVED_SLUGS, generateSlug, isSlugAvailableShape } from "./slug.js";

describe("buildDestination", () => {
  it("returns the destination untouched when there is nothing to add", () => {
    expect(buildDestination({ destination: "https://acme.com/x", forwardQuery: true })).toBe("https://acme.com/x");
  });

  it("forwards the incoming query string", () => {
    const out = buildDestination({
      destination: "https://acme.com/x",
      incomingQuery: "ref=twitter&id=7",
      forwardQuery: true,
    });
    expect(out).toContain("ref=twitter");
    expect(out).toContain("id=7");
  });

  it("drops the query when forwarding is off", () => {
    expect(buildDestination({ destination: "https://acme.com/x", incomingQuery: "ref=twitter", forwardQuery: false }))
      .toBe("https://acme.com/x");
  });

  it("never forwards the unlock token to the destination", () => {
    const out = buildDestination({
      destination: "https://acme.com/x",
      incomingQuery: "k=secret-unlock-token&keep=1",
      forwardQuery: true,
    });
    expect(out).not.toContain("secret-unlock-token");
    expect(out).toContain("keep=1");
  });

  it("appends the link's stored UTM values", () => {
    const out = buildDestination({
      destination: "https://acme.com/x",
      forwardQuery: true,
      utm: { source: "newsletter", campaign: "spring" },
    });
    expect(out).toContain("utm_source=newsletter");
    expect(out).toContain("utm_campaign=spring");
  });

  it("lets a click-time UTM override the stored one", () => {
    // Someone appending ?utm_source=x is making a decision at click time.
    // Silently overwriting it would make campaign attribution lie.
    const out = buildDestination({
      destination: "https://acme.com/x",
      incomingQuery: "utm_source=twitter",
      forwardQuery: true,
      utm: { source: "newsletter" },
    });
    expect(out).toContain("utm_source=twitter");
    expect(out).not.toContain("newsletter");
  });

  it("preserves a query string the destination already had", () => {
    const out = buildDestination({ destination: "https://acme.com/x?existing=1", forwardQuery: true });
    expect(out).toContain("existing=1");
  });

  it("does not throw on a malformed stored destination", () => {
    expect(buildDestination({ destination: "not a url", forwardQuery: true })).toBe("not a url");
  });
});

describe("deriveStatus", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("reports archived above everything else", () => {
    expect(deriveStatus({ archivedAt: now, expiresAt: null }, now)).toBe("archived");
  });

  it("reports active with no expiry", () => {
    expect(deriveStatus({ expiresAt: null }, now)).toBe("active");
  });

  it("reports expired once the date has passed", () => {
    expect(deriveStatus({ expiresAt: "2026-06-14T12:00:00Z" }, now)).toBe("expired");
  });

  it("reports expiring inside the seven-day window", () => {
    expect(deriveStatus({ expiresAt: "2026-06-19T12:00:00Z" }, now)).toBe("expiring");
  });

  it("reports active outside the seven-day window", () => {
    expect(deriveStatus({ expiresAt: "2026-07-30T12:00:00Z" }, now)).toBe("active");
  });

  it("reports expired when the click limit is reached", () => {
    expect(deriveStatus({ clickLimit: 500, clicks: 500 }, now)).toBe("expired");
  });

  it("stays active below the click limit", () => {
    expect(deriveStatus({ clickLimit: 500, clicks: 499 }, now)).toBe("active");
  });
});

describe("cacheHeadersFor", () => {
  /* The product promises "print it once, change where it points forever".
     A browser-cached 301 breaks that promise for everyone who already clicked. */
  it("tells browsers never to cache a 302", () => {
    expect(cacheHeadersFor("302")["Cache-Control"]).toContain("no-store");
  });

  it("caps a 301 at five minutes rather than honouring it forever", () => {
    expect(cacheHeadersFor("301")["Cache-Control"]).toContain("max-age=300");
  });

  it("maps each redirect type to its status code", () => {
    expect(REDIRECT_STATUS).toEqual({ "301": 301, "302": 302, "307": 307 });
  });
});

describe("visitor identity", () => {
  const base = { dailySalt: "salt-of-the-day", ip: "203.0.113.9", userAgent: "Mozilla/5.0", linkId: "link-1" };

  it("is stable for the same visitor, link and day", () => {
    expect(visitorHash(base)).toBe(visitorHash({ ...base }));
  });

  it("changes when the salt rotates, so yesterday cannot be recomputed", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, dailySalt: "tomorrows-salt" }));
  });

  it("differs per link, so behaviour cannot be joined across a workspace", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, linkId: "link-2" }));
  });

  it("changes with the IP", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, ip: "198.51.100.4" }));
  });

  it("never contains the raw IP", () => {
    expect(visitorHash(base)).not.toContain("203.0.113.9");
  });
});

describe("user-agent parsing", () => {
  it("identifies iPhones as ios", () => {
    expect(parseDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
  });

  it("identifies desktops", () => {
    expect(parseDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("desktop");
  });

  it("picks the in-app browser over the Safari it claims to be", () => {
    expect(parseBrowser("Mozilla/5.0 (iPhone) AppleWebKit Safari Instagram 300.0")).toBe("Instagram in-app");
  });

  it("does not report Edge as Chrome", () => {
    expect(parseBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120")).toBe("Edge");
  });

  it("catches obvious crawlers", () => {
    expect(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("")).toBe(true);
  });

  it("does not flag a real browser as a bot", () => {
    expect(isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36")).toBe(false);
  });

  it("reduces Accept-Language to a primary subtag", () => {
    expect(parseLanguage("en-GB,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(parseLanguage(undefined)).toBeNull();
  });

  it("reports referrers by host only, never by path", () => {
    expect(parseReferrerHost("https://www.google.com/search?q=private+thing")).toBe("google.com");
    expect(parseReferrerHost("not a url")).toBeNull();
  });
});

describe("slugs", () => {
  it("generates slugs with no look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateSlug()).not.toMatch(/[0O1lI]/);
    }
  });

  it("generates the requested length", () => {
    expect(generateSlug(12)).toHaveLength(12);
  });

  it("rejects the public preview route, which would shadow the trust page", () => {
    expect(isSlugAvailableShape("p").ok).toBe(false);
    expect(RESERVED_SLUGS.has("p")).toBe(true);
  });

  it("rejects dashboard routes so a link cannot shadow the app", () => {
    expect(isSlugAvailableShape("login").ok).toBe(false);
    expect(isSlugAvailableShape("settings").ok).toBe(false);
  });

  it("rejects anything that would be fetched rather than followed", () => {
    expect(isSlugAvailableShape("report.html").ok).toBe(false);
  });

  it("rejects characters that would need escaping in a URL", () => {
    expect(isSlugAvailableShape("hello world").ok).toBe(false);
    expect(isSlugAvailableShape("a/b").ok).toBe(false);
  });

  it("accepts an ordinary custom back-half", () => {
    expect(isSlugAvailableShape("spring-sale_2026.v2").ok).toBe(true);
  });

  it("explains itself when it says no", () => {
    expect(isSlugAvailableShape("login").reason).toContain("reserved");
  });
});
