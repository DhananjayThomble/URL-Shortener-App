import { describe, expect, it } from "vitest";
import {
  generateDailySalt,
  isBot,
  parseBrowser,
  parseDevice,
  parseLanguage,
  parseOs,
  parseReferrerHost,
  saltDateKey,
  visitorHash,
} from "./visitor.js";

/* #894 — mutation testing. visitor.ts carries the cookieless-identity and
   User-Agent classification logic. destination.test.ts exercises a handful of
   cases; this file pins the full behaviour so the branches survive no mutant.
   Every claim here is a product promise (no raw IP in the hash, daily/link
   scoping, the four device buckets, the bot list) or a documented edge. */

const base = {
  dailySalt: "2026-10-30-salt",
  ip: "203.0.113.9",
  userAgent: "Mozilla/5.0",
  linkId: "link-1",
};

describe("visitorHash", () => {
  it("is deterministic for identical input", () => {
    expect(visitorHash(base)).toBe(visitorHash({ ...base }));
  });

  it("is 32 lowercase hex characters (128 bits)", () => {
    expect(visitorHash(base)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("never contains the raw IP", () => {
    expect(visitorHash(base)).not.toContain("203.0.113.9");
  });

  it("changes with the daily salt, the link id, the ip and the user agent", () => {
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, dailySalt: "2026-10-31-salt" }));
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, linkId: "link-2" }));
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, ip: "198.51.100.4" }));
    expect(visitorHash(base)).not.toBe(visitorHash({ ...base, userAgent: "curl/8" }));
  });

  it("separates the fields so re-splitting the boundary changes the hash", () => {
    // Without the space separators between ip, userAgent and linkId, these two
    // would hash identically ("ab"+""+"c" vs "a"+"bc"+""). The separators
    // (visitor.ts L42/L44) are what prevent the field-boundary collision.
    const a = visitorHash({ dailySalt: "s", ip: "ab", userAgent: "c", linkId: "d" });
    const b = visitorHash({ dailySalt: "s", ip: "a", userAgent: "bc", linkId: "d" });
    expect(a).not.toBe(b);
    const c = visitorHash({ dailySalt: "s", ip: "a", userAgent: "b", linkId: "cd" });
    const d = visitorHash({ dailySalt: "s", ip: "a", userAgent: "bc", linkId: "d" });
    expect(c).not.toBe(d);
  });

  it("depends on the salt as the HMAC key, not just the message", () => {
    // Swapping the salt with identical message must change the digest, proving
    // the salt is the HMAC key (kills the createHmac method-chain mutant).
    expect(visitorHash({ dailySalt: "k1", ip: "i", userAgent: "u", linkId: "l" })).not.toBe(
      visitorHash({ dailySalt: "k2", ip: "i", userAgent: "u", linkId: "l" }),
    );
  });
});

