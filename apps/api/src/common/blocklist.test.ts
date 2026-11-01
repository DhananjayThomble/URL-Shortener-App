import { describe, expect, it } from "vitest";
import { destinationHost, hostCoveredBy, matchBlockedDomain, normaliseBlockHost } from "./blocklist.js";

describe("normaliseBlockHost", () => {
  it("lower-cases and trims", () => {
    expect(normaliseBlockHost("  EVIL.Test  ")).toBe("evil.test");
  });
  it("drops exactly one trailing dot (the DNS root)", () => {
    expect(normaliseBlockHost("evil.test.")).toBe("evil.test");
    expect(normaliseBlockHost("evil.test..")).toBe("evil.test.");
  });
  it("returns an empty string for whitespace only", () => {
    expect(normaliseBlockHost("   ")).toBe("");
  });
});

describe("destinationHost", () => {
  it("extracts the lower-cased hostname from a full URL without the port", () => {
    expect(destinationHost("https://Login.Evil.test:8443/path?q=1")).toBe("login.evil.test");
  });
  it("ignores URL credentials and path", () => {
    expect(destinationHost("https://user:pass@evil.test/a/b")).toBe("evil.test");
  });
  it("drops a trailing dot in the URL host", () => {
    expect(destinationHost("https://evil.test./x")).toBe("evil.test");
  });
  it("treats an unparseable input as a bare host", () => {
    expect(destinationHost("Evil.Test")).toBe("evil.test");
  });
  it("is empty for empty input", () => {
    expect(destinationHost("")).toBe("");
  });
});

describe("hostCoveredBy", () => {
  it("matches an exact host", () => {
    expect(hostCoveredBy("evil.test", "evil.test")).toBe(true);
  });
  it("matches a sub-domain of the blocked host", () => {
    expect(hostCoveredBy("login.evil.test", "evil.test")).toBe(true);
    expect(hostCoveredBy("a.b.evil.test", "evil.test")).toBe(true);
  });
  it("does NOT match a different name that merely ends with the text", () => {
    expect(hostCoveredBy("notevil.test", "evil.test")).toBe(false);
  });
  it("does NOT match when the blocked label is only a prefix of a longer name", () => {
    expect(hostCoveredBy("evil.test.co", "evil.test")).toBe(false);
  });
  it("is case-insensitive on both sides", () => {
    expect(hostCoveredBy("LOGIN.Evil.TEST", "Evil.Test")).toBe(true);
  });
  it("never matches when either side is empty", () => {
    expect(hostCoveredBy("", "evil.test")).toBe(false);
    expect(hostCoveredBy("evil.test", "")).toBe(false);
    expect(hostCoveredBy("", "")).toBe(false);
  });
});

describe("matchBlockedDomain", () => {
  const list = ["evil.test", "phish.example"];

  it("returns the covering host for an exact destination match", () => {
    expect(matchBlockedDomain("https://evil.test/x", list)).toBe("evil.test");
  });
  it("returns the covering host for a sub-domain destination", () => {
    expect(matchBlockedDomain("https://login.evil.test/signin", list)).toBe("evil.test");
  });
  it("returns null for a destination not on the list", () => {
    expect(matchBlockedDomain("https://good.example/x", list)).toBeNull();
  });
  it("returns null for a lookalike that is not a sub-domain", () => {
    expect(matchBlockedDomain("https://notevil.test/x", list)).toBeNull();
  });
  it("returns the FIRST matching blocked host when several would match", () => {
    expect(matchBlockedDomain("https://evil.test/x", ["a.test", "evil.test", "test"])).toBe("evil.test");
  });
  it("normalises a stored entry before returning it", () => {
    expect(matchBlockedDomain("https://evil.test/x", ["  EVIL.Test.  "])).toBe("evil.test");
  });
  it("matches a bare-host destination", () => {
    expect(matchBlockedDomain("evil.test", list)).toBe("evil.test");
  });
  it("returns null for an empty destination or empty list", () => {
    expect(matchBlockedDomain("", list)).toBeNull();
    expect(matchBlockedDomain("https://evil.test/x", [])).toBeNull();
  });
});
