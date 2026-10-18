import { describe, expect, it } from "vitest";
import type { AbuseReport } from "@snapurl/contract";
import { reportActions, replaceReport } from "./report-actions";

/* #790: a dismissed report still offered "Dismiss". An action that would set the
   status the report already has is a no-op the user can click forever. */
describe("reportActions", () => {
  it("an open report offers every action", () => {
    expect(reportActions("open")).toEqual(["reviewed", "dismiss", "flag"]);
  });

  it("a dismissed report does not offer Dismiss again", () => {
    expect(reportActions("dismissed")).not.toContain("dismiss");
  });

  it("a reviewed report does not offer Reviewed again", () => {
    expect(reportActions("reviewed")).not.toContain("reviewed");
  });

  it("an actioned report (link already flagged) does not offer Flag again", () => {
    expect(reportActions("actioned")).not.toContain("flag");
  });

  it("a dismissed report can still be reopened as reviewed or acted on", () => {
    expect(reportActions("dismissed")).toEqual(["reviewed", "flag"]);
  });

  it("every status leaves at least one action, so a row is never a dead end", () => {
    for (const s of ["open", "reviewed", "dismissed", "actioned"] as const) {
      expect(reportActions(s).length).toBeGreaterThan(0);
    }
  });
});

const report = (id: string, status: AbuseReport["status"]): AbuseReport => ({
  id,
  slug: `s-${id}`,
  reason: "phishing",
  reporterContact: null,
  status,
  linkId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});

describe("replaceReport", () => {
  it("swaps the updated report in place, keeping order and every other row", () => {
    const list = [report("a", "open"), report("b", "open"), report("c", "reviewed")];
    const next = replaceReport(list, report("b", "dismissed"));
    expect(next.map((r) => `${r.id}:${r.status}`)).toEqual(["a:open", "b:dismissed", "c:reviewed"]);
  });

  it("does not mutate its input", () => {
    const list = [report("a", "open")];
    replaceReport(list, report("a", "dismissed"));
    expect(list[0]!.status).toBe("open");
  });

  it("leaves the list alone when the id is not in it, and tolerates an empty cache", () => {
    const list = [report("a", "open")];
    expect(replaceReport(list, report("zzz", "dismissed"))).toEqual(list);
    expect(replaceReport(undefined, report("a", "dismissed"))).toBeUndefined();
  });
});
