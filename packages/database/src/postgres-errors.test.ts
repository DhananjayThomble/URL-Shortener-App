import { describe, expect, it } from "vitest";
import { isTransientPartitionRoutingError, postgresErrorCode } from "./postgres-errors.js";

/* ============================================================
   Recognising the one insert failure that is worth retrying.

   The detector has to be narrow. 23514 is what *any* CHECK
   constraint raises, and two of the four things that raise it
   here are permanent failures. So `routine` is checked too, and
   the negative cases below are the ones that matter: they are
   what stops the check quietly widening later.

   Every fixture is a real observation. The routine names and
   message strings were provoked against Postgres 18.6 and copied
   from its output, not recalled — a detector and its fakes
   written from the same assumption cannot contradict each other,
   and this one is only worth having if it fires in production.
   `partitions.test.ts` pins the same strings against a live
   server so this file cannot drift from reality unnoticed.
   ============================================================ */

/** How the error actually arrives: Drizzle wraps the driver error and the
 *  SQLSTATE sits on `.cause`. Every case here goes through that shape rather
 *  than a bare object, because a detector that only works on the unwrapped
 *  error is the original bug this walk exists to prevent. */
const wrapped = (code: string, message: string, routine?: string) =>
  Object.assign(new Error("Failed query: insert into click_events"), {
    cause: Object.assign(new Error(message), routine ? { code, routine } : { code }),
  });

describe("isTransientPartitionRoutingError", () => {
  it("matches a row that lost its race with a concurrent ATTACH", () => {
    // The measured failure: the router picked the default, an ATTACH for that
    // row's day committed, and the constraint was evaluated after it.
    const err = wrapped(
      "23514",
      'new row for relation "click_events_default" violates partition constraint',
      "ExecPartitionCheckEmitError",
    );
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("matches a row with nowhere to go", () => {
    /* Only reachable with no DEFAULT partition attached — which migration 0007
       makes permanent, so in this schema it should never happen. Retried anyway
       because the cost of being wrong is one round trip, and the alternative is
       dropping a click on the one failure mode nobody predicted. */
    const err = wrapped(
      "23514",
      'no partition of relation "click_events" found for row',
      "ExecFindPartition",
    );
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("does NOT match an ordinary check constraint violation", () => {
    /* 23514 is shared with every CHECK constraint, and retrying a genuinely
       invalid row would cost a round trip to fail identically — while making a
       real data problem look intermittent. */
    const err = wrapped(
      "23514",
      'new row for relation "workspaces" violates check constraint "retention_years_check"',
      "ExecConstraints",
    );
    expect(isTransientPartitionRoutingError(err)).toBe(false);
  });

  it("does NOT match an ATTACH refused because the default already holds the row", () => {
    /* The case that keeps the message test specific. This is a *permanent*
       failure — the fix is to drain the default, not to try again — and its
       message mentions a partition constraint, so a looser needle such as
       `includes("partition")` would sweep it in. Raised by DDL rather than by an
       insert, but `isTransientPartitionRoutingError` is exported from the package
       under a general name, so it should be right for any caller. */
    const err = wrapped(
      "23514",
      'updated partition constraint for default partition "click_events_default" would be violated by some row',
      "ATRewriteTable",
    );
    expect(isTransientPartitionRoutingError(err)).toBe(false);
  });

  it("does not match other SQLSTATEs, even with a partition-shaped message", () => {
    // Code and message both have to agree, so a message that happens to mention
    // partitions cannot drag an unrelated failure into the retry path.
    expect(
      isTransientPartitionRoutingError(wrapped("23505", "violates partition constraint")),
    ).toBe(false);
    expect(
      isTransientPartitionRoutingError(wrapped("42P01", "no partition of relation found")),
    ).toBe(false);
  });

  it("falls back to the message when no routine reaches it", () => {
    /* `routine` is preferred because it is not translated, but it is not
       guaranteed to survive — an error rebuilt from a log, or a driver that drops
       the field, still has to be recognised. */
    const err = wrapped(
      "23514",
      'new row for relation "click_events_default" violates partition constraint',
    );
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("matches on the routine even when the message is not English", () => {
    /* `errmsg()` output is translated through `lc_messages`. RDS and the official
       Docker image both default to English, so today the message check holds —
       but if that ever changed, matching only on text would stop the retry firing
       with nothing failing to say so. */
    const err = wrapped(
      "23514",
      'la nueva fila para la relación "click_events_default" viola la restricción de partición',
      "ExecPartitionCheckEmitError",
    );
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("finds the code through several levels of wrapping", () => {
    const deep = {
      message: "outer",
      cause: {
        message: "middle",
        cause: { code: "23514", message: "violates partition constraint" },
      },
    };
    expect(isTransientPartitionRoutingError(deep)).toBe(true);
  });

  it("returns false for things that are not driver errors", () => {
    expect(isTransientPartitionRoutingError(new Error("just an error"))).toBe(false);
    expect(isTransientPartitionRoutingError(null)).toBe(false);
    expect(isTransientPartitionRoutingError(undefined)).toBe(false);
  });

  it("terminates on a circular cause chain", () => {
    // The walk is depth-bounded; a self-referencing cause must not hang it.
    const a: Record<string, unknown> = { message: "violates partition constraint" };
    a.cause = a;
    expect(postgresErrorCode(a)).toBeNull();
    expect(isTransientPartitionRoutingError(a)).toBe(false);
  });
});
