import { describe, expect, it } from "vitest";
import { emailDomain, isDisposableEmail } from "./disposable-email.js";
import { VENDORED_DISPOSABLE_EMAIL_DOMAINS } from "./disposable-email-domains.js";

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
});
