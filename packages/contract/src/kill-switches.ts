import { z } from "zod";

/* ============================================================
   #1020 — runtime admin KILL SWITCHES + hard caps for every paid or
   cost-incurring feature.

   The operator switches off any feature that costs money — or that an abuse
   wave could turn into money — from the admin panel, at runtime, with no
   redeploy. A code bug or an attack can then be stopped in under a minute.

   These are a TYPED set of switches stored next to the other #972 platform
   settings, NOT entries in the free-form `featureFlags` map: each switch has a
   fixed shape (an on/off plus, for some, a cap), the API validates it on write,
   and every consumer reads it through a named function rather than a string
   key. The free-form flags stay for genuinely ad-hoc toggles; a paid-feature
   brake is load-bearing and gets its own typed home.

   Two invariants the issue turns on, both enforced in the API/worker and not
   representable away here:

     • VERIFIED WEBHOOK INGEST IS NEVER SWITCHED OFF. A payment the provider has
       already taken must still be recorded. There is deliberately no
       `billing.webhook` switch in this set — the webhook path reads no switch
       and cannot be turned off from the panel.

     • FAIL CLOSED. If the settings store cannot be read, every PAID switch
       reads OFF (the safe answer for a cost-incurring action is "refuse") while
       the webhook stays on. That is why `DEFAULT_KILL_SWITCHES` ships billing
       and custom-domains OFF: turning them on is an explicit operator act, and
       an empty/unreadable store is indistinguishable from "never turned on".
   ============================================================ */

/** Every kill-switch key, in display order. A closed union (unlike the
 *  free-form featureFlags keys) so every consumer references a switch the
 *  compiler knows, and the admin page renders exactly this set. */
export const KILL_SWITCH_KEYS = [
  "billing.checkout",
  "billing.planChanges",
  "billing.coupons",
  "billing.trials",
  "billing.refunds",
  "customDomains.create",
  "email.outbound",
  "errorTracking",
  "linkScanning.rescans",
] as const;
export type KillSwitchKey = (typeof KILL_SWITCH_KEYS)[number];

/** The switches that gate a PAID or money-incurring action and therefore FAIL
 *  CLOSED (read OFF) when settings cannot be read. The remaining switches
 *  (email.outbound, errorTracking, linkScanning.rescans) gate cost-incurring
 *  background work that is safe to keep in its shipped default on a read
 *  failure — see DEFAULT_KILL_SWITCHES, where they ship ON so an unreadable
 *  store does not silently stop auth-critical mail or error reporting. */
export const PAID_KILL_SWITCH_KEYS = [
  "billing.checkout",
  "billing.planChanges",
  "billing.coupons",
  "billing.trials",
  "billing.refunds",
  "customDomains.create",
] as const;
export type PaidKillSwitchKey = (typeof PAID_KILL_SWITCH_KEYS)[number];

/** A bounded, positive integer cap. Zero is allowed where "zero means off"
 *  carries meaning for a cap (the switch itself is the on/off; a cap of 0 is a
 *  hard stop on that dimension while the switch is still on). Bounded so an
 *  operator cannot set an absurd value that effectively removes the cap. */
const cap = z.number().int().min(0).max(10_000_000);

/* ---- custom-domains caps (#1020 + #967) ---- */

/** Hard caps on custom-domain creation, enforced on top of the on/off switch.
 *  `totalMax` bounds how many custom domains may exist platform-wide at once;
 *  `perDay` bounds how many new ones may be added in any rolling 24h. Both gate
 *  the create path (and, when #967 lands, CloudFront SaaS tenant creation). */
export const CustomDomainsCaps = z.object({
  /** The most custom domains that may exist across the platform at once. */
  totalMax: cap,
  /** New custom domains allowed in any rolling 24 hours, platform-wide. */
  perDay: cap,
});
export type CustomDomainsCaps = z.infer<typeof CustomDomainsCaps>;

/* ---- outbound-email caps (#1020) ---- */

/** Hourly and daily caps on OUTBOUND email, platform-wide. The caps bound
 *  marketing/notification volume AND cost. Auth-critical mail (verification,
 *  password reset) may bypass the email.outbound OFF switch — but it is still
 *  counted against these caps and refused past them, so a reset storm cannot
 *  run up an unbounded bill. Documented on the switch and in the admin UI. */
export const EmailCaps = z.object({
  /** Messages allowed in any rolling hour, platform-wide. */
  perHour: cap,
  /** Messages allowed in any rolling 24 hours, platform-wide. */
  perDay: cap,
});
export type EmailCaps = z.infer<typeof EmailCaps>;

