import { dailySalts, eq, type Database } from "@snapurl/database";
import { generateDailySalt, saltDateKey } from "@snapurl/domain";
import type { CacheStore } from "@snapurl/cache";

/* The rotating salt behind every visitor hash.

   Every redirect needs today's salt to compute a visitorHash, so this is on
   the hot path of every single click. There are two sources, chosen by the
   same profile split as the resolver and the click sink:

     - PostgresSaltCache: the daily_salts table (single-node / k8s / compose,
       and the AWS profile whenever the redirect still holds a Postgres handle).
       This is the original behaviour, unchanged.
     - CacheStoreSaltCache: the shared CacheStore, which on the AWS profile is
       DynamoDB. This is what lets the redirect leave the VPC: under
       LINK_PROJECTION=dynamo + CLICK_SINK=sqs the redirect resolves from
       DynamoDB, sends clicks to SQS and reads the salt from DynamoDB — all
       public AWS endpoints — so it opens no Postgres connection at all.

   Both cache the salt in memory for the process lifetime of the current day:
   this is read on every single redirect, and a round trip per click would
   defeat the point of keeping the hot path off the backing store. The
   in-memory day cache + single-flight stampede guard are shared by both via
   the base class; only the load-from-store step differs. */
export interface SaltSource {
  today(): Promise<string>;
}

abstract class CachingSaltSource implements SaltSource {
  private cachedDay: string | null = null;
  private cachedSalt: string | null = null;
  private inFlight: Promise<string> | null = null;

  async today(): Promise<string> {
    const day = saltDateKey();
    if (this.cachedDay === day && this.cachedSalt) return this.cachedSalt;

    // Collapse the stampede when many requests cross midnight together.
    this.inFlight ??= this.load(day)
      .then((salt) => {
        this.cachedDay = day;
        this.cachedSalt = salt;
        return salt;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Read (creating on first use) today's salt from the backing store. */
  protected abstract load(day: string): Promise<string>;
}

export class PostgresSaltCache extends CachingSaltSource {
  constructor(private readonly db: Database) {
    super();
  }

  /* The row is created on first use rather than by a scheduled job, so a fresh
     deployment works on its first request with nothing to set up. */
  protected async load(day: string): Promise<string> {
    const [existing] = await this.db.select().from(dailySalts).where(eq(dailySalts.day, day)).limit(1);
    if (existing) return existing.salt;

    const salt = generateDailySalt();
    await this.db.insert(dailySalts).values({ day, salt }).onConflictDoNothing();

    // Another instance may have won the race; re-read so every instance agrees.
    const [row] = await this.db.select().from(dailySalts).where(eq(dailySalts.day, day)).limit(1);
    return row?.salt ?? salt;
  }
}

/* Backwards-compatible alias: DailySaltCache was the only salt source before
   the AWS profile could leave Postgres, and main.ts / any test that named it
   keeps working. */
export const DailySaltCache = PostgresSaltCache;

/* The salt in the shared CacheStore (DynamoDB on the AWS profile).

   The key is namespaced and dated ("salt#<day>") and the value carries a TTL
   that comfortably outlives one day. This is a SHARED store on the AWS profile
   (DynamoDB, provisioned by the CDK as CacheTable with CACHE_DRIVER=dynamodb on
   the redirect), so once today's salt is written every instance reads the same
   value back — load() re-reads after its own write to converge even on a race
   (see below) — and each instance caches it in memory for the rest of the day.
   That shared invariant is the whole reason the redirect can leave the VPC
   without fragmenting the salt per-instance. The salt is discarded when the
   key expires, preserving the privacy promise — yesterday's hashes stay
   un-recomputable — and the TTL is what retires an old day's salt here (the
   worker's rotateSalts still governs the Postgres daily_salts table on the
   profiles that use it).

   The one race is the first request of a new day arriving at two cold
   instances at once: both find the key absent and each writes its own salt.
   load() closes this the same way PostgresSaltCache.load does — it re-reads the
   key AFTER writing and returns whatever value the store now holds, so both
   racers converge on the SAME salt (the store keeps whichever set() it applied,
   and every instance reads that one back) rather than each keeping its own for
   the day. The residual window is only the instant between the two sets, and it
   is the SAME bounded imprecision the "no cookies" promise already documents
   ("a visitor who changes network counts twice"): it only affects unique
   counting, never a redirect's correctness.

   The re-read is best-effort convergence, not a lock: set() is a last-write-wins
   overwrite (not an atomic SETNX — the CacheStore port has no first-write
   primitive), so two sets racing to the microsecond can still land in either
   order, but both instances then read back the surviving value and agree. A
   true SETNX would make the winner deterministic, but adding one for a
   once-a-day cold-start window is not worth the port surface area. */
const SALT_KEY_PREFIX = "salt#";
/* Two days: long enough that a salt written just before midnight is still
   present for the whole of its own day even accounting for clock skew, short
   enough that a day's salt does not linger past its usefulness. */
const SALT_TTL_SECONDS = 2 * 24 * 60 * 60;

export class CacheStoreSaltCache extends CachingSaltSource {
  constructor(private readonly store: CacheStore) {
    super();
  }

  protected async load(day: string): Promise<string> {
    const key = SALT_KEY_PREFIX + day;
    const existing = await this.store.get(key);
    if (existing) return existing;

    const salt = generateDailySalt();
    await this.store.set(key, salt, SALT_TTL_SECONDS);

    /* Re-read after the write so every instance converges on the shared value,
       mirroring PostgresSaltCache's re-read after onConflictDoNothing: if
       another instance's set() for this key landed, we read theirs back and
       agree rather than keeping our own for the day. Falls back to our own salt
       only if the read somehow returns empty (never expected right after a
       write), so a new day always yields a usable salt. */
    const shared = await this.store.get(key);
    return shared ?? salt;
  }
}
