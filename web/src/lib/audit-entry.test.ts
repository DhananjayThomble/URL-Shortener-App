import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@snapurl/domain/audit";
import { auditEntryText } from "./audit-entry";

/* #783 — the team page must never show a raw audit key such as "form.created". */

describe("auditEntryText", () => {
  it("passes the API's rendered sentence through untouched", () => {
    expect(auditEntryText("Changed maya@acme.com's role from viewer to editor")).toBe(
      "Changed maya@acme.com's role from viewer to editor",
    );
    expect(auditEntryText("Created spring-sale")).toBe("Created spring-sale");
  });

  it("renders a raw known key (an older API) as copy", () => {
    expect(auditEntryText("form.created")).toBe("Created a form");
    expect(auditEntryText("domain.added")).toBe("Connected a domain");
    expect(auditEntryText("member.role_changed")).toBe("Changed a teammate's role");
  });

  it.each(AUDIT_ACTIONS.map((a) => [a]))("never shows the key %s itself", (action) => {
    expect(auditEntryText(action)).not.toBe(action);
    expect(auditEntryText(action)).not.toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it("humanises a dotted key this build does not know", () => {
    expect(auditEntryText("workspace.renamed")).toBe("Workspace renamed");
    expect(auditEntryText(" abuse_report.escalated ")).toBe("Abuse report escalated");
  });

  it("does not mangle a sentence that happens to contain a dot", () => {
    expect(auditEntryText("Connected go.acme.com")).toBe("Connected go.acme.com");
    expect(auditEntryText("Created the form /f/feedback")).toBe("Created the form /f/feedback");
  });
});
