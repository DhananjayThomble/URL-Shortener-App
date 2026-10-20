import { linkCounters, sql, type Database } from "@snapurl/database";

/* ============================================================
   The ATOMIC click-limit gate (#763).

   The problem it fixes. The ordinary gate (effectiveGate in @snapurl/domain,
   called from main.ts's gateFor) compares a link's clickLimit against
   link_counters.clicks — the ROLLUP's count, recomputed once a minute and
   frozen for another LINK_CACHE_TTL_SECONDS on a cache hit. Under a burst that
   count lags, so a hard cap can be overshot: a clickLimit of 2 lets 3–4
   visitors through before the rollup catches up. That is fine for a dashboard
   number; it is wrong for a HARD cap the product promises to enforce.

   The fix, and its scope. For links that HAVE a clickLimit, the redirect
   reserves each click atomically against a dedicated link_counters.reserved
   counter in a single statement, BEFORE routing. A link with NO clickLimit
   (the overwhelming majority) never calls this at all — its hot path stays the
   exact zero-extra-write resolve-and-redirect it has always been. See
   docs/DECISIONS.md (#763) for the trade-off.

   Why a port. The redirect runs in several profiles (main.ts). On every
   Postgres-backed profile (local, compose, single-node, Kubernetes) the atomic
   reserve is a one-statement UPDATE and PostgresClickReservation does it. On
   the AWS serverless profile the redirect can run with NO Postgres connection
   at all (LINK_PROJECTION=dynamo + CLICK_SINK=sqs), so the atomic Postgres
   reserve is simply not available there; NoopClickReservation preserves that
   profile's EXISTING cached-count behaviour unchanged rather than pretending to
   a guarantee it cannot make. (The AWS profile already keeps every limited link
   OFF the CloudFront edge fast path — see isEdgeEligible — so limited links are
   always resolved by the Lambda; giving THAT path a DynamoDB atomic counter is
   a separate, larger change than this issue scopes.)
   ============================================================ */

/** The verdict of an atomic reservation attempt for one click. */
export type Reservation =
  /** The click was reserved: it is within the limit and may proceed to routing. */
  | { readonly ok: true }
  /** The limit is already reached: this click must be refused (410 click_limit). */
  | { readonly ok: false }
  /** No atomic reservation is available on this profile — the caller must fall
   *  back to the ordinary (cached-count) gate. Distinct from `ok:false` so a
   *  Noop never turns a live link into a 410. */
  | { readonly unavailable: true };

export interface ClickReservation {
  /** Atomically reserve one click against `limit` for `linkId`. Called ONLY for
   *  links whose clickLimit is non-null. */
  reserve(linkId: string, limit: number): Promise<Reservation>;
}

/* The Postgres atomic reserve.

   One statement, no read-then-write race. The INSERT seeds the counter row for
   a link that has none yet (a brand-new link the rollup has not touched); the
   ON CONFLICT path increments an existing row. The crucial part is the WHERE on
   the DO UPDATE: `reserved < limit` is evaluated by Postgres while it holds the
   row's write lock, so concurrent reservations serialise and only the first
   `limit` of them satisfy the predicate. The rest update zero rows, RETURNING
   comes back empty, and the gate refuses the click — with no stale-cache
   window, because this reads and writes the live row inside one lock.

   `reserved` is maintained ONLY here. The rollup's upsert sets clicks and
   unique_clicks and never mentions reserved, so a rollup pass cannot reset or
   inflate the reservation tally. A clickLimit of 0 ("no clicks allowed")
   correctly reserves nothing: 0 < 0 is false, and the seed INSERT's RETURNING
   is likewise gated, so the first caller is refused too.

   limit is a bound integer from the link row (never user-typed free text) and
   is passed as a parameter, not interpolated. */
export class PostgresClickReservation implements ClickReservation {
  constructor(private readonly db: Database) {}

  async reserve(linkId: string, limit: number): Promise<Reservation> {
    const rows = await this.db.execute<{ reserved: number }>(sql`
      insert into ${linkCounters} (link_id, reserved)
      select ${linkId}, 1 where ${limit} >= 1
      on conflict (link_id) do update
        set reserved = ${linkCounters.reserved} + 1
        where ${linkCounters.reserved} < ${limit}
      returning ${linkCounters.reserved} as reserved
    `);
    /* Exactly one row comes back iff the click was reserved within the cap:
       - a brand-new link seeds reserved=1, but ONLY when limit >= 1 (the
         `where` on the INSERT's SELECT), so a clickLimit of 0 inserts nothing
         and the first caller is refused with no stray row written;
       - an existing row increments under its write lock only while
         reserved < limit, so the (limit+1)th concurrent caller matches zero
         rows and RETURNING is empty.
       No row returned => refuse (410). */
    return rows.length > 0 ? { ok: true } : { ok: false };
  }
}

/* The no-Postgres fallback. Returns `unavailable` so main.ts falls back to the
   ordinary cached-count gate exactly as the AWS/dynamo profile behaved before
   #763 — never a false 410. */
export class NoopClickReservation implements ClickReservation {
  async reserve(): Promise<Reservation> {
    return { unavailable: true };
  }
}
