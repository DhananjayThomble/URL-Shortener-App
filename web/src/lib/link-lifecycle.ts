import type { Link } from "./api/types";
import { plural } from "./plural";
import { compact, formatDate } from "./utils";

/* The expiry / schedule summary a link row shows in its details line (#760).
 *
 * It is decided from the link's own schedule fields and the clock, never from
 * `link.status`. An archived link's status is just "archived" — the API's
 * `deriveStatus` returns that first — so reading the status here made every
 * archived link look like it had no schedule at all: a link set to go live next
 * week printed "Never expires" in the Archived filter, and printed its date again
 * the moment it was unarchived. Archiving moves a link out of the active lists;
 * it does not change when the link goes live or stops working.
 *
 * The comparisons deliberately mirror `deriveStatus` in packages/domain
 * (`activatesAt > now` is scheduled, `expiresAt <= now` is expired, a reached
 * click limit is expired), and link-lifecycle.test.ts checks them against it. */

export type LifecycleFields = Pick<Link, "activatesAt" | "expiresAt" | "clickLimit" | "clicks">;

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function lifecycleSummary(
  link: LifecycleFields,
  now: Date = new Date(),
  fmt: (iso: string) => string = formatDate,
): string {
  const limitReached = link.clickLimit != null && link.clicks >= link.clickLimit;
  if (limitReached && link.clickLimit) return `Expired after ${plural(link.clickLimit, "click", { format: compact })}`;

  const expires = parse(link.expiresAt);
  if (expires && expires.getTime() <= now.getTime()) return `Expired ${fmt(link.expiresAt as string)}`;

  /* A link that has not started yet is described by when it starts. Leading
     with "Never expires" on something that does not work yet reads as though
     it does. */
  const activates = parse(link.activatesAt);
  if (activates && activates.getTime() > now.getTime()) return `Goes live ${fmt(link.activatesAt as string)}`;

  if (expires) return `Expires ${fmt(link.expiresAt as string)}`;
  if (link.clickLimit) return `Expires after ${plural(link.clickLimit, "click", { format: compact })}`;
  return "Never expires";
}
