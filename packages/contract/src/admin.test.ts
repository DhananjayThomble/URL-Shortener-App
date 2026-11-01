import { describe, expect, it } from "vitest";
import {
  AdminAuditPage,
  AdminAuditQuery,
  AdminAuditRow,
  AdminBacklog,
  AdminBacklogs,
  AdminMe,
  AdminRetryResult,
  AdminServiceHealth,
  AdminServiceState,
  AdminServiceStatus,
} from "./admin.js";

/* #974 — behavioural tests for the admin system-health contract shapes.

   These assert the PARSE behaviour a user of the schema sees, which is what
   kills the non-string mutants Stryker introduces in this file (the bounds,
   .int(), coercion, nullability and defaults on AdminAuditQuery especially).
   Per packages/contract/stryker.config.json the StringLiteral mutator is
   excluded here, so enum member spellings and .describe() text are not asserted
   literally — only behaviour is. */

describe("AdminMe (#968)", () => {
  it("accepts a confirmed admin and pins isPlatformAdmin true", () => {
    const parsed = AdminMe.parse({ id: "u1", name: "A", email: "a@x.com", isPlatformAdmin: true });
    expect(parsed.isPlatformAdmin).toBe(true);
    // literal(true): false must be rejected (kills the literal flip / widening).
    expect(AdminMe.safeParse({ id: "u1", name: "A", email: "a@x.com", isPlatformAdmin: false }).success).toBe(false);
  });
});

describe("AdminServiceState / AdminServiceStatus / AdminServiceHealth", () => {
  it("accepts the three states and rejects an unknown one", () => {
    expect(AdminServiceState.safeParse("ok").success).toBe(true);
    expect(AdminServiceState.safeParse("degraded").success).toBe(true);
    expect(AdminServiceState.safeParse("down").success).toBe(true);
    expect(AdminServiceState.safeParse("unknown").success).toBe(false);
  });

  it("requires every field of a service status", () => {
    const parsed = AdminServiceStatus.parse({ name: "api", state: "ok", detail: "up" });
    expect(parsed).toEqual({ name: "api", state: "ok", detail: "up" });
    // Each required field dropped must fail (kills the shape → {} mutant).
    expect(AdminServiceStatus.safeParse({ state: "ok", detail: "up" }).success).toBe(false);
    expect(AdminServiceStatus.safeParse({ name: "api", detail: "up" }).success).toBe(false);
    expect(AdminServiceStatus.safeParse({ name: "api", state: "ok" }).success).toBe(false);
    // state is constrained to the enum.
    expect(AdminServiceStatus.safeParse({ name: "api", state: "nope", detail: "up" }).success).toBe(false);
  });

  it("wraps the status array under services", () => {
    const ok = AdminServiceHealth.parse({ services: [{ name: "api", state: "ok", detail: "up" }] });
    expect(ok.services).toHaveLength(1);
    // The array element is itself an AdminServiceStatus, so a bad element fails.
    expect(AdminServiceHealth.safeParse({ services: [{ name: "api" }] }).success).toBe(false);
    // services must be present.
    expect(AdminServiceHealth.safeParse({}).success).toBe(false);
  });
});

describe("AdminBacklog / AdminBacklogs", () => {
  it("requires integer pending and stuck counts", () => {
    const parsed = AdminBacklog.parse({ name: "projection_outbox", pending: 4, stuck: 2 });
    expect(parsed).toEqual({ name: "projection_outbox", pending: 4, stuck: 2 });
    // .int() must reject a fractional count (kills the .int() drop mutant).
    expect(AdminBacklog.safeParse({ name: "x", pending: 1.5, stuck: 0 }).success).toBe(false);
    expect(AdminBacklog.safeParse({ name: "x", pending: 0, stuck: 2.5 }).success).toBe(false);
    // A non-number is rejected.
    expect(AdminBacklog.safeParse({ name: "x", pending: "4", stuck: 0 }).success).toBe(false);
    // Each field is required.
    expect(AdminBacklog.safeParse({ name: "x", pending: 1 }).success).toBe(false);
  });

  it("wraps the backlog array under backlogs", () => {
    const ok = AdminBacklogs.parse({ backlogs: [{ name: "job_leases", pending: 1, stuck: 0 }] });
    expect(ok.backlogs[0]!.name).toBe("job_leases");
    expect(AdminBacklogs.safeParse({}).success).toBe(false);
    expect(AdminBacklogs.safeParse({ backlogs: [{ name: "x", pending: 1 }] }).success).toBe(false);
  });
});

