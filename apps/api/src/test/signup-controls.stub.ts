import type { BotProtectionService, BotCheckResult } from "../auth/bot-protection.service.js";
import type { SignupRefusalService } from "../auth/signup-refusal.service.js";

/* #993 — test stubs for the two sign-up admission dependencies AuthService and
   LinksService now take.

   A test that is NOT about bot protection or refusal logging (every pre-#993
   auth/links integration test) needs SOME object in those slots or it hits a
   method on undefined. These default to the hands-off behaviour: the bot
   protection stub always passes (as a real "none" provider would), and the
   refusal stub records nothing. A test that drives one of those features uses
   the real service, or a stub it configures itself. */

/** A BotProtectionService stub. By default every verify passes (the "none"
 *  provider's behaviour); pass a fixed result to drive a refusal path. */
export function botProtectionStub(result: BotCheckResult = { ok: true }): BotProtectionService {
  return {
    verify: async () => result,
    setFetchForTesting: () => {},
  } as unknown as BotProtectionService;
}

/** A SignupRefusalService stub that records into an in-memory array so a test
 *  can assert WHICH reason code was logged, without a real audit-table write. */
export function signupRefusalStub(): SignupRefusalService & {
  recorded: Array<{ reason: string; subject: string }>;
} {
  const recorded: Array<{ reason: string; subject: string }> = [];
  return {
    recorded,
    record: async (reason: string, subject: string) => {
      recorded.push({ reason, subject });
    },
  } as unknown as SignupRefusalService & { recorded: Array<{ reason: string; subject: string }> };
}


/** #1007 — a MailDomainService stub. By default `hasNoMailRecords` returns
 *  false (the domain has mail records / the check is a no-op), so a test not
 *  about the DNS check is never refused by it. Pass `true` to drive the
 *  definitive no-mail refusal path. */
export function mailDomainStub(noMail = false): import("../auth/mail-domain.service.js").MailDomainService {
  return {
    hasNoMailRecords: async () => noMail,
    setResolverForTesting: () => {},
  } as unknown as import("../auth/mail-domain.service.js").MailDomainService;
}
