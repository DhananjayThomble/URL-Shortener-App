import { describe, expect, it } from "vitest";
import { previewView } from "./link-preview";

/* Oracle: PublicLinkPreview in packages/contract/src/public.ts — a protected
   link's preview carries no destination, and the trust page must never offer
   one (no text, no Continue href). */
describe("previewView", () => {
  it("is open, with the host, for an unprotected link", () => {
    expect(previewView({ destination: "https://example.com/pricing?x=1", passwordProtected: false })).toEqual({
      kind: "open",
      destination: "https://example.com/pricing?x=1",
      host: "example.com",
    });
  });

  it("is locked for a password-protected link", () => {
    expect(previewView({ destination: null, passwordProtected: true })).toEqual({ kind: "locked" });
  });

  it("stays locked if a protected link somehow still carries a destination", () => {
    const view = previewView({ destination: "https://example.com/secret", passwordProtected: true });
    expect(view).toEqual({ kind: "locked" });
    expect(JSON.stringify(view)).not.toContain("example.com");
  });

  it("is locked when the destination is missing, whatever the flag says", () => {
    expect(previewView({ destination: null, passwordProtected: false })).toEqual({ kind: "locked" });
  });

  it("falls back to a generic label for an unparseable destination", () => {
    expect(previewView({ destination: "not a url", passwordProtected: false })).toMatchObject({
      kind: "open",
      host: "the destination",
    });
  });
});
