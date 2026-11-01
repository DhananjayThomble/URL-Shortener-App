import { describe, expect, it } from "vitest";
import { KNOWN_SHORTENER_HOSTS, matchRedirectChain } from "./shortener-chain.js";

const SELF = ["snap.to", "go.acme.example"];

describe("matchRedirectChain — self-referencing loops", () => {
  it("refuses a destination on one of our own short domains", () => {
    expect(matchRedirectChain("https://snap.to/abc", SELF)).toEqual({ kind: "self", host: "snap.to" });
  });
  it("refuses a sub-domain of one of our short domains", () => {
    expect(matchRedirectChain("https://links.snap.to/abc", SELF)).toEqual({ kind: "self", host: "snap.to" });
  });
  it("refuses a connected custom domain too", () => {
    expect(matchRedirectChain("https://go.acme.example/x", SELF)).toEqual({
      kind: "self",
      host: "go.acme.example",
    });
  });
  it("is case-insensitive and ignores a trailing dot", () => {
    expect(matchRedirectChain("https://SNAP.TO./abc", SELF)).toEqual({ kind: "self", host: "snap.to" });
  });
  it("does not match a different name that merely ends with the text", () => {
    expect(matchRedirectChain("https://notsnap.to/abc", SELF)).toBeNull();
  });
  it("does not match when our label is only a prefix of a longer label", () => {
    expect(matchRedirectChain("https://snap.to.evil.test/abc", SELF)).toBeNull();
  });
});

describe("matchRedirectChain — known third-party shorteners", () => {
  it("refuses a bit.ly destination", () => {
    expect(matchRedirectChain("https://bit.ly/xyz", SELF)).toEqual({ kind: "shortener", host: "bit.ly" });
  });
  it("refuses a sub-domain of a known shortener", () => {
    expect(matchRedirectChain("https://custom.t.co/xyz", SELF)).toEqual({ kind: "shortener", host: "t.co" });
  });
  it("accepts a destination on an ordinary domain", () => {
    expect(matchRedirectChain("https://example.com/landing", SELF)).toBeNull();
  });
  it("accepts a bare host that is not a shortener", () => {
    expect(matchRedirectChain("example.org", SELF)).toBeNull();
  });
});

describe("matchRedirectChain — precedence and edge cases", () => {
  it("reports self before shortener when a host is both", () => {
    // A domain we host that is also (improbably) in the shortener list reads as
    // the loop it is, not as a third-party chain.
    expect(matchRedirectChain("https://bit.ly/x", ["bit.ly"])).toEqual({ kind: "self", host: "bit.ly" });
  });
  it("returns null for an empty destination", () => {
    expect(matchRedirectChain("", SELF)).toBeNull();
  });
  it("uses the maintained shortener list by default", () => {
    expect(KNOWN_SHORTENER_HOSTS).toContain("bit.ly");
    expect(KNOWN_SHORTENER_HOSTS).toContain("tinyurl.com");
  });
  it("honours an injected shortener list for tests", () => {
    expect(matchRedirectChain("https://myshort.example/x", [], ["myshort.example"])).toEqual({
      kind: "shortener",
      host: "myshort.example",
    });
    // And bit.ly is NOT refused when the injected list omits it.
    expect(matchRedirectChain("https://bit.ly/x", [], ["myshort.example"])).toBeNull();
  });
});
