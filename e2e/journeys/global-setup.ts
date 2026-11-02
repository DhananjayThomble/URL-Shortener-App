/**
 * Journeys global setup (#977 / #1022).
 *
 * Runs ONCE before any journey spec in the shard, before the first test triggers
 * a kill-switch read on the API. #1022's kill switches ship customDomains.create
 * (and the billing switches) OFF by default, so a fresh staging DB refuses
 * POST /domains with a 503 and every custom-domain journey reds.
 *
 * #1030 then made the defaults conservative hard limits (25 domains total / 5 a
 * day, 200 emails an hour), so even ON a bare switch 403s on the 6th domain. The
 * seed turns the switches ON with GENEROUS caps so the harness never hits them.
 *
 * The API reads kill switches through a 60s-TTL cache (PlatformSettingsService):
 * a per-spec DB seed can land AFTER a sibling spec's read has already cached the
 * OFF default, so the domain spec still sees OFF until the cache expires. Seeding
 * here — before the shard's first kill-switch read — makes the first (and every
 * later) cache load read the ON row, and nothing in the suite ever flips it back,
 * so it stays on for the whole run. Production ships OFF with tight caps by
 * design; this only loosens the staging platform the journeys drive, and the
 * global teardown drops the row so it never leaks to another run.
 */
import { enableCustomDomains } from "./helpers";

export default async function globalSetup(): Promise<void> {
  await enableCustomDomains();
}
