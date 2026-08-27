import { dailySalts, eq, type Database } from "@snapurl/database";
import { generateDailySalt, saltDateKey } from "@snapurl/domain";

/* The rotating salt behind every visitor hash.

   Cached in memory for the process lifetime of the current day: this is read
   on every single redirect, and a database round trip per click would defeat
   the point of keeping the hot path off Postgres.

   The row is created on first use rather than by a scheduled job, so a fresh
   deployment works on its first request with nothing to set up. */
export class DailySaltCache {
  private cachedDay: string | null = null;
  private cachedSalt: string | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly db: Database) {}

  async today(): Promise<string> {
    const day = saltDateKey();
    if (this.cachedDay === day && this.cachedSalt) return this.cachedSalt;

    // Collapse the stampede when many requests cross midnight together.
    this.inFlight ??= this.load(day).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(day: string): Promise<string> {
    const [existing] = await this.db.select().from(dailySalts).where(eq(dailySalts.day, day)).limit(1);
    if (existing) {
      this.cachedDay = day;
      this.cachedSalt = existing.salt;
      return existing.salt;
    }

    const salt = generateDailySalt();
    await this.db.insert(dailySalts).values({ day, salt }).onConflictDoNothing();

    // Another instance may have won the race; re-read so every instance agrees.
    const [row] = await this.db.select().from(dailySalts).where(eq(dailySalts.day, day)).limit(1);
    const winner = row?.salt ?? salt;
    this.cachedDay = day;
    this.cachedSalt = winner;
    return winner;
  }
}
