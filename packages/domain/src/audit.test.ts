import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, describeAuditAction, humaniseAuditKey, isAuditAction } from "./audit.js";

/* #783 — every audit key the API writes must reach the team page as a
   sentence. QA saw a raw "form.created" next to the human entries. */

const RAW_KEY = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

describe("describeAuditAction — every known action has human copy", () => {
  it.each(AUDIT_ACTIONS.map((a) => [a]))("%s renders as a sentence, not its key", (action) => {
    for (const metadata of [null, {}, { email: "a@b.co", slug: "s", domain: "d.co", from: "viewer", to: "editor" }]) {
      const copy = describeAuditAction(action, metadata);
      expect(copy).not.toBe(action);
      expect(copy).not.toMatch(RAW_KEY);
      expect(copy).not.toMatch(/undefined|null|\[object/);
      // Not the generic fallback either: a known key gets a written label.
      expect(copy).not.toBe(humaniseAuditKey(action));
    }
  });

  it("lists each action once", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });
});

describe("member.role_changed names whose role changed", () => {
  it("names the member when the row carries their email", () => {
    expect(describeAuditAction("member.role_changed", { email: "maya@acme.com", from: "viewer", to: "editor" })).toBe(
      "Changed maya@acme.com's role from viewer to editor",
    );
  });

  it("still reads as a sentence for a row written before the email was recorded", () => {
    expect(describeAuditAction("member.role_changed", { from: "viewer", to: "editor" })).toBe(
      "Changed a teammate's role from viewer to editor",
    );
    expect(describeAuditAction("member.role_changed", null)).toBe("Changed a teammate's role");
  });

  it("ignores a non-string email rather than printing it", () => {
    expect(describeAuditAction("member.role_changed", { email: 42, from: "viewer", to: "admin" })).toBe(
      "Changed a teammate's role from viewer to admin",
    );
  });
});

describe("the actions QA saw raw or missing", () => {
  it("form.created", () => {
    expect(describeAuditAction("form.created", { slug: "feedback", title: "Feedback" })).toBe(
      "Created the form /f/feedback",
    );
  });

  it("domain add / remove", () => {
    expect(describeAuditAction("domain.added", { domain: "go.acme.com" })).toBe("Connected go.acme.com");
    expect(describeAuditAction("domain.removed", { domain: "go.acme.com" })).toBe("Disconnected go.acme.com");
  });

  it("bio page create / publish", () => {
    const page = { domain: "snap.to", slug: "maya" };
    expect(describeAuditAction("bio_page.created", { ...page, status: "draft" })).toBe(
      "Created the bio page snap.to/maya as a draft",
    );
    expect(describeAuditAction("bio_page.created", { ...page, status: "live" })).toBe(
      "Created and published the bio page snap.to/maya",
    );
    expect(describeAuditAction("bio_page.published", page)).toBe("Published the bio page snap.to/maya");
    expect(describeAuditAction("bio_page.unpublished", page)).toBe("Unpublished the bio page snap.to/maya");
  });

  it("keeps the copy scripts/smoke.sh asserts for links", () => {
    expect(describeAuditAction("link.created", { slug: "x" })).toBe("Created x");
    expect(describeAuditAction("link.updated", { slug: "x" })).toBe("Edited x");
    expect(describeAuditAction("link.deleted", { slug: "x" })).toBe("Deleted x");
  });
});

describe("unknown keys fall back to a humanised key, never the raw one", () => {
  it.each([
    ["abuse_report.escalated", "Abuse report escalated"],
    ["workspace.renamed", "Workspace renamed"],
    ["Already a sentence", "Already a sentence"],
    ["", "Did something"],
    ["...", "Did something"],
  ])("%s -> %s", (raw, expected) => {
    expect(isAuditAction(raw)).toBe(false);
    expect(describeAuditAction(raw, null)).toBe(expected);
  });
});
