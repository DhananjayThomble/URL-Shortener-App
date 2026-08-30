import { describe, expect, it } from "vitest";
import { isTransientPartitionRoutingError, postgresErrorCode } from "./postgres-errors.js";

/* ============================================================
   Recognising the one insert failure that is worth retrying.

   The detector has to be narrow. 23514 is what *any* CHECK
   constraint raises, and retrying one of those would burn a
   round trip to arrive at the same answer. So the message is
   checked too, and these tests pin both halves — including that
   a plain check violation is NOT retried, which is the assertion
   that stops the detector quietly widening later.
   ============================================================ */

/** How the error actually arrives: Drizzle wraps the driver error and the
 *  SQLSTATE sits on `.cause`. Every case here goes through that shape rather
 *  than a bare object, because a detector that only works on the unwrapped
 *  error is the original bug this walk exists to prevent. */
const wrapped = (code: string, message: string) =>
  Object.assign(new Error("Failed query: insert into click_events"), {
    cause: Object.assign(new Error(message), { code }),
  });

describe("isTransientPartitionRoutingError", () => {
  it("matches a row that lost its race with a concurrent ATTACH", () => {
    // The measured failure: the router picked the default, an ATTACH for that
    // row's day committed, and the constraint was evaluated after it.
    const err = wrapped(
      "23514",
      'new row for relation "click_events_default" violates partition constraint',
    );
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("matches a row with nowhere to go", () => {
    // Only reachable if the DEFAULT partition is missing, but a retry is still
    // the right response: a provisioning pass may have just created the day.
    const err = wrapped("23514", 'no partition of relation "click_events" found for row');
    expect(isTransientPartitionRoutingError(err)).toBe(true);
  });

  it("does NOT match an ordinary check constraint violation", () => {
    /* The assertion that keeps the detector narrow. 23514 is shared with every
       CHECK constraint, and retrying a genuinely invalid row would cost a round
       trip to fail identically — while making a real data problem look
       intermittent. */
    const err = wrapped("23514", 'new row for relation "workspaces" violates check constraint "retention_years_check"');
    expect(isTransientPartitionRoutingError(err)).toBe(false);
  });

  it("does not match other SQLSTATEs, even with a partition-shaped message", () => {
    // Code and message both have to agree, so a message that happens to mention
    // partitions cannot drag an unrelated failure into the retry path.
    expect(isTransientPartitionRoutingError(wrapped("23505", "violates partition constraint"))).toBe(false);
    expect(isTransientPartitionRoutingError(wrapped("42P01", "no partition of relation found"))).toBe(false);
  });

  it("finds the code through several levels of wrapping", () => {
    const deep = {
      message: "outer",
      cause: { message: "middle", cause: { code: "23514", message: "violates partition constraint" } },
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
