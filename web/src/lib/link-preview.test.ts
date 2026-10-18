import { describe, expect, it } from "vitest";
import { needsLockLookup, previewView, trustPage } from "./link-preview";

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

/* #762 — with public previews off the preview 403s, and the page used to stop
   there: the password form lived only in the preview's success branch, so a
   protected link could not be opened at all. Oracle: PublicLinkLock in
   packages/contract/src/public.ts — the unlock flow's own payload, not gated by
   the previews switch, never carrying the destination. */
describe("trustPage (#762)", () => {
  const PREVIEW = {
    shortUrl: "snap.to/vault",
    destination: null,
    passwordProtected: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "Acme",
    verifiedDomain: true,
    safeBrowsing: "clean",
    scannedAt: "2026-01-01T00:00:00.000Z",
    setsCookies: false,
    redirectType: "302",
  } as const;
  const previewsOff = Object.assign(new Error("You don't have permission to do that."), { status: 403 });
  const notFound = Object.assign(new Error("That link doesn't exist."), { status: 404 });
  const idle = { pending: false } as const;

  it("asks for the lock only when the preview was refused because previews are off", () => {
    expect(needsLockLookup(previewsOff)).toBe(true);
    expect(needsLockLookup(notFound)).toBe(false);
    expect(needsLockLookup(Object.assign(new Error("x"), { status: 500 }))).toBe(false);
    expect(needsLockLookup(new Error("network"))).toBe(false);
    expect(needsLockLookup(undefined)).toBe(false);
  });

  it("previews off + protected link: the password form, with the short URL to unlock through", () => {
    expect(
      trustPage({
        preview: { pending: false, error: previewsOff },
        lock: { pending: false, data: { shortUrl: "snap.to/vault", passwordProtected: true } },
      }),
    ).toEqual({ kind: "lock", shortUrl: "snap.to/vault" });
  });

  it("previews off: never carries anything but the short URL, even if a lock response had more", () => {
    const page = trustPage({
      preview: { pending: false, error: previewsOff },
      lock: {
        pending: false,
        data: { shortUrl: "snap.to/vault", passwordProtected: true, destination: "https://acme.com/secret" } as never,
      },
    });
    expect(JSON.stringify(page)).not.toContain("acme.com");
  });

  it("previews off + no password: the preview's error, not a password form", () => {
    expect(
      trustPage({
        preview: { pending: false, error: previewsOff },
        lock: { pending: false, data: { shortUrl: "snap.to/open", passwordProtected: false } },
      }),
    ).toEqual({ kind: "error", message: previewsOff.message });
  });

  it("previews off, lock still loading: loading, not an error flash", () => {
    expect(trustPage({ preview: { pending: false, error: previewsOff }, lock: { pending: true } })).toEqual({
      kind: "loading",
    });
  });

  it("deploy skew — new web, old API without the lock route: the preview's error, no crash", () => {
    expect(trustPage({ preview: { pending: false, error: previewsOff }, lock: { pending: false, error: notFound } })).toEqual(
      { kind: "error", message: previewsOff.message },
    );
  });

  it("unknown slug: the preview's 404, and the lock is never consulted", () => {
    expect(trustPage({ preview: { pending: false, error: notFound }, lock: idle })).toEqual({
      kind: "error",
      message: notFound.message,
    });
  });

  it("previews on: the full preview (which renders its own password form)", () => {
    expect(trustPage({ preview: { pending: false, data: PREVIEW }, lock: idle })).toEqual({ kind: "preview" });
  });

  it("preview loading: loading", () => {
    expect(trustPage({ preview: { pending: true }, lock: idle })).toEqual({ kind: "loading" });
  });
});
