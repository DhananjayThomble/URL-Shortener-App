import type { Link } from "./api/types";
import { compact, formatDate } from "./utils";

/* The expiry / schedule summary a link row shows in its details line. */

export type LifecycleFields = Pick<Link, "status" | "activatesAt" | "expiresAt" | "clickLimit" | "clicks">;

export function lifecycleSummary(
  link: LifecycleFields,
  _now: Date = new Date(),
  fmt: (iso: string) => string = formatDate,
): string {
  /* A link that has not started yet is described by when it starts. Leading
     with "Never expires" on something that does not work yet reads as though
     it does. */
  if (link.status === "scheduled" && link.activatesAt) return `Goes live ${fmt(link.activatesAt)}`;
  if (link.expiresAt) return `Expires ${fmt(link.expiresAt)}`;
  if (link.clickLimit) return `Expires after ${compact(link.clickLimit)} clicks`;
  return "Never expires";
}
