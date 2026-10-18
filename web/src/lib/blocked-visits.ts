/* #767 — what the Analytics "blocked" tile counts.

   `totals.blocked` is sum(click_daily.blocked) (apps/worker/src/jobs/rollup.ts):
   every visit the redirect's gate rejected AND recorded, whatever the reason.
   The rollup keeps no per-reason split, so the tile is worded for the whole set
   instead of claiming only Safe Browsing blocks. Keys are the exact values
   `gateFor` returns in apps/redirect/src/main.ts; blocked-visits.test.ts fails
   if the redirect gains or drops a reason without this map following. */

export const BLOCKED_REASON_TERMS = {
  expired: "Expired",
  scheduled: "scheduled",
  click_limit: "over limit",
  archived: "archived",
  flagged: "unsafe",
} as const;

export const BLOCKED_VISITS_LABEL = "Blocked visits";

/** "Expired, scheduled, over limit, archived or unsafe" */
export const BLOCKED_VISITS_CAPTION = (() => {
  const terms = Object.values(BLOCKED_REASON_TERMS);
  return `${terms.slice(0, -1).join(", ")} or ${terms[terms.length - 1]}`;
})();
