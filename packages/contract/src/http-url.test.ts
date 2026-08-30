import { describe, expect, it } from "vitest";
import { HttpUrl, isDeniedHost } from "./http-url.js";
import { CreateLinkInput, RoutingRule } from "./link.js";
import { AddDomainInput, CreateWebhookInput, UpsertBioPageInput } from "./workspace.js";

/* Issue #280: every URL-bearing field goes through HttpUrl, which rejects
   dangerous schemes and internal hosts before anything can emit them as a
   Location header or render them as a clickable <a href>. */

describe("HttpUrl — accepted", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "https://example.com/path?q=1#frag",
    "https://sub.example.co.uk/a/b/c",
    "https://example.com:8443/ok",
    "https://8.8.8.8/public-dns",
  ])("accepts %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(true);
  });
});

describe("HttpUrl — rejected schemes", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "vbscript:msgbox(1)",
    "mailto:someone@example.com",
    "tel:+15555555555",
    "ws://example.com/socket",
    "//example.com",
    "not a url",
  ])("rejects %s", (url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });
});

describe("HttpUrl — denylisted host ranges", () => {
  it.each([
    ["loopback name", "http://localhost/admin"],
    ["loopback name subdomain", "http://api.localhost/admin"],
    ["loopback v4", "http://127.0.0.1/x"],
    ["loopback v4 (127/8)", "http://127.99.1.2/x"],
    ["unspecified v4", "http://0.0.0.0/x"],
    ["private 10/8", "http://10.0.0.5/admin"],
    ["private 172.16/12", "http://172.16.0.1/x"],
    ["private 172.31/12", "http://172.31.255.255/x"],
    ["private 192.168/16", "http://192.168.1.1/x"],
    ["cgnat 100.64/10", "http://100.64.0.1/x"],
    ["link-local / metadata", "http://169.254.169.254/latest/meta-data/"],
    ["link-local range", "http://169.254.1.1/x"],
    ["ipv6 loopback", "http://[::1]/x"],
    ["ipv6 unspecified", "http://[::]/x"],
    ["ipv6 link-local", "http://[fe80::1]/x"],
    ["ipv6 unique-local", "http://[fd00::1]/x"],
    ["ipv4-mapped metadata", "http://[::ffff:169.254.169.254]/x"],
  ])("rejects %s: %s", (_label, url) => {
    expect(HttpUrl.safeParse(url).success).toBe(false);
  });

  it("still allows public IPs that only look adjacent to private ranges", () => {
    expect(HttpUrl.safeParse("http://172.15.0.1/x").success).toBe(true); // just below 172.16/12
    expect(HttpUrl.safeParse("http://172.32.0.1/x").success).toBe(true); // just above 172.31
    expect(HttpUrl.safeParse("http://100.63.0.1/x").success).toBe(true); // just below CGNAT
    expect(HttpUrl.safeParse("http://100.128.0.1/x").success).toBe(true); // just above CGNAT
  });
});

describe("isDeniedHost", () => {
  it("flags internal hosts and clears public ones", () => {
    expect(isDeniedHost("localhost")).toBe(true);
    expect(isDeniedHost("169.254.169.254")).toBe(true);
    expect(isDeniedHost("10.0.0.5")).toBe(true);
    expect(isDeniedHost("example.com")).toBe(false);
    expect(isDeniedHost("8.8.8.8")).toBe(false);
  });
});

describe("every contract field routes through HttpUrl", () => {
  const bad = "javascript:alert(1)";
  const metadata = "http://169.254.169.254/latest/meta-data/";
  const good = "https://example.com/ok";

  it("CreateLinkInput.destination rejects dangerous URLs", () => {
    expect(CreateLinkInput.safeParse({ destination: bad, domain: "d" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: metadata, domain: "d" }).success).toBe(false);
    expect(CreateLinkInput.safeParse({ destination: good, domain: "d" }).success).toBe(true);
  });

  it("CreateLinkInput.social.image rejects dangerous URLs", () => {
    expect(
      CreateLinkInput.safeParse({ destination: good, domain: "d", social: { image: bad } }).success,
    ).toBe(false);
    expect(
      CreateLinkInput.safeParse({ destination: good, domain: "d", social: { image: good } }).success,
    ).toBe(true);
  });

  it("RoutingRule.then rejects dangerous URLs", () => {
    const base = { id: "r1", when: {} };
    expect(RoutingRule.safeParse({ ...base, then: bad }).success).toBe(false);
    expect(RoutingRule.safeParse({ ...base, then: metadata }).success).toBe(false);
    expect(RoutingRule.safeParse({ ...base, then: good }).success).toBe(true);
  });

  it("AddDomainInput.rootRedirect and notFoundRedirect reject dangerous URLs", () => {
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: bad }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com", notFoundRedirect: metadata }).success).toBe(false);
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: good }).success).toBe(true);
    expect(AddDomainInput.safeParse({ domain: "acme.com", rootRedirect: null }).success).toBe(true);
  });

  it("CreateWebhookInput.endpoint rejects dangerous URLs", () => {
    expect(CreateWebhookInput.safeParse({ endpoint: bad, events: ["link.created"] }).success).toBe(false);
    expect(CreateWebhookInput.safeParse({ endpoint: metadata, events: ["link.created"] }).success).toBe(false);
    expect(CreateWebhookInput.safeParse({ endpoint: good, events: ["link.created"] }).success).toBe(true);
  });

  it("UpsertBioPageInput block href rejects dangerous URLs", () => {
    const base = {
      domain: "d",
      slug: "me",
      profile: { name: "Me", bio: "" },
    };
    const block = (href: string) => ({ kind: "link" as const, title: "t", href });
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(bad)] }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(metadata)] }).success).toBe(false);
    expect(UpsertBioPageInput.safeParse({ ...base, blocks: [block(good)] }).success).toBe(true);
  });
});
