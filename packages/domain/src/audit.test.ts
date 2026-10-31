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


/* #894 — mutation testing. The parameterised "renders as a sentence" guard
   above proves no key reaches the page raw, but it does not pin the actual
   copy, so a mutated word in any label (e.g. "Invited " -> "") still produced
   a sentence and survived. The audit copy is product-visible (it is the
   sentence shown after the actor's name on the team page), so every word is
   asserted exactly here rather than justified as equivalent. */
describe("describeAuditAction — exact copy for every action", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["member.invited", { email: "maya@acme.com", role: "editor" }, "Invited maya@acme.com as editor"],
    ["member.invited", { email: "maya@acme.com" }, "Invited maya@acme.com"],
    ["member.invited", {}, "Invited a teammate"],
    ["member.invite_resent", { email: "maya@acme.com" }, "Resent the invitation to maya@acme.com"],
    ["member.invite_resent", {}, "Resent the invitation to a teammate"],
    ["member.joined", { email: "maya@acme.com", role: "viewer" }, "maya@acme.com joined as viewer"],
    ["member.joined", {}, "A teammate joined as a member"],
    ["member.removed", { email: "maya@acme.com" }, "Removed maya@acme.com"],
    ["member.removed", {}, "Removed a teammate"],
    ["member.role_changed", { email: "maya@acme.com", from: "viewer", to: "editor" }, "Changed maya@acme.com's role from viewer to editor"],
    ["member.role_changed", { email: "maya@acme.com", to: "editor" }, "Changed maya@acme.com's role to editor"],
    ["member.role_changed", { email: "maya@acme.com" }, "Changed maya@acme.com's role"],
    ["link.created", { slug: "promo" }, "Created promo"],
    ["link.created", {}, "Created a link"],
    ["link.updated", { slug: "promo" }, "Edited promo"],
    ["link.updated", {}, "Edited a link"],
    ["link.deleted", { slug: "promo" }, "Deleted promo"],
    ["link.deleted", {}, "Deleted a link"],
    ["link.flagged", { slug: "promo" }, "Flagged promo after an abuse report"],
    ["link.flagged", {}, "Flagged a link after an abuse report"],
    ["abuse_report.reviewed", { slug: "promo" }, "Reviewed an abuse report about promo"],
    ["abuse_report.reviewed", {}, "Reviewed an abuse report"],
    ["form.created", { slug: "feedback" }, "Created the form /f/feedback"],
    ["form.created", {}, "Created a form"],
    ["form.updated", { slug: "feedback" }, "Edited the form /f/feedback"],
    ["form.updated", {}, "Edited a form"],
    ["form.deleted", { slug: "feedback" }, "Deleted the form /f/feedback"],
    ["form.deleted", {}, "Deleted a form"],
    ["domain.added", { domain: "go.acme.com" }, "Connected go.acme.com"],
    ["domain.added", {}, "Connected a domain"],
    ["domain.verified", { domain: "go.acme.com" }, "Verified go.acme.com"],
    ["domain.verified", {}, "Verified a domain"],
    ["domain.updated", { domain: "go.acme.com" }, "Changed redirects on go.acme.com"],
    ["domain.updated", {}, "Changed redirects on a domain"],
    ["domain.removed", { domain: "go.acme.com" }, "Disconnected go.acme.com"],
    ["domain.removed", {}, "Disconnected a domain"],
    ["bio_page.created", { domain: "snap.to", slug: "maya", status: "live" }, "Created and published the bio page snap.to/maya"],
    ["bio_page.created", { slug: "maya", status: "live" }, "Created and published the bio page maya"],
    ["bio_page.created", { slug: "maya" }, "Created the bio page maya as a draft"],
    ["bio_page.created", {}, "Created a bio page as a draft"],
    ["bio_page.updated", { domain: "snap.to", slug: "maya" }, "Edited the bio page snap.to/maya"],
    ["bio_page.updated", {}, "Edited a bio page"],
    ["bio_page.published", { slug: "maya" }, "Published the bio page maya"],
    ["bio_page.unpublished", { slug: "maya" }, "Unpublished the bio page maya"],
    ["bio_page.deleted", { slug: "maya" }, "Deleted the bio page maya"],
    ["bio_page.deleted", {}, "Deleted a bio page"],
    ["apikey.created", {}, "Created an API key"],
    ["apikey.revoked", {}, "Revoked an API key"],
    ["webhook.created", {}, "Added a webhook"],
    ["webhook.removed", {}, "Removed a webhook"],
  ])("%s %o -> %s", (action, metadata, expected) => {
    expect(describeAuditAction(action, metadata)).toBe(expected);
  });

  it("member.joined names the role explicitly, not the member fallback", () => {
    // Pins "joined as" and the "a member" role fallback separately.
    expect(describeAuditAction("member.joined", { email: "x@y.co" })).toBe("x@y.co joined as a member");
  });
});

describe("text() metadata guard — only a non-empty string renders", () => {
  it("treats whitespace-only and empty strings as absent", () => {
    // A blank slug must fall through to the "a form" / "a link" wording,
    // not render an empty slug — kills the `.trim() !== ""` and the
    // `typeof value === "string"` guards in text().
    expect(describeAuditAction("form.created", { slug: "   " })).toBe("Created a form");
    expect(describeAuditAction("form.created", { slug: "" })).toBe("Created a form");
    expect(describeAuditAction("link.created", { slug: "  \t " })).toBe("Created a link");
  });

  it("treats a non-string value as absent rather than coercing it", () => {
    expect(describeAuditAction("link.created", { slug: 42 })).toBe("Created a link");
    expect(describeAuditAction("domain.added", { domain: { nested: true } })).toBe("Connected a domain");
    expect(describeAuditAction("form.created", { slug: ["a"] })).toBe("Created a form");
  });

  it("bioPage requires BOTH domain and slug for the domain/slug form", () => {
    // domain present but slug absent falls to "a bio page", not "snap.to/".
    expect(describeAuditAction("bio_page.published", { domain: "snap.to" })).toBe("Published a bio page");
  });
});

describe("humaniseAuditKey splits on dot, underscore and whitespace", () => {
  it("collapses every separator and sentence-cases the result", () => {
    expect(humaniseAuditKey("abuse_report.reviewed")).toBe("Abuse report reviewed");
    expect(humaniseAuditKey("domain.dns_checked")).toBe("Domain dns checked");
    expect(humaniseAuditKey("a.b_c d")).toBe("A b c d");
  });

  it("lowercases the tail so an upper-cased key is normalised", () => {
    // Kills the StringLiteral/MethodExpression mutants on the toLowerCase/slice.
    expect(humaniseAuditKey("LINK.CREATED")).toBe("Link created");
  });

  it("uppercases only the first character", () => {
    expect(humaniseAuditKey("x")).toBe("X");
  });
});
