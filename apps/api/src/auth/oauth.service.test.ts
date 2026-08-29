import { describe, expect, it } from "vitest";
import { readKid, toProfile } from "./oauth.service.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("readKid", () => {
  it("reads the key id from the header without trusting the rest", () => {
    expect(readKid(`${b64({ alg: "RS256", kid: "abc" })}.x.y`)).toBe("abc");
  });

  it("returns null for a header with no kid", () => {
    expect(readKid(`${b64({ alg: "RS256" })}.x.y`)).toBeNull();
  });

  it("returns null for a non-string kid rather than coercing it", () => {
    expect(readKid(`${b64({ kid: 42 })}.x.y`)).toBeNull();
  });

  it("returns null rather than throwing on garbage", () => {
    expect(readKid("not-a-jwt")).toBeNull();
    expect(readKid("")).toBeNull();
    expect(readKid("!!!.x.y")).toBeNull();
  });
});

describe("toProfile", () => {
  const base = { sub: "1234", email: "Person@Example.com", email_verified: true };

  it("takes the subject and lowercases the email", () => {
    const p = toProfile(base)!;
    expect(p.subject).toBe("1234");
    expect(p.email).toBe("person@example.com");
    expect(p.emailVerified).toBe(true);
  });

  it("accepts Apple's string \"true\" as verified", () => {
    // Google sends a boolean, Apple has sent the string. Both mean verified.
    expect(toProfile({ ...base, email_verified: "true" })!.emailVerified).toBe(true);
  });

  it("treats the string \"false\" as NOT verified", () => {
    // The bug this exists to prevent: a bare truthiness check reads "false"
    // as true, and account linking is gated on this exact field.
    expect(toProfile({ ...base, email_verified: "false" })!.emailVerified).toBe(false);
  });

  it("treats anything else as not verified", () => {
    for (const value of [undefined, null, 0, 1, "yes", {}]) {
      expect(toProfile({ ...base, email_verified: value })!.emailVerified).toBe(false);
    }
  });

  it("refuses a token with no subject", () => {
    expect(toProfile({ email: "a@b.com", email_verified: true })).toBeNull();
  });

  it("refuses a token with no email", () => {
    expect(toProfile({ sub: "1234", email_verified: true })).toBeNull();
  });

  it("refuses non-string claims rather than coercing them", () => {
    expect(toProfile({ sub: 1234, email: "a@b.com" })).toBeNull();
    expect(toProfile({ sub: "1234", email: { toString: () => "a@b.com" } })).toBeNull();
  });

  it("returns a null name rather than an empty one", () => {
    expect(toProfile({ ...base, name: "   " })!.name).toBeNull();
    expect(toProfile(base)!.name).toBeNull();
    expect(toProfile({ ...base, name: " Ada " })!.name).toBe("Ada");
  });
});
