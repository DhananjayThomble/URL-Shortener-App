import { describe, expect, it } from "vitest";
import { PublicLinkPreview } from "@snapurl/contract";
import { effectiveGate } from "@snapurl/domain/destination";
import { needsLockLookup, previewOutcome, previewView, trustPage } from "./link-preview";

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

/* #764 — the "+" preview of an expired (or rule-routed) link said "This link is
   safe to open" and offered Continue to the destination. Oracle: the redirect's
   gate order (apps/redirect/src/main.ts gateFor): archived -> flagged ->
   expired (expiresTo or 410) -> click limit (410) -> scheduled (scheduledTo or
   404) -> password -> routing rules. */
describe("previewOutcome (#764)", () => {
  const CLEAN = { kind: "clean", continueLabel: "Continue to" } as const;
  const FLAGGED = { kind: "flagged", continueLabel: "Continue anyway to" } as const;
  const base: PublicLinkPreview = {
    shortUrl: "snap.to/promo",
    destination: "https://acme.com/sale",
    passwordProtected: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "Acme",
    verifiedDomain: true,
    safeBrowsing: "clean",
    scannedAt: "2026-01-01T00:00:00.000Z",
    setsCookies: false,
    redirectType: "302",
    state: "active",
    expiresAt: null,
    activatesAt: null,
    hasRules: false,
    hasFallback: false,
  };
  const at = (p: Partial<PublicLinkPreview>, trust: typeof CLEAN | typeof FLAGGED = CLEAN) =>
    previewOutcome({ ...base, ...p }, trust);

  it("active, no rules: Continue straight to the destination, as before", () => {
    expect(at({})).toEqual({
      state: "active",
      gate: null,
      blocked: null,
      continueTo: { href: "https://acme.com/sale", label: "Continue to acme.com →", muted: false },
      passwordForm: false,
      rulesNote: null,
      dateRow: null,
    });
  });

  it("active with an expiry ahead: says when it expires", () => {
    expect(at({ expiresAt: "2026-12-01T00:00:00.000Z" }).dateRow).toEqual({
      label: "Expires",
      at: "2026-12-01T00:00:00.000Z",
    });
  });

  it("expired, no fallback: says so, and offers no way on", () => {
    const o = at({ state: "expired", expiresAt: "2026-02-01T00:00:00.000Z" });
    expect(o.blocked?.heading).toBe("This link has expired");
    expect(o.blocked?.where).toMatch(/^Nowhere/);
    expect(o.continueTo).toBeNull();
    expect(o.dateRow).toEqual({ label: "Expired", at: "2026-02-01T00:00:00.000Z" });
  });

  it("expired with a fallback: Continue goes through the short link, never to the destination", () => {
    const o = at({ state: "expired", hasFallback: true });
    expect(o.continueTo).toEqual({ href: "https://snap.to/promo", label: "Continue to the owner's page →", muted: false });
    expect(JSON.stringify(o)).not.toContain("acme.com/sale");
  });

  it("click limit reached: blocked with no Continue, whatever hasFallback says (the redirect has none)", () => {
    const o = at({ state: "click_limit", hasFallback: true });
    expect(o.blocked?.heading).toBe("This link has reached its click limit");
    // hasFallback is false from the API here; the copy must not invent one either way.
    expect(o.blocked?.where).toMatch(/^Nowhere/);
    expect(o.continueTo).toBeNull();
  });

  it("scheduled: not live yet, with its start date and its fallback if any", () => {
    const o = at({ state: "scheduled", activatesAt: "2026-11-01T09:00:00.000Z" });
    expect(o.blocked?.heading).toBe("This link isn't live yet");
    expect(o.dateRow).toEqual({ label: "Goes live", at: "2026-11-01T09:00:00.000Z" });
    expect(o.continueTo).toBeNull();
    expect(at({ state: "scheduled", hasFallback: true }).continueTo?.href).toBe("https://snap.to/promo");
  });

  it("archived: blocked, no Continue, and it wins over a Safe Browsing flag", () => {
    const o = at({ state: "archived" }, FLAGGED);
    expect(o.blocked?.heading).toBe("This link is no longer active");
    expect(o.continueTo).toBeNull();
  });

  it("protected + expired: no password form (the redirect refuses before the password), nothing about a fallback", () => {
    const o = at({ state: "expired", passwordProtected: true, destination: null, hasFallback: null });
    expect(o.passwordForm).toBe(false);
    expect(o.continueTo).toBeNull();
    expect(o.blocked?.where).not.toMatch(/different page|Nowhere/);
  });

  it("protected + active: the password form, no Continue", () => {
    const o = at({ passwordProtected: true, destination: null, hasFallback: null });
    expect(o.passwordForm).toBe(true);
    expect(o.continueTo).toBeNull();
  });

  it("routing rules: a note, and Continue goes through the short link so the rules apply", () => {
    const o = at({ hasRules: true });
    expect(o.rulesNote).toMatch(/some visitors are sent to a different page/);
    expect(o.continueTo).toEqual({ href: "https://snap.to/promo", label: "Continue to snap.to/promo →", muted: false });
  });

  it("routing rules on an expired link: no rules note (no visitor reaches the rules)", () => {
    expect(at({ state: "expired", hasRules: true }).rulesNote).toBeNull();
  });

  it("flagged + active + rules: Continue anyway to the destination, and NO rules note (the flagged gate stops routing)", () => {
    const o = at({ hasRules: true }, FLAGGED);
    expect(o.gate).toBe("flagged");
    expect(o.continueTo).toEqual({ href: "https://acme.com/sale", label: "Continue anyway to acme.com →", muted: true });
    // The redirect bounces to the warning page before routing runs, so the
    // page must not claim visitors may be routed elsewhere.
    expect(o.rulesNote).toBeNull();
  });

  it("flagged + protected: no password form, which would loop back here (#800)", () => {
    const o = at({ passwordProtected: true, destination: null }, FLAGGED);
    expect(o.gate).toBe("flagged");
    expect(o.passwordForm).toBe(false);
    expect(o.continueTo).toBeNull();
  });

  it("flagged + expired + fallback + rules: reads as flagged, with NO expiry/fallback/rules claim", () => {
    const o = at({ state: "expired", hasFallback: true, hasRules: true }, FLAGGED);
    // The redirect answers the warning bounce before the expiry fallback and
    // before routing, so the preview must say flagged, not expired.
    expect(o.gate).toBe("flagged");
    expect(o.blocked).toBeNull(); // the caller renders the flagged heading from `trust`
    expect(o.rulesNote).toBeNull();
    // No "owner's page" / short-link fallback Continue, and none to the destination.
    expect(o.continueTo).toEqual({ href: "https://acme.com/sale", label: "Continue anyway to acme.com →", muted: true });
    expect(JSON.stringify(o)).not.toContain("owner's page");
  });

  it("flagged + archived: archived still wins over the flag, as in the redirect", () => {
    const o = at({ state: "archived" }, FLAGGED);
    expect(o.gate).toBe("archived");
    expect(o.blocked?.heading).toBe("This link is no longer active");
    expect(o.continueTo).toBeNull();
  });

  /* The compound-state matrix: the effective gate the page shows must equal the
     redirect's gateFor for every (flagged, lifecycle) pair. Pinned against the
     domain's own effectiveGate so a future reorder of either side is caught. */
  it("effective gate matches the redirect's gateFor for every flagged × lifecycle pair", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    const past = "2026-06-14T12:00:00Z";
    const future = "2026-06-16T12:00:00Z";
    type Lifecycle = "active" | "expired" | "click_limit" | "scheduled" | "archived";
    type RedirectShape = { archived: boolean; expiresAt?: string; clickLimit?: number; clicks?: number; activatesAt?: string };
    const cases: Record<Lifecycle, Partial<PublicLinkPreview> & { _redirect: RedirectShape }> = {
      active: { state: "active", _redirect: { archived: false } },
      expired: { state: "expired", expiresAt: past, _redirect: { archived: false, expiresAt: past } },
      click_limit: { state: "click_limit", _redirect: { archived: false, clickLimit: 1, clicks: 1 } },
      scheduled: { state: "scheduled", activatesAt: future, _redirect: { archived: false, activatesAt: future } },
      archived: { state: "archived", _redirect: { archived: true } },
    };
    for (const [, c] of Object.entries(cases)) {
      const { _redirect, ...preview } = c;
      for (const flagged of [false, true]) {
        // What the redirect's gateFor would return for the same link.
        const redirectGate = effectiveGate({ ..._redirect, safeBrowsingStatus: flagged ? "flagged" : "clean" }, now);
        const o = previewOutcome({ ...base, ...preview } as PublicLinkPreview, flagged ? FLAGGED : CLEAN);
        expect(o.gate, `${preview.state} flagged=${flagged}`).toBe(redirectGate);
        // A gate higher than a lifecycle one must suppress lifecycle claims.
        if (o.gate === "flagged" || o.gate === "archived") {
          expect(o.rulesNote, `${preview.state} flagged=${flagged} rulesNote`).toBeNull();
          expect(JSON.stringify(o)).not.toContain("owner's page");
        }
      }
    }
  });

  it("deploy skew — an older API with none of the new fields: exactly the old page", () => {
    const { state, expiresAt, activatesAt, hasRules, hasFallback, ...old } = base;
    void [state, expiresAt, activatesAt, hasRules, hasFallback];
    const parsed = PublicLinkPreview.parse(old);
    expect(previewOutcome(parsed, CLEAN)).toEqual(at({}));
  });

  it("a localhost short link (the dev redirect) goes over http", () => {
    expect(at({ shortUrl: "localhost:3002/promo", hasRules: true }).continueTo?.href).toBe("http://localhost:3002/promo");
  });
});
