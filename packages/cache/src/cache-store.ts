/* ============================================================
   CacheStore — one port, three problems.

   Three separate needs in the product share the same shape of
   storage and, until now, had no common seam:

     1. Hot-link caching. The redirect path reads Postgres on
        every request; a short-lived cached ResolvedLink lets it
        answer without touching the database.
     2. Rate-limit counters. A fixed-window counter that must be
        shared across instances, so the effective limit is the
        configured limit and not (limit x instances). That is
        what `incr` with a first-write expiry is for.
     3. Unique-visitor sketch merging. The HyperLogLog sketch in
        @snapurl/domain is merged register-wise; `mergeSketch`
        does that over stored bytes.

   This is behind a port on purpose, following the same
   port-and-adapter seam as resolver.ts and analytics.reader.ts.
   The single-node profile uses the in-memory adapter, the scaled
   profile uses Redis, and the AWS serverless profile uses
   DynamoDB. All three return the same shapes, so nothing
   downstream knows or cares which one it got.

   Conventions shared by every method:
     - keys are opaque utf-8 strings chosen by the caller;
     - string values are utf-8 strings;
     - sketch values are raw HLL bytes (exactly HLL_BYTE_SIZE,
       the fixed 16 KiB @snapurl/domain layout), NOT Redis's own
       PFADD/PFMERGE format, so the byte format is identical
       across all three adapters and portable between profiles;
     - ttlSeconds, when present, is a whole number of seconds of
       time-to-live measured from the moment of the write.
   ============================================================ */

export interface CacheStore {
  /**
   * Read a string value. Returns null when the key is absent or has
   * expired. Sketch keys (written via mergeSketch) are not string
   * values and must not be read with get.
   */
  get(key: string): Promise<string | null>;

  /**
   * Write a string value, optionally with a time-to-live. When
   * ttlSeconds is omitted the value has no expiry. A set always
   * replaces both the value and its expiry (unlike incr, which only
   * sets the expiry on first write).
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Atomically increment an integer counter and return the NEW count.
   * The key is created at 1 on first increment; subsequent increments
   * return 2, 3, ...
   *
   * This is the fixed-window rate-limit primitive: when the key is
   * first created, and ttlSeconds is given, its expiry is set to
   * ttlSeconds. A later increment WITHIN the same window must NOT
   * reset that expiry, or the window would never close under
   * sustained traffic. The atomicity (increment and first-write
   * expiry as one step) matters so a window is never lost between the
   * increment and the expiry under concurrency.
   */
  incr(key: string, ttlSeconds?: number): Promise<number>;

  /**
   * Set or update the time-to-live of an existing key. A no-op shape
   * when the key is absent (adapters differ in whether they create
   * it; callers should only expire keys they know exist).
   */
  expire(key: string, ttlSeconds: number): Promise<void>;

  /** Delete a key and its value/expiry. Absent keys are a no-op. */
  del(key: string): Promise<void>;

  /**
   * Return the remaining time-to-live of a key in MILLISECONDS, or a
   * negative number when the key is absent or has no expiry.
   *
   * This mirrors Redis PTTL semantics: -2 when the key does not exist,
   * -1 when it exists but has no associated expiry. The rate-limit
   * throttler uses it to report an accurate timeToExpire for the
   * fixed window (the count is bumped by incr, the remaining window is
   * read by pttl), rather than approximating it from the configured
   * ttl on every hit.
   */
  pttl(key: string): Promise<number>;

  /**
   * Merge the given HLL sketch register-wise into the sketch stored at
   * key and return the current estimate.
   *
   * The stored bytes (or a fresh empty sketch when the key is absent)
   * are merged with the incoming sketch using @snapurl/domain `merge`
   * (register-wise max, which is idempotent and commutative), the
   * merged bytes are persisted, and the estimate is computed via
   * @snapurl/domain `estimate`. On first write the expiry is set from
   * ttlSeconds, matching the incr convention.
   *
   * The incoming sketch must be exactly HLL_BYTE_SIZE bytes; the
   * stored bytes use the same layout, so a sketch written by one
   * adapter can be read and merged by any other.
   */
  mergeSketch(
    key: string,
    sketch: Uint8Array,
    ttlSeconds?: number,
  ): Promise<{ estimate: number }>;
}

/**
 * The one place the redirect's hot-link cache key format is defined.
 *
 * apps/redirect's CachingLinkResolver computes this key when it reads
 * (cache hit/miss), and the API computes the SAME key when it needs to bust
 * a specific link's entry after a delete or an abuse flag (#470, #426) — so
 * the two sides cannot silently disagree about which key names a given
 * link's cache entry. Both must normalise identically: lowercase + trim the
 * host (a link created against "SNAP.TO" must resolve, and be busted, from a
 * request whose Host header is "snap.to"), and lowercase the slug.
 *
 * This mirrors @snapurl/database's normaliseHost exactly, but is NOT
 * imported from there: @snapurl/cache has no dependency on
 * @snapurl/database (and must not gain one — see architecture.md's package
 * boundaries), so the same trivial normalisation is defined here as the
 * cache-key format's own concern, independent of how the DB layer resolves a
 * host lookup.
 *
 * The separator is "|", not ":" — a host is a DNS name and a slug is
 * restricted to [a-zA-Z0-9._-] by isSlugAvailableShape, so neither can ever
 * contain either character today, but "|" additionally guards against a
 * host containing ":" (a non-default port in a Host header, e.g.
 * "localhost:3002") shifting the boundary and colliding two different
 * (host, slug) pairs into the same key.
 */
export function linkCacheKey(host: string, slug: string): string {
  return `link:${host.toLowerCase().trim()}|${slug.toLowerCase()}`;
}