/* ---- error-tracking cap (#1020 + #995) ---- */

/** The error-tracking (Sentry, #995) sample-rate CEILING, 0..1. The switch
 *  turns reporting on/off; this caps the fraction of events actually sent when
 *  it is on, so an error storm cannot run up the Sentry quota. #995 exposes a
 *  shouldSend()/sampleRate seam; whichever of #995/#1020 lands second wires
 *  this value into it (see readErrorTrackingPolicy). */
export const ErrorTrackingCaps = z.object({
  /** The maximum fraction of error events to send (0 = none, 1 = all). */
  sampleRate: z.number().min(0).max(1),
});
export type ErrorTrackingCaps = z.infer<typeof ErrorTrackingCaps>;

/** One kill switch's stored state: whether the feature is ON, and (for the
 *  switches that carry caps) the caps. A switch with no caps is just `{ on }`.
 *  Caps are OPTIONAL in the schema so a switch that has none parses cleanly and
 *  so an operator PATCH can flip `on` without restating the caps — the service
 *  folds a partial change onto the current value. */
export const KillSwitchState = z.object({
  /** Whether the feature is enabled. false = the kill switch is engaged. */
  on: z.boolean(),
  /** Custom-domains create caps — present only on `customDomains.create`. */
  domainCaps: CustomDomainsCaps.optional(),
  /** Outbound-email caps — present only on `email.outbound`. */
  emailCaps: EmailCaps.optional(),
  /** Error-tracking sample-rate cap — present only on `errorTracking`. */
  errorCaps: ErrorTrackingCaps.optional(),
});
export type KillSwitchState = z.infer<typeof KillSwitchState>;

/** The whole typed kill-switch set: one state per key. Stored as a single
 *  `killSwitches` row in platform_settings (a map), validated against this on
 *  read and write. A record keyed by the closed union, so a missing key is a
 *  parse failure the service repairs by folding onto the defaults. */
export const KillSwitchesSetting = z.object({
  "billing.checkout": KillSwitchState,
  "billing.planChanges": KillSwitchState,
  "billing.coupons": KillSwitchState,
  "billing.trials": KillSwitchState,
  "billing.refunds": KillSwitchState,
  "customDomains.create": KillSwitchState,
  "email.outbound": KillSwitchState,
  errorTracking: KillSwitchState,
  "linkScanning.rescans": KillSwitchState,
});
export type KillSwitchesSetting = z.infer<typeof KillSwitchesSetting>;

/** The PATCH shape for the admin page: every switch optional (change one
 *  without the rest), and each switch's fields optional too (flip `on` without
 *  restating caps, or edit caps without flipping `on`). The refine requires at
 *  least one switch present so an empty body is a 400, matching the rest of the
 *  settings input. The service folds each partial onto the current value. */
const KillSwitchStatePatch = z
  .object({
    on: z.boolean().optional(),
    domainCaps: CustomDomainsCaps.optional(),
    emailCaps: EmailCaps.optional(),
    errorCaps: ErrorTrackingCaps.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Change the switch or its caps.",
  });

export const KillSwitchesInput = z
  .object({
    "billing.checkout": KillSwitchStatePatch.optional(),
    "billing.planChanges": KillSwitchStatePatch.optional(),
    "billing.coupons": KillSwitchStatePatch.optional(),
    "billing.trials": KillSwitchStatePatch.optional(),
    "billing.refunds": KillSwitchStatePatch.optional(),
    "customDomains.create": KillSwitchStatePatch.optional(),
    "email.outbound": KillSwitchStatePatch.optional(),
    errorTracking: KillSwitchStatePatch.optional(),
    "linkScanning.rescans": KillSwitchStatePatch.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Change at least one kill switch.",
  });
export type KillSwitchesInput = z.infer<typeof KillSwitchesInput>;

/** The shipped defaults. BILLING and CUSTOM DOMAINS ship OFF — turning them on
 *  is an explicit operator act, and (with fail-closed) an unreadable store is
 *  then indistinguishable from "never turned on", which is the safe reading for
 *  a paid feature. email.outbound, errorTracking and linkScanning.rescans ship
 *  ON: these gate cost-incurring background work whose default-off would break
 *  a fresh deploy's mail and error reporting, so their failure mode keeps the
 *  shipped behaviour and only an explicit operator OFF stops them.
 *
 *  Caps ship generous-but-finite: a real stop is the operator lowering them,
 *  while the default never gets in the way of normal traffic. */
