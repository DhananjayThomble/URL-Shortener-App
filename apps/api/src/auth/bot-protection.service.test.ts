import { describe, expect, it, vi } from "vitest";
import type { PlatformSettingsValues } from "@snapurl/contract";
import { BotProtectionService, type FetchLike } from "./bot-protection.service.js";
import { openPlatformSettingsStub } from "../test/platform-settings.stub.js";
import type { Env } from "../config/env.js";

/* #993 — the sign-up bot-protection verifier. The provider is a runtime
   platform setting; the secret is env; the siteverify HTTP call is mocked so CI
   never makes a live request. */

function makeService(
  provider: PlatformSettingsValues["botProtection"]["provider"],
  secret: string | undefined,
  fetchImpl?: FetchLike,
): BotProtectionService {
  const settings = openPlatformSettingsStub({ botProtection: { provider } });
  const env = { BOT_PROTECTION_SECRET: secret } as unknown as Env;
  const svc = new BotProtectionService(env, settings);
  if (fetchImpl) svc.setFetchForTesting(fetchImpl);
  return svc;
}

/** A fetch stub that asserts the request shape and returns a fixed siteverify body. */
function stubFetch(body: unknown, opts: { ok?: boolean; capture?: (url: string, form: URLSearchParams) => void } = {}): FetchLike {
  return vi.fn(async (url: string, init) => {
    opts.capture?.(url, new URLSearchParams(init.body));
    return { ok: opts.ok ?? true, json: async () => body };
  }) as unknown as FetchLike;
}

describe("BotProtectionService.verify", () => {
  it("passes without any network call when the provider is none", async () => {
    const fetchImpl = stubFetch({ success: true });
    const svc = makeService("none", undefined, fetchImpl);
    await expect(svc.verify(undefined)).resolves.toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses with reason 'missing' when a provider is on and no token is sent", async () => {
    const svc = makeService("turnstile", "1x0000000000000000000000000000000AA");
    await expect(svc.verify(undefined)).resolves.toEqual({ ok: false, reason: "missing" });
    await expect(svc.verify("   ")).resolves.toEqual({ ok: false, reason: "missing" });
  });

  it("refuses with reason 'failed' (fail-closed) when the provider is on but no secret is configured", async () => {
    const fetchImpl = stubFetch({ success: true });
    const svc = makeService("hcaptcha", undefined, fetchImpl);
    await expect(svc.verify("some-token")).resolves.toEqual({ ok: false, reason: "failed" });
    // Never reaches siteverify without a secret.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes when turnstile siteverify returns success:true, hitting the turnstile URL with the secret+token", async () => {
    let seenUrl = "";
    let seenForm: URLSearchParams | undefined;
    const fetchImpl = stubFetch(
      { success: true },
      { capture: (url, form) => ((seenUrl = url), (seenForm = form)) },
    );
    const svc = makeService("turnstile", "secret-123", fetchImpl);
    await expect(svc.verify("tok-abc", "203.0.113.4")).resolves.toEqual({ ok: true });
    expect(seenUrl).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(seenForm?.get("secret")).toBe("secret-123");
    expect(seenForm?.get("response")).toBe("tok-abc");
    expect(seenForm?.get("remoteip")).toBe("203.0.113.4");
  });

  it("hits the hcaptcha URL for the hcaptcha provider", async () => {
    let seenUrl = "";
    const fetchImpl = stubFetch({ success: true }, { capture: (url) => (seenUrl = url) });
    const svc = makeService("hcaptcha", "secret-123", fetchImpl);
    await expect(svc.verify("tok")).resolves.toEqual({ ok: true });
    expect(seenUrl).toBe("https://api.hcaptcha.com/siteverify");
  });

  it("refuses with reason 'failed' when siteverify returns success:false", async () => {
    const svc = makeService("turnstile", "secret-123", stubFetch({ success: false, "error-codes": ["invalid-input-response"] }));
    await expect(svc.verify("bad-token")).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("refuses with reason 'failed' on a non-2xx siteverify response", async () => {
    const svc = makeService("turnstile", "secret-123", stubFetch({}, { ok: false }));
    await expect(svc.verify("tok")).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("fails closed (not open) when the siteverify request throws", async () => {
    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as FetchLike;
    const svc = makeService("turnstile", "secret-123", throwing);
    await expect(svc.verify("tok")).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("treats a missing success field as a failure (only success===true passes)", async () => {
    const svc = makeService("turnstile", "secret-123", stubFetch({ ok: true }));
    await expect(svc.verify("tok")).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("omits remoteip from the form when no IP is given", async () => {
    let seenForm: URLSearchParams | undefined;
    const svc = makeService("turnstile", "secret-123", stubFetch({ success: true }, { capture: (_u, form) => (seenForm = form) }));
    await svc.verify("tok");
    expect(seenForm?.has("remoteip")).toBe(false);
  });
});
