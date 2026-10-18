import type { AbuseReport, AbuseReportStatus } from "@snapurl/contract";

/** The three things an operator can do to a report from the queue. */
export type ReportAction = "reviewed" | "dismiss" | "flag";

/**
 * The actions worth offering for a report in the given status.
 *
 * An action that would set the status the report already has changes nothing, so
 * it is not offered: a dismissed report kept showing "Dismiss" (#790), and the
 * same held for Reviewed on a reviewed report and Flag link on an actioned one
 * (flagging a link is what makes a report "actioned"). Every status still leaves
 * the others, so a row is never a dead end — a mistaken dismissal can be reopened.
 */
export function reportActions(status: AbuseReportStatus): ReportAction[] {
  const all: [ReportAction, AbuseReportStatus][] = [
    ["reviewed", "reviewed"],
    ["dismiss", "dismissed"],
    ["flag", "actioned"],
  ];
  return all.filter(([, resulting]) => resulting !== status).map(([action]) => action);
}

/**
 * The cached report list with one report swapped for the server's updated copy,
 * order preserved. Lets the queue show the new state as soon as the PATCH answers,
 * instead of waiting for the list refetch that follows. Returns the list unchanged
 * if the report is not in it (or there is no list yet).
 */
export function replaceReport(list: AbuseReport[] | undefined, updated: AbuseReport): AbuseReport[] | undefined {
  if (!list) return list;
  return list.map((r) => (r.id === updated.id ? updated : r));
}
