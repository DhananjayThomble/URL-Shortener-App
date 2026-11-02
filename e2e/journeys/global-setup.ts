/**
 * Journeys global setup (#977 / #1022).
 *
 * Runs ONCE before any journey spec in the shard, before the first test triggers
 * a kill-switch read on the API. #1022's kill switches ship customDomains.create
 * (and the billing switches) OFF by default, so a fresh staging DB refuses
 * POST /domains with a 503 and every custom-domain journey reds.
 *
 * The API reads kill switches through a 60s-TTL cache (PlatformSettingsService):
 * a per-spec DB seed can land AFTER a sibling spec's read has already cached the
 * OFF default, so the domain spec still sees OFF until the cache expires. Seeding
 * here — before the shard's first kill-switch read — makes the first (and every
 * later) cache load read the ON row, and nothing in the suite ever flips it back,
 * so it stays on for the whole run. Production ships OFF by design; this only
 * turns it on for the staging platform the journeys drive.
 */
import { enableCustomDomains } from "./helpers";

export default async function globalSetup(): Promise<void> {
  await enableCustomDomains();
}