describe("AdminRetryResult", () => {
  it("requires an integer retried count", () => {
    expect(AdminRetryResult.parse({ retried: 3 }).retried).toBe(3);
    expect(AdminRetryResult.parse({ retried: 0 }).retried).toBe(0);
    expect(AdminRetryResult.safeParse({ retried: 2.5 }).success).toBe(false); // kills .int() drop
    expect(AdminRetryResult.safeParse({}).success).toBe(false); // retried required
    expect(AdminRetryResult.safeParse({ retried: "3" }).success).toBe(false);
  });
});

describe("AdminAuditRow / AdminAuditPage", () => {
  it("requires the row fields and allows null target fields", () => {
    const full = AdminAuditRow.parse({
      id: "a1",
      at: "2026-11-01T00:00:00.000Z",
      actor: "admin@x.com",
      action: "admin.job_lease.release",
      targetType: "job_lease",
      targetId: "nm",
    });
    expect(full.targetType).toBe("job_lease");
    // targetType/targetId are .nullable(): null is accepted (kills nullable drop).
    const nulls = AdminAuditRow.parse({
      id: "a2",
      at: "2026-11-01T00:00:00.000Z",
      actor: "admin@x.com",
      action: "admin.projection_outbox.retry",
      targetType: null,
      targetId: null,
    });
    expect(nulls.targetType).toBeNull();
    expect(nulls.targetId).toBeNull();
    // but the field key must still be present / a string|null, not undefined.
    expect(
      AdminAuditRow.safeParse({ id: "a3", at: "x", actor: "y", action: "z", targetId: null }).success,
    ).toBe(false); // targetType missing
    // non-nullable required fields cannot be null.
    expect(
      AdminAuditRow.safeParse({ id: null, at: "x", actor: "y", action: "z", targetType: null, targetId: null }).success,
    ).toBe(false);
  });

  it("pages rows with a boolean hasMore", () => {
    const page = AdminAuditPage.parse({ rows: [], hasMore: false });
    expect(page.hasMore).toBe(false);
    // hasMore is a boolean, not coerced from a truthy value.
    expect(AdminAuditPage.safeParse({ rows: [], hasMore: "no" }).success).toBe(false);
    expect(AdminAuditPage.safeParse({ rows: [] }).success).toBe(false); // hasMore required
    expect(AdminAuditPage.safeParse({ hasMore: true }).success).toBe(false); // rows required
  });
});

describe("AdminAuditQuery — filters, coercion, bounds and defaults", () => {
  it("defaults limit to 50 and offset to 0 on an empty query", () => {
    const parsed = AdminAuditQuery.parse({});
    expect(parsed.limit).toBe(50); // kills .default(50)
    expect(parsed.offset).toBe(0); // kills .default(0)
    // The optional filters are absent, not defaulted to anything.
    expect(parsed.action).toBeUndefined();
    expect(parsed.actor).toBeUndefined();
    expect(parsed.targetId).toBeUndefined();
    expect(parsed.after).toBeUndefined();
    expect(parsed.before).toBeUndefined();
  });

  it("coerces string limit/offset to numbers (query strings arrive as strings)", () => {
    const parsed = AdminAuditQuery.parse({ limit: "25", offset: "10" });
    expect(parsed.limit).toBe(25); // kills z.coerce.number() → z.number()
    expect(parsed.offset).toBe(10);
  });

  it("enforces the limit bounds 1..200", () => {
    expect(AdminAuditQuery.safeParse({ limit: 0 }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ limit: 1 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ limit: 200 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ limit: 201 }).success).toBe(false); // kills .max(200)
    // non-integer limit rejected.
    expect(AdminAuditQuery.safeParse({ limit: 10.5 }).success).toBe(false); // kills .int()
  });

  it("enforces offset >= 0 and integer", () => {
    expect(AdminAuditQuery.safeParse({ offset: -1 }).success).toBe(false); // kills .min(0)
    expect(AdminAuditQuery.safeParse({ offset: 0 }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ offset: 2.5 }).success).toBe(false); // kills .int()
  });

  it("bounds the action filter length 1..80", () => {
    expect(AdminAuditQuery.safeParse({ action: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ action: "a".repeat(80) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ action: "a".repeat(81) }).success).toBe(false); // kills .max(80)
  });

  it("bounds the actor filter length 1..255", () => {
    expect(AdminAuditQuery.safeParse({ actor: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ actor: "a".repeat(255) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ actor: "a".repeat(256) }).success).toBe(false); // kills .max(255)
  });

  it("bounds the targetId filter length 1..255", () => {
    expect(AdminAuditQuery.safeParse({ targetId: "" }).success).toBe(false); // kills .min(1)
    expect(AdminAuditQuery.safeParse({ targetId: "a".repeat(255) }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ targetId: "a".repeat(256) }).success).toBe(false); // kills .max(255)
  });

  it("requires after/before to be ISO-8601 datetimes", () => {
    expect(AdminAuditQuery.safeParse({ after: "2026-11-01T00:00:00.000Z" }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ after: "2026-11-01" }).success).toBe(false); // kills .datetime() drop
    expect(AdminAuditQuery.safeParse({ before: "2026-11-01T00:00:00.000Z" }).success).toBe(true);
    expect(AdminAuditQuery.safeParse({ before: "not-a-date" }).success).toBe(false);
  });

  it("accepts a fully-specified query", () => {
    const parsed = AdminAuditQuery.parse({
      action: "admin.webhook_deliveries.retry",
      actor: "admin@x.com",
      targetId: "webhook_deliveries",
      after: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
      limit: 10,
      offset: 20,
    });
    expect(parsed.action).toBe("admin.webhook_deliveries.retry");
    expect(parsed.limit).toBe(10);
    expect(parsed.offset).toBe(20);
  });
});



