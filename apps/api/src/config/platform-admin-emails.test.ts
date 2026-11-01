import { describe, expect, it } from "vitest";
import { platformAdminEmails } from "./env.js";

/* #968 — PLATFORM_ADMIN_EMAILS parsing. The guard compares against the set this
   produces, so its normalisation (lower-case, trimmed, blanks dropped) is the
   difference between an admin being recognised and silently locked out. */
describe("platformAdminEmails", () => {
  it("returns an empty set for an absent value — the no-admins default", () => {
    expect(platformAdminEmails(undefined).size).toBe(0);
  });

  it("returns an empty set for an all-whitespace / all-comma value", () => {
    expect(platformAdminEmails("  ").size).toBe(0);
    expect(platformAdminEmails(" , , ").size).toBe(0);
  });

  it("splits on commas, trims surrounding whitespace, and drops blanks", () => {
    const set = platformAdminEmails(" a@example.com , ,b@example.com ,");
    expect([...set].sort()).toEqual(["a@example.com", "b@example.com"]);
  });

  it("lower-cases every entry so the match is case-insensitive", () => {
    const set = platformAdminEmails("Admin@Example.COM");
    expect(set.has("admin@example.com")).toBe(true);
    expect(set.has("Admin@Example.COM")).toBe(false);
  });

  it("de-duplicates entries that differ only in case", () => {
    expect(platformAdminEmails("a@x.com,A@X.COM").size).toBe(1);
  });
});
