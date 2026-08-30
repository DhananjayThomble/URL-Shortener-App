import type { CacheStore } from "@snapurl/cache";
import {
  normaliseHost,
  type LinkResolver,
  type ResolvedDomain,
  type ResolvedLink,
} from "./resolver.js";

/* ============================================================
   CachingLinkResolver — a short-lived cache in front of the DB.

   PostgresLinkResolver hits the database on every redirect. The
   overwhelming majority of redirects are for a small set of hot
   links, so a short-lived cached ResolvedLink lets the hot path
   answer without touching Postgres at all.

   Bounded staleness, on purpose. The product promise is "print it
   once, change where it points forever": an edited link must not
   keep serving the old destination for long. So the TTL is short
   (seconds, env-tunable via LINK_CACHE_TTL_SECONDS) and this
   decorator never invalidates on edit itself. Proper
   edit-invalidation — the API busting the cache key when a link
   changes — is the projection/outbox's job and a follow-up; until
   then the short TTL is the whole guarantee, and a few seconds of
   staleness on a just-edited link is the accepted trade for taking
   the database out of the hot path.

   What this decorator does NOT touch: click recording. main.ts
   still calls record() per request after resolve(), so caching the
   resolve changes nothing about how clicks are counted — the
   integration assertions of exactly one click_events row per
   redirect and the click_daily rollup are unaffected.

   One interaction to keep in mind: the cached ResolvedLink includes
   link.clicks, which is frozen at cache-write time for the whole TTL.
   gateFor() reads that field for the click-limit cap, so on a cache
   hit the count it sees is up to LINK_CACHE_TTL_SECONDS stale on top
   of the pre-existing rollup lag (gateFor's own comment already notes
   the cap can overshoot "by a handful under concurrency"). This is a
   deliberate trade: the whole ResolvedLink is cached as one shape so
   callers get an identical link on hit and miss, and the short TTL
   keeps the widened overshoot bounded. Time-based gates (expiry,
   activation) are NOT frozen — they are evaluated against Date.now()
   at request time from the revived Date fields, so only the click
   count carries this staleness, not the expiry decision.

   Only positive hits are cached. Caching a miss (null) would make a
   link created just after a lookup 404 until the negative entry
   expired, which is a worse failure than one uncached DB read, so
   misses always fall through to the inner resolver.
   ============================================================ */

/** The JSON shape a ResolvedLink serialises to: Date fields become
 *  ISO strings (or null), everything else round-trips as-is. */
type CachedLink = Omit<ResolvedLink, "expiresAt" | "activatesAt"> & {
  expiresAt: string | null;
  activatesAt: string | null;
};

export class CachingLinkResolver implements LinkResolver {
  constructor(
    private readonly inner: LinkResolver,
    private readonly cache: CacheStore,
    private readonly ttlSeconds: number,
  ) {}

  async resolve(host: string, slug: string): Promise<ResolvedLink | null> {
    // Key on the SAME normalisation the DB lookup uses, so a printed
    // "SNAP.TO/Foo" and a header "snap.to/foo" share one cache entry.
    const key = `link:${normaliseHost(host)}:${slug.toLowerCase()}`;

    const cached = await this.cache.get(key);
    if (cached !== null) {
      return reviveLink(JSON.parse(cached) as CachedLink);
    }

    const link = await this.inner.resolve(host, slug);
    // Only cache positive hits (see the header note on negative caching).
    if (link !== null) {
      await this.cache.set(key, JSON.stringify(link), this.ttlSeconds);
    }
    return link;
  }

  /* Domain lookups (root/not-found redirects) are not the hot per-slug
     path, and their misses are the common case anyway, so they pass
     straight through to the inner resolver without caching. */
  async resolveDomain(host: string): Promise<ResolvedDomain | null> {
    return this.inner.resolveDomain(host);
  }
}

/** Revive a cached link: JSON.stringify turned the Date fields into ISO
 *  strings, so parse them back to Date, preserving null exactly. */
function reviveLink(cached: CachedLink): ResolvedLink {
  return {
    ...cached,
    expiresAt: cached.expiresAt === null ? null : new Date(cached.expiresAt),
    activatesAt: cached.activatesAt === null ? null : new Date(cached.activatesAt),
  };
}
