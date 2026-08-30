import { describe, expect, it } from "vitest";
import {
  DOMAIN_META_SK,
  domainMetaKey,
  fromDomainItem,
  fromLinkItem,
  linkKey,
  normaliseHost,
  toDomainItem,
  toLinkItem,
  type ProjectedDomain,
  type ProjectedLink,
} from "./link-projection.js";

/* Pure-data mapper: no SDK, no DynamoDB. These assert the item shape and the
   loss-free round-trip both apps depend on — a projected field the redirect
   revives cannot drift from what the worker wrote. */

describe("link-projection keys", () => {
  it("keys a LINK item by normalised host and lowercased slug", () => {
    // A printed "SNAP.TO/Foo" and a header "snap.to/foo" share one key.
    expect(linkKey("SNAP.TO", "Foo")).toEqual({ PK: "d#snap.to", SK: "s#foo" });
    expect(linkKey("  snap.to  ", "bar")).toEqual({ PK: "d#snap.to", SK: "s#bar" });
  });

  it("keys the domain-meta item by host and the fixed meta SK", () => {
    expect(domainMetaKey("SNAP.TO")).toEqual({ PK: "d#snap.to", SK: DOMAIN_META_SK });
  });

  it("normaliseHost lowercases and trims but keeps the port", () => {
    expect(normaliseHost("  LOCALHOST:3002 ")).toBe("localhost:3002");
  });
});

describe("toLinkItem / fromLinkItem round-trip", () => {
  const full: ProjectedLink = {
    id: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    destination: "https://example.com/dest",
    redirectType: "301",
    rules: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        when: { country: "US", device: "mobile", language: "en" },
        then: "https://example.com/us",
        weight: 0.5,
      },
    ],
    expiresAt: new Date("2030-01-02T03:04:05.000Z"),
    expiresTo: "https://example.com/expired",
    activatesAt: new Date("2029-12-31T00:00:00.000Z"),
    scheduledTo: "https://example.com/soon",
    clickLimit: 100,
    clicks: 42,
    hasPassword: true,
    forwardQuery: false,
    deepLink: true,
    hideReferrer: true,
    publicPreview: false,
    archived: true,
    safeBrowsingStatus: "safe",
    utm: { source: "print", medium: "qr", campaign: "spring", content: "a" },
  };

  it("round-trips every field including Dates", () => {
    const item = toLinkItem(full, "snap.to", "foo");
    // Dates are stored as ISO strings.
    expect(item.expiresAt).toBe("2030-01-02T03:04:05.000Z");
    expect(item.activatesAt).toBe("2029-12-31T00:00:00.000Z");
    expect(item.linkId).toBe(full.id);
    expect(item.PK).toBe("d#snap.to");
    expect(item.SK).toBe("s#foo");

    const back = fromLinkItem(item);
    // The id is projected as `linkId`; fromLinkItem maps it back to `id`.
    expect(back).toEqual(full);
    expect(back.expiresAt).toBeInstanceOf(Date);
    expect(back.activatesAt).toBeInstanceOf(Date);
  });

  it("round-trips nulls and utm=null loss-free", () => {
    const minimal: ProjectedLink = {
      ...full,
      redirectType: "302",
      rules: [],
      expiresAt: null,
      expiresTo: null,
      activatesAt: null,
      scheduledTo: null,
      clickLimit: null,
      clicks: 0,
      utm: null,
    };
    const item = toLinkItem(minimal, "snap.to", "bar");
    expect(item.expiresAt).toBeNull();
    expect(item.activatesAt).toBeNull();
    expect(item.utm).toBeNull();

    expect(fromLinkItem(item)).toEqual(minimal);
  });
});

describe("toDomainItem / fromDomainItem round-trip", () => {
  it("round-trips the domain meta", () => {
    const domain: ProjectedDomain = {
      id: "44444444-4444-4444-4444-444444444444",
      rootRedirect: "https://example.com/root",
      notFoundRedirect: null,
    };
    const item = toDomainItem("SNAP.TO", domain);
    expect(item.PK).toBe("d#snap.to");
    expect(item.SK).toBe(DOMAIN_META_SK);
    expect(fromDomainItem(item)).toEqual(domain);
  });
});