/* #971 — moderation and abuse shapes. */

import {
  AddBlockedDomainInput,
  AdminAbuseQueuePage,
  AdminAbuseQueueQuery,
  AdminAbuseReportAction,
  AdminAbuseReportRow,
  AdminBlockedDomain,
  AdminBlockedDomains,
  AdminCustomDomainRow,
  AdminCustomDomains,
  AdminFlaggedLinkRow,
  AdminFlaggedLinks,
  AdminLinkDisableInput,
  AdminLinkPage,
  AdminLinkRow,
  AdminLinkSearchQuery,
} from "./admin.js";

describe("AdminAbuseReportRow (#971)", () => {
  const base = {
    id: "r1",
    slug: "spring",
    reason: "phishing",
    reporterContact: null,
    status: "open" as const,
    linkId: null,
    destination: null,
    workspaceId: null,
    workspaceName: null,
    linkDisabled: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };

  it("accepts an orphaned (no-workspace) report with null link context", () => {
    const parsed = AdminAbuseReportRow.parse(base);
    expect(parsed.workspaceId).toBeNull();
    expect(parsed.linkId).toBeNull();
    expect(parsed.linkDisabled).toBe(false);
  });

  it("accepts a resolved report with destination and workspace", () => {
    const parsed = AdminAbuseReportRow.parse({
      ...base,
      linkId: "l1",
      destination: "https://evil.test",
      workspaceId: "w1",
      workspaceName: "Acme",
      status: "actioned",
      linkDisabled: true,
    });
    expect(parsed.destination).toBe("https://evil.test");
    expect(parsed.linkDisabled).toBe(true);
  });

  it("rejects an unknown status and a non-boolean linkDisabled", () => {
    expect(AdminAbuseReportRow.safeParse({ ...base, status: "nope" }).success).toBe(false);
    expect(AdminAbuseReportRow.safeParse({ ...base, linkDisabled: "yes" }).success).toBe(false);
  });

  it("requires linkDisabled and the id/slug/reason fields", () => {
    const { linkDisabled: _omit, ...noFlag } = base;
    expect(AdminAbuseReportRow.safeParse(noFlag).success).toBe(false);
    const { slug: _s, ...noSlug } = base;
    expect(AdminAbuseReportRow.safeParse(noSlug).success).toBe(false);
  });
});

describe("AdminAbuseQueuePage (#971)", () => {
  it("pages rows with a boolean hasMore", () => {
    expect(AdminAbuseQueuePage.parse({ rows: [], hasMore: true }).hasMore).toBe(true);
    expect(AdminAbuseQueuePage.safeParse({ rows: [] }).success).toBe(false);
    expect(AdminAbuseQueuePage.safeParse({ rows: [], hasMore: "x" }).success).toBe(false);
  });
});

