import { describe, expect, it } from "vitest";
import {
  PREVIEWS_OFF_CODE,
  PREVIEWS_OFF_MESSAGE,
  PublicLinkLock,
  PublicLinkPreview,
  PublicLinkState,
  UnlockLinkInput,
  UnlockLinkResult,
  isPreviewsOffRefusal,
} from "./public.js";

/* #765 — the 403 PublicService.preview sends when the owner turned public
   previews off. The page tells it from every other 403 by the response BODY:
   the client rewrites each 403's message to a generic string, so the body is
   all that survives. Matched positively, like the 2FA credential messages. */
describe("isPreviewsOffRefusal", () => {
  it("accepts the code (current API)", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: "anything", error: "Forbidden", code: PREVIEWS_OFF_CODE })).toBe(
      true,
    );
  });

  it("accepts the exact message without the code (an API from before the code existed)", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: PREVIEWS_OFF_MESSAGE, error: "Forbidden" })).toBe(true);
    expect(isPreviewsOffRefusal({ message: `  ${PREVIEWS_OFF_MESSAGE} ` })).toBe(true);
  });

  it("rejects every other body", () => {
    expect(isPreviewsOffRefusal({ statusCode: 403, message: "Forbidden resource", error: "Forbidden" })).toBe(false);
    expect(isPreviewsOffRefusal({ code: "other" })).toBe(false);
    expect(isPreviewsOffRefusal({ message: [PREVIEWS_OFF_MESSAGE] })).toBe(false);
    expect(isPreviewsOffRefusal({})).toBe(false);
    expect(isPreviewsOffRefusal("previews")).toBe(false);
    expect(isPreviewsOffRefusal(42)).toBe(false);
    expect(isPreviewsOffRefusal(null)).toBe(false);
    expect(isPreviewsOffRefusal(undefined)).toBe(false);
  });
});


/* #895: the schema shapes are load-bearing contracts between redirect, API and
   the trust page. Pin the enum membership, the required fields and the
   password floor so a weakened shape is caught. */
describe("PublicLinkState enum", () => {
  it("accepts exactly its five lifecycle states and rejects others", () => {
    for (const s of ["active", "expired", "click_limit", "scheduled", "archived"]) {
      expect(PublicLinkState.safeParse(s).success).toBe(true);
    }
    expect(PublicLinkState.safeParse("expiring").success).toBe(false); // dashboard-only, not a public state
    expect(PublicLinkState.safeParse("live").success).toBe(false);
    expect(PublicLinkState.safeParse("").success).toBe(false);
  });
});

describe("PublicLinkPreview shape", () => {
  const valid = {
    shortUrl: "https://sho.rt/abc",
    destination: "https://example.com",
    passwordProtected: false,
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: "Acme",
    verifiedDomain: true,
    safeBrowsing: "clean" as const,
    scannedAt: "2026-01-01T00:00:00Z",
    setsCookies: false,
    redirectType: "302" as const,
  };

  it("accepts a well-formed preview and keeps its required fields", () => {
    const parsed = PublicLinkPreview.parse(valid);
    expect(parsed.shortUrl).toBe("https://sho.rt/abc");
    expect(parsed.passwordProtected).toBe(false); // a {} shape drops every key
    expect(parsed.safeBrowsing).toBe("clean");
  });

  it("allows a protected link to carry a null destination", () => {
    expect(PublicLinkPreview.safeParse({ ...valid, destination: null, passwordProtected: true }).success).toBe(true);
  });

  it("requires each field with its declared type (kills the shape → {} mutant)", () => {
    const { shortUrl: _s, ...noShortUrl } = valid;
    expect(PublicLinkPreview.safeParse(noShortUrl).success).toBe(false);
    expect(PublicLinkPreview.safeParse({ ...valid, passwordProtected: "no" }).success).toBe(false);
    expect(PublicLinkPreview.safeParse({ ...valid, safeBrowsing: "mystery" }).success).toBe(false);
    expect(PublicLinkPreview.safeParse({ ...valid, redirectType: "sideways" }).success).toBe(false);
    expect(PublicLinkPreview.safeParse({ ...valid, state: "expiring" }).success).toBe(false); // optional, still validated
  });
});

describe("PublicLinkLock shape", () => {
  it("requires shortUrl and the passwordProtected boolean (kills the shape → {} mutant)", () => {
    expect(PublicLinkLock.parse({ shortUrl: "https://sho.rt/x", passwordProtected: true }).passwordProtected).toBe(true);
    expect(PublicLinkLock.safeParse({ shortUrl: "https://sho.rt/x" }).success).toBe(false);
    expect(PublicLinkLock.safeParse({ shortUrl: "https://sho.rt/x", passwordProtected: "yes" }).success).toBe(false);
  });
});

describe("UnlockLinkInput shape", () => {
  it("requires a non-empty password (kills the shape → {} mutant and .min(1) → .max(1))", () => {
    expect(UnlockLinkInput.safeParse({ password: "hunter2" }).success).toBe(true);
    expect(UnlockLinkInput.safeParse({ password: "ab" }).success).toBe(true); // 2 chars ok — .max(1) would reject
    expect(UnlockLinkInput.safeParse({ password: "" }).success).toBe(false); // empty rejected by .min(1)
    expect(UnlockLinkInput.safeParse({}).success).toBe(false);
    expect(UnlockLinkInput.safeParse({ password: 123 }).success).toBe(false);
  });
});

describe("UnlockLinkResult shape", () => {
  it("requires unlockToken string and expiresIn number (kills the shape → {} mutant)", () => {
    const parsed = UnlockLinkResult.parse({ unlockToken: "tok", expiresIn: 300 });
    expect(parsed.unlockToken).toBe("tok");
    expect(parsed.expiresIn).toBe(300);
    expect(UnlockLinkResult.safeParse({ unlockToken: "tok" }).success).toBe(false);
    expect(UnlockLinkResult.safeParse({ unlockToken: "tok", expiresIn: "soon" }).success).toBe(false);
  });
});
