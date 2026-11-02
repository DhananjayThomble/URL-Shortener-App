import { describe, expect, it } from "vitest";
import { emailDomain, hostCoveredByAny, isDisposableEmail } from "./disposable-email.js";
import { VENDORED_DISPOSABLE_EMAIL_DOMAINS } from "./disposable-email-domains.js";
import { DISPOSABLE_EMAIL_ALLOWLIST } from "./disposable-email-allowlist.js";

/* #993 — the disposable-email matcher. The domain list is assembled by the
   caller (vendored list + admin additions); these pin the split and the
   coverage rule directly. */

describe("emailDomain", () => {
  it("lower-cases and trims the domain part", () => {
    expect(emailDomain("Alice@Example.COM ")).toBe("example.com");
  });

  it("splits on the LAST @ so a quoted local-part with an @ still yields the host", () => {
    expect(emailDomain('"weird@local"@mailinator.com')).toBe("mailinator.com");
  });

  it("returns '' for an address with no @, a leading @, or a trailing @", () => {
    expect(emailDomain("not-an-email")).toBe("");
    expect(emailDomain("@nolocal.com")).toBe("");
    expect(emailDomain("nodomain@")).toBe("");
    expect(emailDomain("")).toBe("");
  });
});

describe("isDisposableEmail", () => {
  const list = ["mailinator.com", "yopmail.com"];

  it("refuses an exact domain match, case-insensitively", () => {
    expect(isDisposableEmail("spammer@mailinator.com", list)).toBe(true);
    expect(isDisposableEmail("Spammer@MAILINATOR.com", list)).toBe(true);
  });

  it("refuses a sub-domain of a listed domain (providers hand out throwaway sub-domains)", () => {
    expect(isDisposableEmail("x@inbox.mailinator.com", list)).toBe(true);
  });

  it("does NOT refuse a different name that merely ends with the text", () => {
    expect(isDisposableEmail("x@notmailinator.com", list)).toBe(false);
    expect(isDisposableEmail("x@mailinator.com.evil.test", list)).toBe(false);
  });

  it("allows a normal address", () => {
    expect(isDisposableEmail("alice@gmail.com", list)).toBe(false);
    expect(isDisposableEmail("alice@company.co", list)).toBe(false);
  });

  it("never treats an address with no usable domain as disposable", () => {
    expect(isDisposableEmail("garbage", list)).toBe(false);
    expect(isDisposableEmail("@nolocal.com", list)).toBe(false);
  });

  it("matches against the vendored list too", () => {
    expect(isDisposableEmail("a@10minutemail.com", VENDORED_DISPOSABLE_EMAIL_DOMAINS)).toBe(true);
    expect(isDisposableEmail("a@guerrillamail.com", VENDORED_DISPOSABLE_EMAIL_DOMAINS)).toBe(true);
    expect(isDisposableEmail("a@real-company.com", VENDORED_DISPOSABLE_EMAIL_DOMAINS)).toBe(false);
  });
});

describe("VENDORED_DISPOSABLE_EMAIL_DOMAINS", () => {
  it("is a non-empty list of bare, lower-cased hosts with no duplicates", () => {
    expect(VENDORED_DISPOSABLE_EMAIL_DOMAINS.length).toBeGreaterThan(0);
    for (const d of VENDORED_DISPOSABLE_EMAIL_DOMAINS) {
      expect(d).toBe(d.toLowerCase());
      expect(d).not.toMatch(/[\s/@:]/);
      expect(d.includes("://")).toBe(false);
    }
    expect(new Set(VENDORED_DISPOSABLE_EMAIL_DOMAINS).size).toBe(VENDORED_DISPOSABLE_EMAIL_DOMAINS.length);
  });

  it("#1007 — is the FULL upstream snapshot, not the old 65-domain subset", () => {
    // The vendored list is now the ~10k upstream list. Guard against a silent
    // regression back to the hand-picked subset.
    expect(VENDORED_DISPOSABLE_EMAIL_DOMAINS.length).toBeGreaterThan(5_000);
  });

  it("#1007 — still catches the well-known throwaway providers", () => {
    for (const d of ["mailinator.com", "10minutemail.com", "guerrillamail.com", "yopmail.com"]) {
      expect(isDisposableEmail(`a@${d}`, VENDORED_DISPOSABLE_EMAIL_DOMAINS)).toBe(true);
    }
  });
});