export const DEFAULT_KILL_SWITCHES: KillSwitchesSetting = {
  "billing.checkout": { on: false },
  "billing.planChanges": { on: false },
  "billing.coupons": { on: false },
  "billing.trials": { on: false },
  "billing.refunds": { on: false },
  "customDomains.create": { on: false, domainCaps: { totalMax: 10_000, perDay: 500 } },
  "email.outbound": { on: true, emailCaps: { perHour: 5_000, perDay: 50_000 } },
  errorTracking: { on: true, errorCaps: { sampleRate: 1 } },
  "linkScanning.rescans": { on: true },
};

/** Why a kill-switch-gated action was refused, as a STABLE code so the admin
 *  panel and the audit trail can count and filter refusals without parsing
 *  prose. Each refusal records a row on the platform audit trail with action
 *  `admin.killswitch.refused` and this code as a target.
 *
 *   - feature_off       — the feature's switch is OFF (or fail-closed OFF): the
 *                         new action is refused and NOTHING changes. Carries the
 *                         switch key so the operator sees which one.
 *   - cap_reached       — an action's hard cap would be exceeded by this
 *                         (the N+1th) action. The action is refused; prior
 *                         actions stand.
 */
export const KillSwitchRefusalReason = z.enum(["feature_off", "cap_reached"]);
export type KillSwitchRefusalReason = z.infer<typeof KillSwitchRefusalReason>;

/** A human label per switch, for the admin page's row and the refusal message.
 *  Kept beside the keys so the UI and the server name a switch the same way. */
export const KILL_SWITCH_LABELS: Record<KillSwitchKey, string> = {
  "billing.checkout": "Billing — new subscriptions & upgrades",
  "billing.planChanges": "Billing — owner/admin plan changes",
  "billing.coupons": "Billing — coupon redemption",
  "billing.trials": "Billing — new trials",
  "billing.refunds": "Billing — admin refunds",
  "customDomains.create": "Custom domains — add a domain",
  "email.outbound": "Outbound email (auth-critical mail bypasses, still capped)",
  errorTracking: "Error tracking (Sentry) events",
  "linkScanning.rescans": "Background link rescans",
};

/** The PATCH /admin/killswitches body: the switch changes plus a REQUIRED,
 *  non-empty `reason` (the issue requires a reason on every change). The reason
 *  is recorded on the audit row so the admin page's change history explains why
 *  each switch moved, not just what moved. */
export const KillSwitchesPatchBody = KillSwitchesInput.and(
  z.object({
    /** Why the operator made this change — required, recorded in the audit log,
     *  shown in the page's change history. */
    reason: z.string().trim().min(1, "A reason is required.").max(500),
  }),
);
export type KillSwitchesPatchBody = z.infer<typeof KillSwitchesPatchBody>;

/** Fold a partial kill-switch change onto the current full set, one key and one
 *  field at a time: a change to `on` leaves the caps alone, a change to a cap
 *  leaves `on` alone, and a key not mentioned is untouched. This is what the
 *  admin PATCH applies so an operator can flip a switch without restating its
 *  caps. Pure, so the API and a test fold identically. The `reason` is NOT a
 *  switch field and is ignored here (the caller records it on the audit row). */
export function foldKillSwitchChanges(
  current: KillSwitchesSetting,
  changes: KillSwitchesInput,
): KillSwitchesSetting {
  const next = structuredClone(current);
  for (const key of KILL_SWITCH_KEYS) {
    const patch = changes[key];
    if (!patch) continue;
    const state = next[key];
    if (patch.on !== undefined) state.on = patch.on;
    if (patch.domainCaps !== undefined) state.domainCaps = patch.domainCaps;
    if (patch.emailCaps !== undefined) state.emailCaps = patch.emailCaps;
    if (patch.errorCaps !== undefined) state.errorCaps = patch.errorCaps;
  }
  return next;
}

/** The effective kill-switch state the admin page renders: the values, the
 *  defaults (for a "reset" / "default: X" column), who last changed them and
 *  when, and the cache TTL in milliseconds so the UI can show "effective state,
 *  refreshes in N s". */
export const KillSwitchesView = z.object({
  values: KillSwitchesSetting,
  defaults: KillSwitchesSetting,
  /** ISO-8601 of the last change, or null when never set (running on defaults). */
  updatedAt: z.string().nullable(),
  /** The admin who last changed them (email), or null when never set. */
  updatedBy: z.string().nullable(),
  /** The runtime cache window in ms, so the UI can show the TTL. */
  cacheTtlMs: z.number().int(),
});
export type KillSwitchesView = z.infer<typeof KillSwitchesView>;
