import { describe, expect, it } from "vitest";
import type { Domain } from "@snapurl/contract";
import { defaultDomainFor, domainOptionLabel, isUsableForLinks } from "./domain-choice";

const d = (domain: string, status: Domain["status"] = "live"): Domain => ({
  id: `id-${domain}`,
  domain,
  status,
  ssl: status === "live" ? "active" : "pending",
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
});

const SHARED = d("snap.example");

describe("defaultDomainFor (#651 — never default to a domain links can't be created on)", () => {
  it("uses the workspace's defaultDomain when it is live", () => {
    const list = [d("a.example"), d("b.example"), SHARED];
    expect(defaultDomainFor(list, "b.example")).toBe("b.example");
  });

  it("matches the workspace default case-insensitively", () => {
    expect(defaultDomainFor([d("a.example"), d("B.Example")], "b.EXAMPLE")).toBe("B.Example");
  });

  it("skips a verifying defaultDomain and takes the first live domain", () => {
    const list = [d("a.example", "verifying"), d("b.example"), SHARED];
    expect(defaultDomainFor(list, "a.example")).toBe("b.example");
  });

  it("skips a failed defaultDomain too", () => {
    expect(defaultDomainFor([d("a.example", "failed"), SHARED], "a.example")).toBe("snap.example");
  });

  it("with only verifying custom domains, falls to the built-in live domain", () => {
    const list = [d("a.example", "verifying"), d("b.example", "verifying"), SHARED];
    expect(defaultDomainFor(list, undefined)).toBe("snap.example");
  });

  it("with no custom domains, uses the built-in one", () => {
    expect(defaultDomainFor([SHARED], "snap.example")).toBe("snap.example");
    expect(defaultDomainFor([SHARED], null)).toBe("snap.example");
  });

  it("mixed order, verifying listed first: first LIVE wins, not index 0", () => {
    const list = [d("v1.example", "verifying"), d("v2.example", "failed"), d("live1.example"), d("live2.example"), SHARED];
    expect(defaultDomainFor(list, "unknown.example")).toBe("live1.example");
    expect(defaultDomainFor(list, "")).toBe("live1.example");
  });

  it("an unknown or empty workspace default falls back to the first live domain", () => {
    expect(defaultDomainFor([d("a.example"), SHARED], "gone.example")).toBe("a.example");
  });

  it("returns '' (never a verifying domain) when nothing is live, or before the list loads", () => {
    expect(defaultDomainFor([d("a.example", "verifying")], "a.example")).toBe("");
    expect(defaultDomainFor([], "a.example")).toBe("");
    expect(defaultDomainFor(undefined, "a.example")).toBe("");
  });
});

describe("isUsableForLinks / domainOptionLabel", () => {
  it("only a live domain can carry links", () => {
    expect(isUsableForLinks(d("a.example"))).toBe(true);
    expect(isUsableForLinks(d("a.example", "verifying"))).toBe(false);
    expect(isUsableForLinks(d("a.example", "failed"))).toBe(false);
  });

  it("marks a domain that is not live, leaves a live one bare", () => {
    expect(domainOptionLabel(d("a.example"))).toBe("a.example");
    expect(domainOptionLabel(d("a.example", "verifying"))).toBe("a.example — verifying");
    expect(domainOptionLabel(d("a.example", "failed"))).toBe("a.example — verification failed");
  });
});
