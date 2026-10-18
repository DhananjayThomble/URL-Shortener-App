import { describe, expect, it } from "vitest";
import type { Domain } from "@snapurl/contract";
import { canDisconnectDomain, domainSslView, domainStatusView } from "./domain-state";

/* Oracle: the Domain contract (packages/contract/src/workspace.ts) and how the
   API fills it (apps/api/src/domains/domains.service.ts toDto):
     - the built-in short domain is created with status "live", ssl "active",
       NO sslRenewsAt, and is exposed as `shared: true`; the API refuses to
       disconnect it (409 "That's a shared SnapURL domain …");
     - a custom domain starts "verifying"/"pending"; the worker moves ssl to
       "active" (with a renewal date) later;
     - status and ssl each have a third value, "failed".
   #782: the page used to print "Pending" for any ssl that was not (active AND
   had a renewal date) — so the shared domain read Status Live / SSL Pending —
   and printed "Verifying DNS" for status "failed". */

const base: Domain = {
  id: "d1",
  domain: "go.acme.test",
  status: "live",
  ssl: "active",
  sslRenewsAt: null,
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
};

describe("canDisconnectDomain", () => {
  it("is false for the shared domain, true for a workspace's own", () => {
    expect(canDisconnectDomain({ ...base, shared: true })).toBe(false);
    expect(canDisconnectDomain(base)).toBe(true);
    expect(canDisconnectDomain({ ...base, shared: false })).toBe(true);
  });
});

describe("domainSslView", () => {
  it("never calls the live shared domain's SSL 'Pending'", () => {
    const v = domainSslView({ ...base, domain: "snap.to", shared: true });
    expect(v.label).not.toMatch(/pending/i);
    expect(v).toEqual({ label: "Managed by SnapURL", tone: "good" });
  });

  it("an active certificate with no renewal date yet is Active, not Pending", () => {
    expect(domainSslView(base)).toEqual({ label: "Active", tone: "good" });
  });

  it("an active certificate with a renewal date shows it", () => {
    const v = domainSslView({ ...base, sslRenewsAt: "2027-01-05T00:00:00.000Z" });
    expect(v.tone).toBe("good");
    expect(v.label).toMatch(/^Auto · renews /);
  });

  it("an unparseable renewal date degrades to Active rather than printing garbage", () => {
    expect(domainSslView({ ...base, sslRenewsAt: "not-a-date" })).toEqual({ label: "Active", tone: "good" });
  });

  it("pending stays Pending (warn)", () => {
    expect(domainSslView({ ...base, status: "verifying", ssl: "pending" })).toEqual({ label: "Pending", tone: "warn" });
  });

  it("failed is Failed (bad), not Pending", () => {
    expect(domainSslView({ ...base, status: "failed", ssl: "failed" })).toEqual({ label: "Failed", tone: "bad" });
  });

  it("the shared domain still tells the truth if its certificate is not active", () => {
    expect(domainSslView({ ...base, shared: true, ssl: "failed" })).toEqual({ label: "Failed", tone: "bad" });
    expect(domainSslView({ ...base, shared: true, ssl: "pending" })).toEqual({ label: "Pending", tone: "warn" });
  });
});

describe("domainStatusView", () => {
  it("maps each status to its own label", () => {
    expect(domainStatusView({ ...base, status: "live" })).toEqual({ label: "Live", tone: "good" });
    expect(domainStatusView({ ...base, status: "verifying" })).toEqual({ label: "Verifying DNS", tone: "warn" });
    expect(domainStatusView({ ...base, status: "failed" })).toEqual({ label: "Failed", tone: "bad" });
  });
});