/* #1007 — the built-in allow list and the allow-beats-block rule. */

describe("DISPOSABLE_EMAIL_ALLOWLIST", () => {
  it("is a non-empty list of bare, lower-cased hosts with no duplicates", () => {
    expect(DISPOSABLE_EMAIL_ALLOWLIST.length).toBeGreaterThan(0);
    for (const d of DISPOSABLE_EMAIL_ALLOWLIST) {
      expect(d).toBe(d.toLowerCase());
      expect(d).not.toMatch(/[\s/@:]/);
    }
    expect(new Set(DISPOSABLE_EMAIL_ALLOWLIST).size).toBe(DISPOSABLE_EMAIL_ALLOWLIST.length);
  });

  it("covers the major providers the issue names", () => {
    for (const d of ["gmail.com", "outlook.com", "hotmail.com", "proton.me", "icloud.com", "yahoo.com"]) {
      expect(DISPOSABLE_EMAIL_ALLOWLIST).toContain(d);
    }
  });

  it("covers the privacy relays the issue names", () => {
    for (const d of ["privaterelay.appleid.com", "duck.com", "mozmail.com"]) {
      expect(DISPOSABLE_EMAIL_ALLOWLIST).toContain(d);
    }
  });

  it("is DISJOINT from the vendored block list — no allow-listed domain is ever vendored as disposable", () => {
    // This is the load-bearing safety invariant (#1007 acceptance): a build
    // that ever vendored a major provider into the block list fails here. The
    // check is by coverage, not equality, so a block entry that is the allow
    // entry OR a sub-domain of it is caught too.
    const vendored = new Set(VENDORED_DISPOSABLE_EMAIL_DOMAINS);
    const offenders = [...vendored].filter((b) => hostCoveredByAny(b, DISPOSABLE_EMAIL_ALLOWLIST));
    expect(offenders).toEqual([]);
  });
});

describe("isDisposableEmail — allow beats block (#1007)", () => {
  const block = ["mailinator.com", "proton.me", "shared.test"];
  const allow = ["proton.me", "shared.test"];

  it("never refuses an allow-listed domain, even when it is ALSO on the block list", () => {
    expect(isDisposableEmail("a@proton.me", block, allow)).toBe(false);
    expect(isDisposableEmail("a@shared.test", block, allow)).toBe(false);
  });

  it("never refuses a sub-domain of an allow-listed domain", () => {
    expect(isDisposableEmail("a@pm.proton.me", block, allow)).toBe(false);
  });

  it("still refuses a block-listed domain that is NOT allow-listed", () => {
    expect(isDisposableEmail("a@mailinator.com", block, allow)).toBe(true);
  });

  it("with no allow list given, behaves exactly like the two-argument block-only check", () => {
    expect(isDisposableEmail("a@proton.me", block)).toBe(true);
    expect(isDisposableEmail("a@mailinator.com", block)).toBe(true);
    expect(isDisposableEmail("a@real.test", block)).toBe(false);
  });

  it("the built-in allow list protects a real provider even if the vendored list somehow listed it", () => {
    // Simulate a future upstream refresh wrongly adding gmail.com to the block
    // list: the built-in allow list must still let it through.
    const polluted = [...VENDORED_DISPOSABLE_EMAIL_DOMAINS, "gmail.com"];
    expect(isDisposableEmail("alice@gmail.com", polluted, DISPOSABLE_EMAIL_ALLOWLIST)).toBe(false);
  });
});

describe("hostCoveredByAny (#1007)", () => {
  it("matches an exact host and a sub-domain, case-insensitively", () => {
    expect(hostCoveredByAny("proton.me", ["proton.me"])).toBe(true);
    expect(hostCoveredByAny("pm.proton.me", ["proton.me"])).toBe(true);
    expect(hostCoveredByAny("PROTON.ME", ["proton.me"])).toBe(true);
  });

  it("does not match a different name that merely ends with the text", () => {
    expect(hostCoveredByAny("notproton.me", ["proton.me"])).toBe(false);
  });

  it("an empty list never matches", () => {
    expect(hostCoveredByAny("proton.me", [])).toBe(false);
  });
});
