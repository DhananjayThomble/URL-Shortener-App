import { describe, expect, it } from "vitest";
import { Domain } from "@snapurl/contract";
import { routingRecordFor } from "./domains.routing.js";

/* ============================================================
   #784 — the DNS record that routes traffic to SnapURL.

   Oracle: how the deployment actually serves redirects. Every deploy profile
   sets DEFAULT_DOMAIN to the host the redirect service answers on
   (deploy/single-node/docker-compose.yml DEFAULT_DOMAIN=${SHORT_DOMAIN},
   deploy/helm configmap defaultDomain, infra snapurl-stack.ts default-domain),
   and the shared system domain row IS that host. A customer's own domain must
   therefore resolve to that same host: a CNAME to it, or an A/AAAA record when
   the operator's short domain is a bare IP. A DNS answer never carries a port,
   so a dev-style "localhost:3002" must be reduced to its host.
   ============================================================ */

describe("routingRecordFor", () => {
  it("is a CNAME from the customer's domain to the deployment's short domain", () => {
    expect(routingRecordFor("go.acme.test", "snap.example.com")).toEqual({
      type: "CNAME",
      name: "go.acme.test",
      value: "snap.example.com",
      ttl: 300,
    });
  });

  it("drops a port: DNS has no ports", () => {
    expect(routingRecordFor("go.acme.test", "localhost:3002")?.value).toBe("localhost");
    expect(routingRecordFor("go.acme.test", "snap.example.com:8443")?.value).toBe("snap.example.com");
  });

  it("lower-cases and drops a trailing dot", () => {
    expect(routingRecordFor("go.acme.test", "Snap.Example.COM.")?.value).toBe("snap.example.com");
  });

  it("uses an A record when the short domain is an IPv4 address (a CNAME to an IP is invalid DNS)", () => {
    expect(routingRecordFor("go.acme.test", "203.0.113.7")).toMatchObject({ type: "A", value: "203.0.113.7" });
    expect(routingRecordFor("go.acme.test", "203.0.113.7:8080")).toMatchObject({ type: "A", value: "203.0.113.7" });
  });

  it("uses an AAAA record for an IPv6 literal", () => {
    expect(routingRecordFor("go.acme.test", "[2001:db8::1]:8080")).toMatchObject({ type: "AAAA", value: "2001:db8::1" });
  });

  it("is null for a configuration it cannot turn into a record", () => {
    expect(routingRecordFor("go.acme.test", "")).toBeNull();
    expect(routingRecordFor("go.acme.test", "not a host")).toBeNull();
    expect(routingRecordFor("go.acme.test", "https://snap.example.com/x")).toBeNull();
  });

  it("is null when the target would be the domain itself (a self-referencing CNAME)", () => {
    expect(routingRecordFor("snap.example.com", "snap.example.com")).toBeNull();
  });

  it("produces a record the Domain contract accepts", () => {
    const record = routingRecordFor("go.acme.test", "snap.example.com");
    const parsed = Domain.parse({
      id: "d1",
      domain: "go.acme.test",
      status: "verifying",
      ssl: "pending",
      links: 0,
      rootRedirect: null,
      notFoundRedirect: null,
      routing: record,
    });
    expect(parsed.routing).toEqual(record);
  });
});
