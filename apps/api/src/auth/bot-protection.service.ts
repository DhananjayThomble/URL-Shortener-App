import { Inject, Injectable, Logger } from "@nestjs/common";
import type { BotProtectionProvider } from "@snapurl/contract";
import { ENV, type Env } from "../config/env.js";
import { PlatformSettingsService } from "../admin/platform-settings.service.js";

/* ============================================================
   #993 — the sign-up bot-protection verifier.

   An invisible challenge (Cloudflare Turnstile or hCaptcha) runs in the
   browser on register and OAuth sign-up; its token is sent with the request and
   verified here, server-side, before the account is created. The PROVIDER is a
   runtime platform setting (none/turnstile/hcaptcha) so an operator switches it
   from the admin panel; the matching SECRET is an env value (never in settings).

   Pluggable by design (the issue leaves the vendor choice open, D2): both
   supported providers are a single application/x-www-form-urlencoded POST to a
   siteverify URL returning `{ success: boolean, ... }`, so one `verify` method
   dispatches on the provider. Adding AWS WAF CAPTCHA later is a new branch here
   and a new enum member, nothing else.

   Fail-closed: when a provider is ON, a missing/empty token, a missing secret,
   a siteverify rejection, OR a network/transport error all return `false` — a
   sign-up gate that cannot confirm a human must refuse, not wave the caller
   through. When the provider is "none" (the default) verify returns true
   without a network call, so a self-hoster registers with no third party.

   The verify calls are mocked in tests (fetch is injectable) so CI makes no
   live network call. */

/** The outcome of a challenge check. `ok` true means the request may proceed;
 *  false carries the reason so the caller logs the right refusal code. */
export interface BotCheckResult {
  ok: boolean;
  /** Which refusal applies when ok is false: the token was absent, or it was
   *  present but siteverify (or a transport failure) rejected it. Undefined
   *  when ok is true. */
  reason?: "missing" | "failed";
}

/** The siteverify endpoint per provider. Shared shape: POST form-encoded
 *  `secret` + `response` (+ optional `remoteip`), JSON `{ success }` back. */
const SITEVERIFY_URL: Record<Exclude<BotProtectionProvider, "none">, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://api.hcaptcha.com/siteverify",
};

/** The fetch implementation, injectable so a test can supply a stub and CI
 *  never makes a live call. Defaults to the global fetch (Node 18+/20). */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

@Injectable()
export class BotProtectionService {
  private readonly logger = new Logger(BotProtectionService.name);

  /** Overridable in tests via setFetchForTesting; the real global fetch in
   *  production. A plain field (not a DI param) so Nest never tries to resolve
   *  it as a provider. */
  private fetchImpl: FetchLike = ((input, init) => fetch(input, init)) as FetchLike;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Test-only: swap the fetch implementation so no live siteverify call is
   *  made in CI. Not used by production code. */
  setFetchForTesting(fn: FetchLike): void {
    this.fetchImpl = fn;
  }

  /**
   * Verify a challenge token for a NEW-ACCOUNT request.
   *
   * Returns `{ ok: true }` immediately when the provider is "none". Otherwise
   * the token must be present AND accepted by the provider's siteverify, and
   * the configured secret must exist — any gap is a fail-closed refusal.
   */
  async verify(token: string | undefined, remoteIp?: string): Promise<BotCheckResult> {
    const { provider } = (await this.settings.getValues()).botProtection;
    if (provider === "none") return { ok: true };

    const trimmed = token?.trim();
    if (!trimmed) return { ok: false, reason: "missing" };

    const secret = this.env.BOT_PROTECTION_SECRET?.trim();
    if (!secret) {
      /* Provider is on but no secret is configured: refuse rather than accept.
         Logged (not the secret, which does not exist) so an operator who turned
         the switch on without setting the secret sees why sign-ups are failing. */
      this.logger.error(
        `Bot protection is set to "${provider}" but BOT_PROTECTION_SECRET is not configured; refusing sign-up.`,
      );
      return { ok: false, reason: "failed" };
    }

    const body = new URLSearchParams({ secret, response: trimmed });
    if (remoteIp) body.set("remoteip", remoteIp);

    try {
      const res = await this.fetchImpl(SITEVERIFY_URL[provider], {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        this.logger.warn(`${provider} siteverify returned a non-2xx response; treating the challenge as failed.`);
        return { ok: false, reason: "failed" };
      }
      const data = (await res.json()) as { success?: unknown };
      return data?.success === true ? { ok: true } : { ok: false, reason: "failed" };
    } catch (err) {
      /* Transport failure (timeout, DNS, TLS): fail closed. A gate that cannot
         reach its verifier must not become a no-op that lets bots through. */
      this.logger.warn({ err }, `${provider} siteverify request failed; treating the challenge as failed.`);
      return { ok: false, reason: "failed" };
    }
  }
}
