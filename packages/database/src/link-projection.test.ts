import { describe, expect, it } from "vitest";
import {
  DOMAIN_META_SK,
  domainMetaKey,
  fromDomainItem,
  fromLinkItem,
  isEdgeEligible,
  kvsKey,
  kvsValue,
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

/* The edge fast path (#289): the eligibility rule, the KVS key format and the
   stored value are the contract the worker's writer and the CloudFront Function
   share. These lock the exact format the Function re-implements inline. */

/** A plain, unconditional, edge-eligible link. Each eligibility case below
    starts from this and flips exactly one field. */
const plain: ProjectedLink = {
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  destination: "https://example.com/dest",
  redirectType: "302",
  rules: [],
  expiresAt: null,
  expiresTo: null,
  activatesAt: null,
  scheduledTo: null,
  clickLimit: null,
  clicks: 0,
  hasPassword: false,
  forwardQuery: false,
  deepLink: false,
  hideReferrer: false,
  publicPreview: false,
  archived: false,
  safeBrowsingStatus: "clean",
  utm: null,
};

describe("isEdgeEligible", () => {
  it("is true for a plain unconditional clean link", () => {
    expect(isEdgeEligible(plain)).toBe(true);
  });

  it("is false when the link has a password", () => {
    expect(isEdgeEligible({ ...plain, hasPassword: true })).toBe(false);
  });

  it("is false when the link has routing rules", () => {
    expect(
      isEdgeEligible({
        ...plain,
        rules: [
          {
            id: "33333333-3333-3333-3333-333333333333",
            when: { country: "US" },
            then: "https://example.com/us",
            weight: 1,
          },
        ],
      }),
    ).toBe(false);
  });

  it("is false when the link has a click limit", () => {
    expect(isEdgeEligible({ ...plain, clickLimit: 100 })).toBe(false);
  });

  it("is false when the link has an expiry", () => {
    expect(isEdgeEligible({ ...plain, expiresAt: new Date("2030-01-01T00:00:00.000Z") })).toBe(false);
  });

  it("is false when the link has an activation time", () => {
    expect(isEdgeEligible({ ...plain, activatesAt: new Date("2030-01-01T00:00:00.000Z") })).toBe(false);
  });

  it("is false when the link is archived", () => {
    expect(isEdgeEligible({ ...plain, archived: true })).toBe(false);
  });

  it("is false when safe-browsing is not clean", () => {
    expect(isEdgeEligible({ ...plain, safeBrowsingStatus: "flagged" })).toBe(false);
  });
});

describe("kvsKey / kvsValue", () => {
  it("builds a lowercased host/slug key a CloudFront Function can reproduce", () => {
    expect(kvsKey("SNAP.TO", "Foo")).toBe("snap.to/foo");
    expect(kvsKey("  snap.to  ", "bar")).toBe("snap.to/bar");
    // The port is kept (normaliseHost only lowercases + trims).
    expect(kvsKey("LOCALHOST:3002", "X")).toBe("localhost:3002/x");
  });

  it("serialises exactly {destination, redirectType} and round-trips", () => {
    const value = kvsValue(plain);
    expect(JSON.parse(value)).toEqual({ destination: "https://example.com/dest", redirectType: "302" });
    // Well under the 1 KB per-value KVS limit.
    expect(value.length).toBeLessThan(1024);
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
