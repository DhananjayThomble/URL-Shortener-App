# SnapURL — Billing invariants (steering)

Plans are money. These rules bind every change to the billing, plans and
subscription code. The plan-write guard (`scripts/plan-write-guard.mjs`) enforces
the first rule in CI.

## A plan moves only on a verified webhook
- `workspaces.plan` and `subscriptions.planKey`/`interval` change ONLY on a
  provider-verified webhook. `BillingService.handleWebhook` is the one path that
  moves a plan, and it applies a change only when the event (from
  `provider.verifyWebhook`, non-null) reports the subscription on the target's
  provider plan id.
- Any new write to those columns must be reviewed into
  `scripts/plan-write-allow.json` with WHY it is safe. The guard reds an
  unlisted write.

## The pending pattern — record the request, not the entitlement
- An owner or admin plan change records the target in
  `pendingPlanKey`/`pendingInterval` and leaves `planKey`/`interval` untouched.
  The webhook applies the pending change on a provider-confirmed match and
  clears it. Never write `planKey`/`interval` from a request handler.

## Admin comp vs charge
- An admin **comp** (label grant, no payment) is refused with a **409** on a
  workspace with an active/trialing provider subscription — the next webhook
  would re-mirror the subscription's own plan and undo it. A subscribed
  workspace needs a provider-backed **charge** (drives the provider, applies on
  the webhook), not a label move.

## Kill switches and caps
- Every paid feature sits behind a kill switch, and the caps default **OFF** (no
  silent spend). Test stacks turn them on with generous caps; production ships
  them off — never flip a production default to make a test pass.
- **Verified webhook ingest is never switched off.** It is the only path that
  keeps local state in step with the provider; a kill switch over it would strand
  plans.

## Secrets & split PRs
- Razorpay keys live only in the gitignored env (SSM/Secrets Manager in a real
  deploy). Never commit a key or a real `.env`.
- A PR that is one slice of a split billing epic never carries a closing keyword
  (`Closes #…`) for the parent issue — only the final slice closes it.
