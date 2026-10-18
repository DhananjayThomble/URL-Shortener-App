import { describe, expect, it } from "vitest";
import type { Domain } from "@snapurl/contract";
import { dnsSteps, isLikelyApex } from "./domain-dns";

/* Oracle: the Domain contract (packages/contract/src/workspace.ts) and how the
   API fills it (apps/api/src/domains/domains.service.ts toDto):
     - `dns` is the TXT ownership record, present while a verification token
       exists;
     - `routing` (#784) is the record that points traffic at the deployment —
       a CNAME to the short domain's host (A / AAAA when that is a bare IP).
       Absent from older API builds, null for the shared domain.
   #784: the setup card showed only the TXT record, so a customer who did
   exactly what it said still had a domain that verified but served nothing. */

const base: Domain = {
  id: "d1",
  domain: "go.acme.test",
  status: "verifying",
  ssl: "pending",
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
  dns: { type: "TXT", name: "_snapurl.go.acme.test", value: "snapurl-verify-abc", ttl: 300 },
  routing: { type: "CNAME", name: "go.acme.test", value: "snap.example.com", ttl: 300 },
};

describe("dnsSteps", () => {
  it("lists ownership first, then routing, each with the record the API sent", () => {
    const steps = dnsSteps(base);
    expect(steps.map((s) => s.key)).toEqual(["verify", "route"]);
    expect(steps[0]!.record).toEqual(base.dns);
    expect(steps[1]!.record).toEqual(base.routing);
  });

  it("numbers and titles the steps so the page can say what each record is for", () => {
    const [verify, route] = dnsSteps(base);
    expect(verify!.title).toMatch(/verify/i);
    expect(route!.title).toMatch(/point|route|traffic/i);
  });

  it("shows only the TXT record when an older API sends no routing (deploy skew)", () => {
    const { routing: _routing, ...old } = base;
    expect(dnsSteps(old as Domain).map((s) => s.key)).toEqual(["verify"]);
    expect(dnsSteps({ ...base, routing: null }).map((s) => s.key)).toEqual(["verify"]);
  });

  it("shows only routing when there is no ownership record to add", () => {
    expect(dnsSteps({ ...base, dns: null }).map((s) => s.key)).toEqual(["route"]);
  });

  it("is empty when there is nothing to add", () => {
    expect(dnsSteps({ ...base, dns: null, routing: null })).toEqual([]);
  });

  it("warns that a root domain can't hold a CNAME, and names the alternatives", () => {
    const apex = dnsSteps({
      ...base,
      domain: "acme.test",
      routing: { type: "CNAME", name: "acme.test", value: "snap.example.com", ttl: 300 },
    });
    const note = apex[1]!.note ?? "";
    expect(note).toMatch(/root|apex/i);
    expect(note).toMatch(/ALIAS/);
    expect(note).toMatch(/ANAME/);
    expect(note).toMatch(/flattening/i);
  });

  it("gives a subdomain no apex warning", () => {
    expect(dnsSteps(base)[1]!.note).toBeUndefined();
  });

  it("gives an A-record route no CNAME-at-apex warning (an A record is valid at the root)", () => {
    const steps = dnsSteps({
      ...base,
      domain: "acme.test",
      routing: { type: "A", name: "acme.test", value: "203.0.113.7", ttl: 300 },
    });
    expect(steps[1]!.note).toBeUndefined();
  });

  it("never puts a configuration variable name in user-facing copy", () => {
    const copy = dnsSteps({ ...base, domain: "acme.test" })
      .flatMap((s) => [s.title, s.help, s.note ?? ""])
      .join(" ");
    expect(copy).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
  });
});

describe("isLikelyApex", () => {
  it.each(["acme.test", "acme.com", "ACME.com", "acme.com.", "acme.co.uk", "acme.com.au"])("%s is a root domain", (d) => {
    expect(isLikelyApex(d)).toBe(true);
  });

  it.each(["go.acme.test", "www.acme.com", "go.acme.co.uk", "a.b.c.acme.io"])("%s is a subdomain", (d) => {
    expect(isLikelyApex(d)).toBe(false);
  });
});
