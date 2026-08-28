import { db, runFrequent, runMaintenance } from "./main.js";

/* The worker as a scheduled Lambda.
 *
 * `main.ts` already had a `--once` mode written for exactly this, so there is
 * no separate job composition here to drift out of step with the long-running
 * process — both call the same two functions.
 *
 * `db` is module-level on purpose. Lambda reuses a warm container across
 * invocations, so the connection survives between runs rather than being
 * rebuilt every minute. It is deliberately not closed at the end of a call:
 * closing it would make the next warm invocation reconnect for nothing. */
export const handler = async () => {
  const frequent = await runFrequent(db);
  const maintenance = await runMaintenance(db);
  return { frequent, maintenance };
};
