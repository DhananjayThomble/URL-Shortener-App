import { ConflictException, HttpException, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import {
  defaultMessageForProviderErrorKind,
  httpStatusForProviderError,
  reasonForProviderErrorKind,
  type BillingProviderErrorKind,
} from "@snapurl/contract";
import { BillingProviderError } from "./razorpay.provider.js";

/* ============================================================
   #1023 — the ONE place a BillingProviderError becomes an HTTP response.

   Every billing WRITE endpoint (/billing/change, /billing/cancel, the admin
   plan-change charge, the admin refund) catches a BillingProviderError and
   calls this. The adapter decided the KIND (rejected / unavailable); this maps
   the kind to the status + stable reason code (via the contract, the single
   definition) and attaches an honest, provider-free message:

     - rejected    → 409 (or 422 when the caller passes `rejectedStatus: 422`)
                     with reason `provider_rejected`.
     - unavailable → 503 with reason `provider_unavailable`.

   The reason code rides in the response BODY so a client can switch on it
   without parsing prose. No provider body, id or secret is ever included — the
   BillingProviderError never carried one (it was logged redacted at the
   adapter), so there is nothing here to leak.

   Mapping lives in one function rather than a global exception filter on
   purpose: the four endpoints already have a catch block that re-maps their
   domain errors (PlanNotConfiguredError → 400, etc.), so folding the provider
   case into the same block keeps all of an endpoint's error translation
   visible in one place, and a per-endpoint message/status (409 vs 422) is a
   call the endpoint makes.
   ============================================================ */

export interface ProviderHttpOptions {
  /** A more specific honest message for a `rejected` error on this endpoint
   *  (e.g. "This subscription can't be changed right now because its first
   *  payment isn't complete."). Falls back to the kind's default. Ignored for
   *  `unavailable`, which always uses the stable "provider unavailable" copy so
   *  the message matches the 503 and never implies a client mistake. */
  rejectedMessage?: string;
  /** Surface a `rejected` error as 422 instead of the 409 default, when the
   *  request is well-formed but semantically unprocessable fits better. */
  rejectedStatus?: 409 | 422;
}

/** The HTTP status's canonical `error` label, so the body matches Nest's own. */
function errorLabel(status: 409 | 422 | 503): string {
  switch (status) {
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Entity";
    case 503:
      return "Service Unavailable";
  }
}

/** Build the Nest HttpException for a provider-error kind + options. The
 *  exception's response body carries the stable `reason` code alongside the
 *  status, error label and message. */
export function providerErrorToHttpException(
  kind: BillingProviderErrorKind,
  options: ProviderHttpOptions = {},
): HttpException {
  const rejectedStatus = options.rejectedStatus ?? 409;
  const status = httpStatusForProviderError(kind, rejectedStatus);
  const reason = reasonForProviderErrorKind(kind);
  const message =
    kind === "rejected"
      ? (options.rejectedMessage ?? defaultMessageForProviderErrorKind("rejected"))
      : defaultMessageForProviderErrorKind("unavailable");

  const body = { statusCode: status, error: errorLabel(status), message, reason };

  // Use the status-specific Nest exception so the thrown type reads honestly;
  // the object body (with `reason`) is what the global filter sends verbatim.
  if (status === 503) return new ServiceUnavailableException(body);
  if (status === 422) return new UnprocessableEntityException(body);
  return new ConflictException(body);
}

/**
 * If `err` is a BillingProviderError, throw the mapped HttpException; otherwise
 * return so the caller can keep handling (re-throw its own domain errors). The
 * four write endpoints call this at the top of their catch block.
 */
export function rethrowIfProviderError(err: unknown, options: ProviderHttpOptions = {}): void {
  if (err instanceof BillingProviderError) {
    throw providerErrorToHttpException(err.kind, options);
  }
}