describe("AdminAbuseQueueQuery (#971)", () => {
  it("defaults limit to 50 and offset to 0, filters absent", () => {
    const parsed = AdminAbuseQueueQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(parsed.status).toBeUndefined();
    expect(parsed.orphaned).toBeUndefined();
  });

  it("coerces orphaned (true AND false) and the numeric bounds", () => {
    expect(AdminAbuseQueueQuery.parse({ orphaned: "true" }).orphaned).toBe(true);
    // z.stringbool, not z.coerce.boolean: "false" must be false, not truthy.
    expect(AdminAbuseQueueQuery.parse({ orphaned: "false" }).orphaned).toBe(false);
    expect(AdminAbuseQueueQuery.parse({ limit: "10", offset: "5" })).toMatchObject({ limit: 10, offset: 5 });
    expect(AdminAbuseQueueQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(AdminAbuseQueueQuery.safeParse({ limit: 201 }).success).toBe(false);
    expect(AdminAbuseQueueQuery.safeParse({ offset: -1 }).success).toBe(false);
    expect(AdminAbuseQueueQuery.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(AdminAbuseQueueQuery.safeParse({ status: "actioned" }).success).toBe(true);
    expect(AdminAbuseQueueQuery.safeParse({ status: "nope" }).success).toBe(false);
  });
});

describe("AdminAbuseReportAction (#971)", () => {
  it("accepts status alone, disableLink alone, both, and neither (service rejects neither)", () => {
    expect(AdminAbuseReportAction.parse({ status: "dismissed" }).status).toBe("dismissed");
    expect(AdminAbuseReportAction.parse({ disableLink: true }).disableLink).toBe(true);
    expect(AdminAbuseReportAction.parse({ status: "actioned", disableLink: true })).toEqual({
      status: "actioned",
      disableLink: true,
    });
    // Shape-valid even when empty — the no-op rejection is the service's job.
    expect(AdminAbuseReportAction.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown status and a non-boolean disableLink", () => {
    expect(AdminAbuseReportAction.safeParse({ status: "nope" }).success).toBe(false);
    expect(AdminAbuseReportAction.safeParse({ disableLink: "yes" }).success).toBe(false);
  });
});

describe("AdminLinkRow / AdminLinkPage (#971)", () => {
  const row = {
    id: "l1",
    slug: "promo",
    domain: "snap.to",
    destination: "https://example.com",
    workspaceId: "w1",
    workspaceName: null,
    owner: null,
    disabled: false,
    safeBrowsingStatus: "clean",
    createdAt: "2026-11-01T00:00:00.000Z",
  };

  it("accepts a link row with nullable owner/workspaceName", () => {
    expect(AdminLinkRow.parse(row).owner).toBeNull();
    expect(AdminLinkRow.parse({ ...row, owner: "a@x.com", workspaceName: "Acme" }).owner).toBe("a@x.com");
  });

  it("requires disabled to be a boolean and the id/slug/destination present", () => {
    expect(AdminLinkRow.safeParse({ ...row, disabled: "no" }).success).toBe(false);
    const { destination: _d, ...noDest } = row;
    expect(AdminLinkRow.safeParse(noDest).success).toBe(false);
  });

  it("pages rows with hasMore", () => {
    expect(AdminLinkPage.parse({ rows: [row], hasMore: false }).rows).toHaveLength(1);
    expect(AdminLinkPage.safeParse({ rows: [row] }).success).toBe(false);
  });
});

describe("AdminLinkSearchQuery (#971)", () => {
  it("defaults limit/offset and leaves filters absent", () => {
    const parsed = AdminLinkSearchQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(parsed.q).toBeUndefined();
    expect(parsed.disabled).toBeUndefined();
  });

  it("coerces disabled (true AND false) and bounds q length 1..255", () => {
    // z.stringbool: "false" is false and "true" is true (a plain coerce.boolean
    // would read "false" as truthy).
    expect(AdminLinkSearchQuery.parse({ disabled: "false" }).disabled).toBe(false);
    expect(AdminLinkSearchQuery.parse({ disabled: "true" }).disabled).toBe(true);
    expect(AdminLinkSearchQuery.safeParse({ q: "" }).success).toBe(false);
    expect(AdminLinkSearchQuery.safeParse({ q: "a".repeat(255) }).success).toBe(true);
    expect(AdminLinkSearchQuery.safeParse({ q: "a".repeat(256) }).success).toBe(false);
  });

  it("enforces numeric bounds", () => {
    expect(AdminLinkSearchQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(AdminLinkSearchQuery.safeParse({ limit: 201 }).success).toBe(false);
    expect(AdminLinkSearchQuery.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("AdminLinkDisableInput (#971)", () => {
  it("requires the boolean disabled and bounds reason to 500", () => {
    expect(AdminLinkDisableInput.parse({ disabled: true }).disabled).toBe(true);
    expect(AdminLinkDisableInput.parse({ disabled: false, reason: "spam" }).reason).toBe("spam");
    expect(AdminLinkDisableInput.safeParse({}).success).toBe(false); // disabled required
    expect(AdminLinkDisableInput.safeParse({ disabled: "yes" }).success).toBe(false);
    expect(AdminLinkDisableInput.safeParse({ disabled: true, reason: "a".repeat(501) }).success).toBe(false);
  });
});

describe("AddBlockedDomainInput (#971)", () => {
  it("accepts a bare host and an optional reason", () => {
    expect(AddBlockedDomainInput.parse({ domain: "evil.example" }).domain).toBe("evil.example");
    expect(AddBlockedDomainInput.parse({ domain: "evil.example", reason: "phishing" }).reason).toBe("phishing");
  });

  it("rejects an empty domain and one over 253 chars", () => {
    expect(AddBlockedDomainInput.safeParse({ domain: "" }).success).toBe(false);
    expect(AddBlockedDomainInput.safeParse({ domain: `${"a".repeat(254)}` }).success).toBe(false);
  });

  it("rejects a full URL, a scheme, a slash, a space or an @ (bare host only)", () => {
    expect(AddBlockedDomainInput.safeParse({ domain: "https://evil.example" }).success).toBe(false);
    expect(AddBlockedDomainInput.safeParse({ domain: "evil.example/path" }).success).toBe(false);
    expect(AddBlockedDomainInput.safeParse({ domain: "evil example" }).success).toBe(false);
    expect(AddBlockedDomainInput.safeParse({ domain: "user@evil.example" }).success).toBe(false);
  });

  it("bounds reason to 500 chars", () => {
    expect(AddBlockedDomainInput.safeParse({ domain: "evil.example", reason: "a".repeat(501) }).success).toBe(false);
  });
});

describe("AdminBlockedDomain / AdminBlockedDomains (#971)", () => {
  const d = { id: "b1", domain: "evil.example", reason: null, addedBy: "a@x.com", createdAt: "2026-11-01T00:00:00.000Z" };
  it("allows a null reason and requires the other fields", () => {
    expect(AdminBlockedDomain.parse(d).reason).toBeNull();
    expect(AdminBlockedDomain.parse({ ...d, reason: "phishing" }).reason).toBe("phishing");
    const { addedBy: _a, ...noAdder } = d;
    expect(AdminBlockedDomain.safeParse(noAdder).success).toBe(false);
  });
  it("wraps the array under domains", () => {
    expect(AdminBlockedDomains.parse({ domains: [d] }).domains).toHaveLength(1);
    expect(AdminBlockedDomains.safeParse({}).success).toBe(false);
  });
});

describe("AdminFlaggedLinkRow / AdminFlaggedLinks (#971)", () => {
  const row = {
    id: "l1",
    slug: "promo",
    domain: "snap.to",
    destination: "https://evil.test",
    workspaceId: "w1",
    workspaceName: null,
    safeBrowsingStatus: "flagged",
    checkedAt: null,
    disabled: false,
  };
  it("allows null checkedAt/workspaceName and requires disabled boolean", () => {
    expect(AdminFlaggedLinkRow.parse(row).checkedAt).toBeNull();
    expect(AdminFlaggedLinkRow.safeParse({ ...row, disabled: "no" }).success).toBe(false);
  });
  it("pages with hasMore", () => {
    expect(AdminFlaggedLinks.parse({ rows: [row], hasMore: false }).hasMore).toBe(false);
    expect(AdminFlaggedLinks.safeParse({ rows: [row] }).success).toBe(false);
  });
});

describe("AdminCustomDomainRow / AdminCustomDomains (#971)", () => {
  const row = {
    id: "d1",
    domain: "links.acme.test",
    workspaceId: "w1",
    workspaceName: "Acme",
    status: "live",
    ssl: "issued",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    sslRenewsAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
  it("allows null workspace/verified/ssl-renews and requires status + ssl", () => {
    expect(AdminCustomDomainRow.parse({ ...row, workspaceId: null, workspaceName: null }).workspaceId).toBeNull();
    expect(AdminCustomDomainRow.parse(row).sslRenewsAt).toBeNull();
    const { status: _st, ...noStatus } = row;
    expect(AdminCustomDomainRow.safeParse(noStatus).success).toBe(false);
    const { ssl: _ssl, ...noSsl } = row;
    expect(AdminCustomDomainRow.safeParse(noSsl).success).toBe(false);
  });
  it("wraps the array under rows", () => {
    expect(AdminCustomDomains.parse({ rows: [row] }).rows).toHaveLength(1);
    expect(AdminCustomDomains.safeParse({}).success).toBe(false);
  });
});