describe("saltDateKey", () => {
  it("is the UTC yyyy-mm-dd prefix of the given instant", () => {
    expect(saltDateKey(new Date("2026-10-30T23:59:59.000Z"))).toBe("2026-10-30");
    // 00:30 at +05:30 is still the previous UTC day — proves it is UTC, not local.
    expect(saltDateKey(new Date("2026-10-31T00:30:00+05:30"))).toBe("2026-10-30");
  });

  it("returns a 10-character date with no time component", () => {
    expect(saltDateKey(new Date("2026-01-02T12:00:00Z"))).toBe("2026-01-02");
    expect(saltDateKey(new Date("2026-01-02T12:00:00Z"))).toHaveLength(10);
  });

  it("uses now() by default and yields a well-formed key", () => {
    expect(saltDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("generateDailySalt", () => {
  it("produces 64 hex chars (32 random bytes) and differs each call", () => {
    const a = generateDailySalt();
    const b = generateDailySalt();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("parseDevice — four buckets", () => {
  it.each<[string, string]>([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "ios"],
    ["Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)", "ios"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "ios"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile)", "android"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel Tablet)", "android"],
    ["Mozilla/5.0 (Windows Phone 10.0)", "mobile"],
    ["BlackBerry9700/5.0", "mobile"],
    ["Opera/9.80 (J2ME; Opera Mini/9)", "mobile"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "desktop"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "desktop"],
    ["", "desktop"],
  ])("%s -> %s", (ua, expected) => {
    expect(parseDevice(ua)).toBe(expected);
  });

  it("is case-insensitive (lower-cases the UA first)", () => {
    expect(parseDevice("IPHONE")).toBe("ios");
    expect(parseDevice("ANDROID MOBILE")).toBe("android");
  });

  it("classifies a bare Android (no 'mobile') as android, not desktop", () => {
    // Both arms of the Android ternary return "android"; this pins that a
    // non-mobile Android is still "android" and never falls through to mobile.
    expect(parseDevice("Mozilla/5.0 (Linux; Android 14)")).toBe("android");
  });
});

describe("parseBrowser — in-app and real browsers, order matters", () => {
  it.each<[string, string]>([
    ["Mozilla/5.0 Instagram 300.0", "Instagram in-app"],
    ["Mozilla/5.0 [FBAN/FBIOS;FBAV/450]", "Facebook in-app"],
    ["Mozilla/5.0 Line/13.0.0", "LINE in-app"],
    ["Mozilla/5.0 (Windows) Edg/120.0", "Edge"],
    ["Mozilla/5.0 (Android) EdgA/120.0", "Edge"],
    ["Mozilla/5.0 OPR/105.0", "Opera"],
    ["Opera/9.80", "Opera"],
    ["Mozilla/5.0 SamsungBrowser/23.0", "Samsung Internet"],
    ["Mozilla/5.0 Firefox/121.0", "Firefox"],
    ["Mozilla/5.0 Chrome/120.0 Safari/537.36", "Chrome"],
    ["Mozilla/5.0 (Macintosh) Version/17.0 Safari/605.1.15", "Safari"],
    ["some random string", "Other"],
    ["", "Other"],
  ])("%s -> %s", (ua, expected) => {
    expect(parseBrowser(ua)).toBe(expected);
  });

  it("prefers the in-app wrapper over the Chrome/Safari it also claims", () => {
    // Instagram's UA also contains 'Chrome' — order must put Instagram first.
    expect(parseBrowser("Mozilla/5.0 Chrome/120 Instagram 300")).toBe("Instagram in-app");
    // Edge's UA contains 'Chrome' and 'Safari' — Edge must win.
    expect(parseBrowser("Mozilla/5.0 Chrome/120 Safari/537 Edg/120")).toBe("Edge");
  });
});

describe("parseOs", () => {
  it.each<[string, string]>([
    ["Mozilla/5.0 (Windows NT 10.0)", "Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "iOS"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0)", "iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS"],
    ["Mozilla/5.0 (Linux; Android 14)", "Android"],
    ["Mozilla/5.0 (X11; CrOS x86_64)", "ChromeOS"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Linux"],
    ["something else", "Other"],
    ["", "Other"],
  ])("%s -> %s", (ua, expected) => {
    expect(parseOs(ua)).toBe(expected);
  });

  it("puts iOS before macOS (both match 'Mac') and Android before Linux", () => {
    expect(parseOs("iPhone; Mac OS X")).toBe("iOS");
    expect(parseOs("Linux; Android 14")).toBe("Android");
  });
});

describe("isBot", () => {
  it("treats an empty UA as a bot (no UA is not a browser)", () => {
    expect(isBot("")).toBe(true);
  });

  it.each([
    "Googlebot/2.1",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "curl/8.4.0",
    "python-requests/2.31",
    "node axios/1.6",
    "HeadlessChrome/120",
    "facebookexternalhit/1.1",
    "WhatsApp/2.23",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0",
    "Lighthouse",
  ])("flags %s as a bot", (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each([
    "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36",
    "Mozilla/5.0 (iPhone) Version/17 Safari/605",
  ])("does not flag a real browser %s", (ua) => {
    expect(isBot(ua)).toBe(false);
  });
});

describe("parseLanguage — primary subtag only", () => {
  it.each<[string | null | undefined, string | null]>([
    ["en-GB,en;q=0.9,fr;q=0.8", "en"],
    ["fr", "fr"],
    ["EN-US", "en"],
    ["de-DE;q=1.0", "de"],
    ["eng-GB", "eng"],
    [undefined, null],
    [null, null],
    ["", null],
    ["   ", null],
    [",en", null],
    ["123", null],
    ["x", null],
    ["toolong", null],
  ])("%s -> %s", (header, expected) => {
    expect(parseLanguage(header)).toBe(expected);
  });

  it("lower-cases the subtag and keeps a 2- or 3-letter tag only", () => {
    expect(parseLanguage("PT-BR")).toBe("pt");
    // 4+ letters is not a valid primary subtag.
    expect(parseLanguage("abcd-x")).toBeNull();
  });

  it("trims whitespace around the first language before parsing", () => {
    // A spaced header must still resolve — kills the `.trim()` drop on the
    // first segment. Without the trim, " en " fails the subtag regex -> null.
    expect(parseLanguage("  en  , fr")).toBe("en");
    expect(parseLanguage("\tde-DE")).toBe("de");
  });

  it("strips the q-weight on a tag that has no region subtag", () => {
    // "en;q=0.9" has a ";" but no "-"; dropping the `.split(";")` would leave
    // "en;q=0.9", which fails the subtag regex -> null. Pins the ";" split.
    expect(parseLanguage("en;q=0.9")).toBe("en");
    expect(parseLanguage("fr;q=0.8,en")).toBe("fr");
  });

  it("takes only the FIRST language from a comma list (no region, no q-weight)", () => {
    // "en,fr" has a "," but no ";" or "-"; dropping the `.split(",")` would
    // leave "en,fr", which fails the 2-3 letter subtag regex -> null. Pins the
    // "," split on a value the ";" and "-" splits can't rescue.
    expect(parseLanguage("en,fr")).toBe("en");
    expect(parseLanguage("de,en-GB")).toBe("de");
  });
});

describe("parseReferrerHost — host only, www stripped", () => {
  it.each<[string | null | undefined, string | null]>([
    ["https://www.google.com/search?q=private+thing", "google.com"],
    ["https://news.ycombinator.com/item?id=1", "news.ycombinator.com"],
    ["https://WWW.Example.COM/path", "example.com"],
    ["not a url", null],
    [undefined, null],
    [null, null],
    ["", null],
  ])("%s -> %s", (ref, expected) => {
    expect(parseReferrerHost(ref)).toBe(expected);
  });

  it("strips only a leading www. (not an interior one)", () => {
    expect(parseReferrerHost("https://wwwx.example.com")).toBe("wwwx.example.com");
    expect(parseReferrerHost("https://www.www.example.com")).toBe("www.example.com");
  });

  it("drops the path and query, which can carry PII", () => {
    expect(parseReferrerHost("https://host.example/u/secret?token=abc")).toBe("host.example");
  });
});
