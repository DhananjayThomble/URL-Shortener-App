import { describe, expect, it } from "vitest";
import {
  AdminActionResult,
  AdminAuditPage,
  AdminAuditQuery,
  AdminAuditRow,
  AdminBacklog,
  AdminBacklogs,
  AdminListQuery,
  AdminMe,
  AdminRetryResult,
  AdminServiceHealth,
  AdminServiceState,
  AdminServiceStatus,
  AdminUpdateWorkspaceInput,
  AdminUserDetail,
  AdminUserList,
  AdminUserRow,
  AdminUserWorkspace,
  AdminViewAsWorkspace,
  AdminWorkspaceDetail,
  AdminWorkspaceList,
  AdminWorkspaceMember,
  AdminWorkspaceRow,
} from "./admin.js";

/* #969 — admin.ts carries the users-and-workspaces admin surface shapes. These
   pin the two schemas with real logic (AdminListQuery's coerced, bounded,
   defaulted limit; AdminUpdateWorkspaceInput's "at least one field" refinement
   and its bounds), the literals that are load-bearing on the wire
   (AdminMe.isPlatformAdmin, AdminViewAsWorkspace.readOnly, AdminActionResult.ok)
   and the nullable/required fields of the row and detail DTOs. */

describe("AdminMe", () => {
  const valid = { id: "u1", name: "Ada", email: "ada@x.com", isPlatformAdmin: true as const };

  it("accepts a confirmed admin", () => {
    expect(AdminMe.safeParse(valid).success).toBe(true);
  });

  it("requires isPlatformAdmin to be the literal true", () => {
    expect(AdminMe.safeParse({ ...valid, isPlatformAdmin: false }).success).toBe(false);
    expect(AdminMe.safeParse({ ...valid, isPlatformAdmin: undefined }).success).toBe(false);
  });

  it("requires id, name and email", () => {
    expect(AdminMe.safeParse({ ...valid, id: undefined }).success).toBe(false);
    expect(AdminMe.safeParse({ ...valid, name: undefined }).success).toBe(false);
    expect(AdminMe.safeParse({ ...valid, email: undefined }).success).toBe(false);
  });
});

describe("AdminListQuery", () => {
  it("defaults limit to 25 when absent", () => {
    const parsed = AdminListQuery.parse({});
    expect(parsed.limit).toBe(25);
    expect(parsed.search).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it("coerces a string limit to a number", () => {
    expect(AdminListQuery.parse({ limit: "40" }).limit).toBe(40);
  });

  it("enforces the 1..100 bounds", () => {
    expect(AdminListQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(AdminListQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(AdminListQuery.safeParse({ limit: 1 }).success).toBe(true);
    expect(AdminListQuery.safeParse({ limit: 100 }).success).toBe(true);
  });

  it("rejects a non-integer limit", () => {
    expect(AdminListQuery.safeParse({ limit: 2.5 }).success).toBe(false);
  });

  it("rejects a search longer than 255 chars and trims it", () => {
    expect(AdminListQuery.safeParse({ search: "a".repeat(256) }).success).toBe(false);
    expect(AdminListQuery.parse({ search: "  hi  " }).search).toBe("hi");
  });

  it("accepts a cursor string", () => {
    expect(AdminListQuery.parse({ cursor: "abc" }).cursor).toBe("abc");
  });
});

describe("AdminUserRow", () => {
  const valid = {
    id: "u1",
    name: "Ada",
    email: "ada@x.com",
    emailVerified: true,
    twoFactorEnabled: false,
    suspendedAt: null,
    workspaceCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null,
  };

  it("accepts a valid row", () => {
    expect(AdminUserRow.safeParse(valid).success).toBe(true);
  });

  it("accepts a suspended timestamp and a last-active timestamp", () => {
    expect(
      AdminUserRow.safeParse({ ...valid, suspendedAt: "2026-02-02T00:00:00.000Z", lastActiveAt: "2026-02-03T00:00:00.000Z" })
        .success,
    ).toBe(true);
  });

  it("requires workspaceCount to be an integer", () => {
    expect(AdminUserRow.safeParse({ ...valid, workspaceCount: 1.5 }).success).toBe(false);
  });

  it("requires the boolean flags", () => {
    expect(AdminUserRow.safeParse({ ...valid, emailVerified: "yes" }).success).toBe(false);
    expect(AdminUserRow.safeParse({ ...valid, twoFactorEnabled: 1 }).success).toBe(false);
  });

  it("rejects a missing (undefined) suspendedAt — it must be present, nullable", () => {
    expect(AdminUserRow.safeParse({ ...valid, suspendedAt: undefined }).success).toBe(false);
  });
});

describe("AdminUserWorkspace and AdminUserDetail", () => {
  const ws = { id: "w1", name: "Acme", slug: "acme", role: "owner", plan: "Free" };
  const user = {
    id: "u1",
    name: "Ada",
    email: "ada@x.com",
    emailVerified: true,
    twoFactorEnabled: true,
    suspendedAt: null,
    workspaceCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null,
  };

  it("accepts a workspace membership row", () => {
    expect(AdminUserWorkspace.safeParse(ws).success).toBe(true);
    expect(AdminUserWorkspace.safeParse({ ...ws, role: undefined }).success).toBe(false);
  });

  it("detail extends the row with a workspaces array", () => {
    expect(AdminUserDetail.safeParse({ ...user, workspaces: [ws] }).success).toBe(true);
    expect(AdminUserDetail.safeParse({ ...user, workspaces: undefined }).success).toBe(false);
    expect(AdminUserDetail.safeParse({ ...user, workspaces: [{ ...ws, id: undefined }] }).success).toBe(false);
  });
});

describe("AdminUserList", () => {
  const row = {
    id: "u1",
    name: "Ada",
    email: "ada@x.com",
    emailVerified: true,
    twoFactorEnabled: false,
    suspendedAt: null,
    workspaceCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: null,
  };

  it("accepts items + total, with nextCursor optional/nullable", () => {
    expect(AdminUserList.safeParse({ items: [row], total: 1 }).success).toBe(true);
    expect(AdminUserList.safeParse({ items: [], total: 0, nextCursor: null }).success).toBe(true);
    expect(AdminUserList.safeParse({ items: [row], total: 1, nextCursor: "c1" }).success).toBe(true);
  });

  it("requires total", () => {
    expect(AdminUserList.safeParse({ items: [] }).success).toBe(false);
  });
});

describe("AdminWorkspaceRow and AdminWorkspaceList", () => {
  const row = {
    id: "w1",
    name: "Acme",
    slug: "acme",
    plan: "Free",
    clicksIncluded: 1_000_000,
    memberCount: 3,
    linkCount: 10,
    domainCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a valid row", () => {
    expect(AdminWorkspaceRow.safeParse(row).success).toBe(true);
  });

  it("requires the integer counts", () => {
    expect(AdminWorkspaceRow.safeParse({ ...row, clicksIncluded: 1.5 }).success).toBe(false);
    expect(AdminWorkspaceRow.safeParse({ ...row, memberCount: "3" }).success).toBe(false);
    expect(AdminWorkspaceRow.safeParse({ ...row, linkCount: 1.1 }).success).toBe(false);
    expect(AdminWorkspaceRow.safeParse({ ...row, domainCount: 1.1 }).success).toBe(false);
  });

  it("list carries items + total", () => {
    expect(AdminWorkspaceList.safeParse({ items: [row], total: 1 }).success).toBe(true);
    expect(AdminWorkspaceList.safeParse({ items: [row] }).success).toBe(false);
  });
});

describe("AdminWorkspaceMember and AdminWorkspaceDetail", () => {
  const member = { userId: "u1", email: "ada@x.com", name: "Ada", role: "owner", status: "active" };
  const detail = {
    id: "w1",
    name: "Acme",
    slug: "acme",
    plan: "Free",
    clicksIncluded: 1_000_000,
    memberCount: 1,
    linkCount: 2,
    domainCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    currency: "INR",
    retentionYears: 3,
    members: [member],
    clicksThisMonth: 42,
  };

  it("accepts a member with a null userId/name (an unaccepted invite)", () => {
    expect(AdminWorkspaceMember.safeParse(member).success).toBe(true);
    expect(AdminWorkspaceMember.safeParse({ ...member, userId: null, name: null }).success).toBe(true);
  });

  it("requires the member email, role and status", () => {
    expect(AdminWorkspaceMember.safeParse({ ...member, email: undefined }).success).toBe(false);
    expect(AdminWorkspaceMember.safeParse({ ...member, role: undefined }).success).toBe(false);
    expect(AdminWorkspaceMember.safeParse({ ...member, status: undefined }).success).toBe(false);
  });

  it("detail carries currency, retentionYears, members and clicksThisMonth", () => {
    expect(AdminWorkspaceDetail.safeParse(detail).success).toBe(true);
    expect(AdminWorkspaceDetail.safeParse({ ...detail, clicksThisMonth: 1.5 }).success).toBe(false);
    expect(AdminWorkspaceDetail.safeParse({ ...detail, retentionYears: 2.5 }).success).toBe(false);
    expect(AdminWorkspaceDetail.safeParse({ ...detail, members: undefined }).success).toBe(false);
  });
});

describe("AdminUpdateWorkspaceInput", () => {
  it("accepts a plan-only edit", () => {
    expect(AdminUpdateWorkspaceInput.safeParse({ plan: "Pro" }).success).toBe(true);
  });

  it("accepts a clicks-only edit", () => {
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: 5_000_000 }).success).toBe(true);
  });

  it("accepts both together", () => {
    expect(AdminUpdateWorkspaceInput.safeParse({ plan: "Pro", clicksIncluded: 1 }).success).toBe(true);
  });

  it("rejects an empty object (the refinement: at least one field)", () => {
    const res = AdminUpdateWorkspaceInput.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.message).toMatch(/Change the plan/);
  });

  it("rejects an empty or over-long plan", () => {
    expect(AdminUpdateWorkspaceInput.safeParse({ plan: "" }).success).toBe(false);
    expect(AdminUpdateWorkspaceInput.safeParse({ plan: "a".repeat(41) }).success).toBe(false);
  });

  it("bounds clicksIncluded to 0..2_147_483_647 integers", () => {
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: -1 }).success).toBe(false);
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: 2_147_483_648 }).success).toBe(false);
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: 1.5 }).success).toBe(false);
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: 0 }).success).toBe(true);
    expect(AdminUpdateWorkspaceInput.safeParse({ clicksIncluded: 2_147_483_647 }).success).toBe(true);
  });
});

describe("AdminViewAsWorkspace", () => {
  const detail = {
    id: "w1",
    name: "Acme",
    slug: "acme",
    plan: "Free",
    clicksIncluded: 1_000_000,
    memberCount: 1,
    linkCount: 1,
    domainCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    currency: "INR",
    retentionYears: 3,
    members: [],
    clicksThisMonth: 0,
  };
  const valid = {
    workspace: detail,
    recentLinks: [
      { id: "l1", slug: "s", domain: "snap.to", destination: "https://x.com", clicks: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    readOnly: true as const,
  };

  it("accepts a read-only snapshot", () => {
    expect(AdminViewAsWorkspace.safeParse(valid).success).toBe(true);
  });

  it("requires readOnly to be the literal true", () => {
    expect(AdminViewAsWorkspace.safeParse({ ...valid, readOnly: false }).success).toBe(false);
    expect(AdminViewAsWorkspace.safeParse({ ...valid, readOnly: undefined }).success).toBe(false);
  });

  it("requires each recent link's integer click count and fields", () => {
    expect(AdminViewAsWorkspace.safeParse({ ...valid, recentLinks: [{ ...valid.recentLinks[0], clicks: 1.5 }] }).success).toBe(
      false,
    );
    expect(AdminViewAsWorkspace.safeParse({ ...valid, recentLinks: [{ ...valid.recentLinks[0], slug: undefined }] }).success).toBe(
      false,
    );
  });

  it("accepts an empty recentLinks array", () => {
    expect(AdminViewAsWorkspace.safeParse({ ...valid, recentLinks: [] }).success).toBe(true);
  });
});

describe("AdminActionResult", () => {
  it("accepts a result with ok literal true", () => {
    expect(AdminActionResult.safeParse({ id: "u1", action: "suspend", ok: true }).success).toBe(true);
  });

  it("requires ok to be the literal true, and id + action present", () => {
    expect(AdminActionResult.safeParse({ id: "u1", action: "suspend", ok: false }).success).toBe(false);
    expect(AdminActionResult.safeParse({ id: "u1", action: undefined, ok: true }).success).toBe(false);
    expect(AdminActionResult.safeParse({ action: "suspend", ok: true }).success).toBe(false);
  });
});

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

/* #972 — runtime platform-settings shapes. Behavioural parse tests covering
   every bound, default, coercion, refinement and wire literal so the Stryker
   mutation gate on packages/contract stays above threshold: a mutant that
   loosens a bound, drops a default, flips an enum member or removes the
   "at least one" refine must fail at least one assertion here. */

import {
  BannerSetting,
  BotProtectionProvider,
  BotProtectionSetting,
  DisposableEmailSetting,
  NewAccountLimitsSetting,
  PlatformBanner,
  PlatformSettings,
  PlatformSettingsInput,
  PlatformSettingsValues,
  PlatformSettingMeta,
  RateLimitSetting,
  SignupMode,
  SignupRefusalReason,
} from "./admin.js";

/* #993 — the new-account caps, bot-protection switch and disposable-email
   additions added to the #972 settings store, plus the sign-up refusal reason
   codes. These behavioural assertions keep packages/contract's mutation score
   above the gate: a mutant that loosens a bound, flips an enum member or drops a
   field must fail at least one assertion here. */

const NEW_ACCOUNT_LIMITS_993 = { windowDays: 7, perDay: 20, perHour: 10 } as const;
const BOT_PROTECTION_993 = { provider: "none" as const };
const DISPOSABLE_EMAILS_993 = { extraDomains: [] as string[] };

describe("SignupMode", () => {
  it("accepts exactly the three modes", () => {
    for (const m of ["open", "invite_only", "closed"]) {
      expect(SignupMode.safeParse(m).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const m of ["Open", "invite", "disabled", "", "INVITE_ONLY"]) {
      expect(SignupMode.safeParse(m).success).toBe(false);
    }
  });
});

describe("RateLimitSetting", () => {
  it("accepts a limit and ttl in range", () => {
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 60 }).success).toBe(true);
  });

  it("requires both fields", () => {
    expect(RateLimitSetting.safeParse({ limit: 120 }).success).toBe(false);
    expect(RateLimitSetting.safeParse({ ttlSeconds: 60 }).success).toBe(false);
  });

  it("enforces integer, min and max on limit", () => {
    expect(RateLimitSetting.safeParse({ limit: 0, ttlSeconds: 60 }).success).toBe(false);
    expect(RateLimitSetting.safeParse({ limit: 1, ttlSeconds: 60 }).success).toBe(true);
    expect(RateLimitSetting.safeParse({ limit: 100_000, ttlSeconds: 60 }).success).toBe(true);
    expect(RateLimitSetting.safeParse({ limit: 100_001, ttlSeconds: 60 }).success).toBe(false);
    expect(RateLimitSetting.safeParse({ limit: 1.5, ttlSeconds: 60 }).success).toBe(false);
  });

  it("enforces integer, min and max on ttlSeconds", () => {
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 0 }).success).toBe(false);
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 1 }).success).toBe(true);
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 86_400 }).success).toBe(true);
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 86_401 }).success).toBe(false);
    expect(RateLimitSetting.safeParse({ limit: 120, ttlSeconds: 2.5 }).success).toBe(false);
  });
});

describe("BannerSetting", () => {
  it("defaults level to info when omitted", () => {
    const parsed = BannerSetting.parse({ message: "Scheduled maintenance tonight" });
    expect(parsed.level).toBe("info");
  });

  it("trims the message and bounds it at 500 chars", () => {
    expect(BannerSetting.parse({ message: "  hi  " }).message).toBe("hi");
    expect(BannerSetting.safeParse({ message: "x".repeat(500) }).success).toBe(true);
    expect(BannerSetting.safeParse({ message: "x".repeat(501) }).success).toBe(false);
  });

  it("accepts an empty message (no banner)", () => {
    expect(BannerSetting.safeParse({ message: "" }).success).toBe(true);
  });

  it("accepts only the three levels", () => {
    expect(BannerSetting.safeParse({ message: "m", level: "warning" }).success).toBe(true);
    expect(BannerSetting.safeParse({ message: "m", level: "critical" }).success).toBe(true);
    expect(BannerSetting.safeParse({ message: "m", level: "error" }).success).toBe(false);
  });
});

describe("PlatformSettingsInput", () => {
  it("accepts a single setting on its own", () => {
    expect(PlatformSettingsInput.safeParse({ signupMode: "closed" }).success).toBe(true);
    expect(PlatformSettingsInput.safeParse({ rateLimit: { limit: 10, ttlSeconds: 30 } }).success).toBe(true);
    expect(PlatformSettingsInput.safeParse({ reservedSlugs: ["admin", "api"] }).success).toBe(true);
    expect(PlatformSettingsInput.safeParse({ featureFlags: { bioPages: true } }).success).toBe(true);
    expect(PlatformSettingsInput.safeParse({ banner: { message: "hello" } }).success).toBe(true);
  });

  it("rejects an empty body (the at-least-one refine)", () => {
    expect(PlatformSettingsInput.safeParse({}).success).toBe(false);
  });

  it("treats an all-undefined body as empty too", () => {
    expect(PlatformSettingsInput.safeParse({ signupMode: undefined }).success).toBe(false);
  });

  it("bounds reservedSlugs entries and count", () => {
    expect(PlatformSettingsInput.safeParse({ reservedSlugs: [""] }).success).toBe(false);
    expect(PlatformSettingsInput.safeParse({ reservedSlugs: ["x".repeat(65)] }).success).toBe(false);
    expect(PlatformSettingsInput.safeParse({ reservedSlugs: Array(501).fill("a") }).success).toBe(false);
  });

  it("requires featureFlags values to be boolean", () => {
    expect(PlatformSettingsInput.safeParse({ featureFlags: { x: "yes" } }).success).toBe(false);
    expect(PlatformSettingsInput.safeParse({ featureFlags: { x: 1 } }).success).toBe(false);
  });

  it("validates a nested rateLimit through the body", () => {
    expect(PlatformSettingsInput.safeParse({ rateLimit: { limit: 0, ttlSeconds: 30 } }).success).toBe(false);
  });
});

describe("PlatformSettingsValues", () => {
  const valid = {
    signupMode: "open" as const,
    rateLimit: { limit: 120, ttlSeconds: 60 },
    reservedSlugs: ["admin"],
    featureFlags: { bioPages: true },
    banner: { message: "", level: "info" as const },
    newAccountLimits: NEW_ACCOUNT_LIMITS_993,
    botProtection: BOT_PROTECTION_993,
    disposableEmails: DISPOSABLE_EMAILS_993,
  };

  it("accepts a fully-specified effective value set", () => {
    expect(PlatformSettingsValues.safeParse(valid).success).toBe(true);
  });

  it("requires every field (it is the resolved state, not a patch)", () => {
    const { signupMode, ...missing } = valid;
    expect(PlatformSettingsValues.safeParse(missing).success).toBe(false);
  });
});

describe("PlatformSettingMeta", () => {
  it("accepts a never-set setting (both null)", () => {
    expect(PlatformSettingMeta.safeParse({ updatedAt: null, updatedBy: null }).success).toBe(true);
  });

  it("accepts a changed setting", () => {
    expect(
      PlatformSettingMeta.safeParse({ updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "ada@x.com" }).success,
    ).toBe(true);
  });

  it("requires both keys present (nullable, not optional)", () => {
    expect(PlatformSettingMeta.safeParse({ updatedAt: null }).success).toBe(false);
  });
});

describe("PlatformSettings", () => {
  const values = {
    signupMode: "invite_only" as const,
    rateLimit: { limit: 60, ttlSeconds: 60 },
    reservedSlugs: [] as string[],
    featureFlags: {} as Record<string, boolean>,
    banner: { message: "", level: "info" as const },
    newAccountLimits: NEW_ACCOUNT_LIMITS_993,
    botProtection: BOT_PROTECTION_993,
    disposableEmails: DISPOSABLE_EMAILS_993,
  };

  it("accepts values + defaults + per-key meta", () => {
    const parsed = PlatformSettings.safeParse({
      values,
      defaults: values,
      meta: { signupMode: { updatedAt: "2026-11-01T00:00:00.000Z", updatedBy: "ada@x.com" } },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires the defaults block", () => {
    expect(PlatformSettings.safeParse({ values, meta: {} }).success).toBe(false);
  });
});

describe("PlatformBanner", () => {
  it("accepts a banner for the public read", () => {
    expect(PlatformBanner.safeParse({ message: "Down for maintenance", level: "warning" }).success).toBe(true);
  });

  it("requires both message and level (no default on the public read)", () => {
    expect(PlatformBanner.safeParse({ message: "hi" }).success).toBe(false);
  });

  it("accepts an empty message (client renders nothing)", () => {
    expect(PlatformBanner.safeParse({ message: "", level: "info" }).success).toBe(true);
  });
});


describe("NewAccountLimitsSetting (#993)", () => {
  it("accepts the defaults", () => {
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 20, perHour: 10 }).success).toBe(true);
  });

  it("requires all three fields", () => {
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 20 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perHour: 10 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ perDay: 20, perHour: 10 }).success).toBe(false);
  });

  it("allows windowDays 0 (caps off) but not negative or fractional", () => {
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 0, perDay: 20, perHour: 10 }).success).toBe(true);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 365, perDay: 20, perHour: 10 }).success).toBe(true);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 366, perDay: 20, perHour: 10 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: -1, perDay: 20, perHour: 10 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 1.5, perDay: 20, perHour: 10 }).success).toBe(false);
  });

  it("keeps perDay and perHour at least 1 (never zero), integer and bounded", () => {
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 0, perHour: 10 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 20, perHour: 0 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 1, perHour: 1 }).success).toBe(true);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 100_000, perHour: 100_000 }).success).toBe(
      true,
    );
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 100_001, perHour: 10 }).success).toBe(false);
    expect(NewAccountLimitsSetting.safeParse({ windowDays: 7, perDay: 20, perHour: 2.5 }).success).toBe(false);
  });
});

describe("BotProtectionProvider / BotProtectionSetting (#993)", () => {
  it("accepts exactly the three providers", () => {
    for (const p of ["none", "turnstile", "hcaptcha"]) {
      expect(BotProtectionProvider.safeParse(p).success).toBe(true);
    }
  });

  it("rejects any other provider", () => {
    for (const p of ["recaptcha", "None", "", "NONE", "aws-waf"]) {
      expect(BotProtectionProvider.safeParse(p).success).toBe(false);
    }
  });

  it("wraps the provider in the setting object and requires it", () => {
    expect(BotProtectionSetting.safeParse({ provider: "turnstile" }).success).toBe(true);
    expect(BotProtectionSetting.safeParse({}).success).toBe(false);
    expect(BotProtectionSetting.safeParse({ provider: "nope" }).success).toBe(false);
  });
});

describe("DisposableEmailSetting (#993)", () => {
  it("accepts an empty additions list", () => {
    expect(DisposableEmailSetting.safeParse({ extraDomains: [] }).success).toBe(true);
  });

  it("accepts and trims a list of domains", () => {
    const parsed = DisposableEmailSetting.parse({ extraDomains: ["  trashy.test  ", "throwaway.test"] });
    expect(parsed.extraDomains).toEqual(["trashy.test", "throwaway.test"]);
  });

  it("requires the extraDomains key", () => {
    expect(DisposableEmailSetting.safeParse({}).success).toBe(false);
  });

  it("rejects empty entries, over-long entries, and an over-long list", () => {
    expect(DisposableEmailSetting.safeParse({ extraDomains: [""] }).success).toBe(false);
    expect(DisposableEmailSetting.safeParse({ extraDomains: ["x".repeat(254)] }).success).toBe(false);
    expect(DisposableEmailSetting.safeParse({ extraDomains: Array(5_001).fill("a.test") }).success).toBe(false);
  });
});

describe("SignupRefusalReason (#993)", () => {
  it("accepts exactly the five reason codes", () => {
    for (const r of [
      "disposable_email",
      "bot_challenge_missing",
      "bot_challenge_failed",
      "new_account_cap_day",
      "new_account_cap_hour",
    ]) {
      expect(SignupRefusalReason.safeParse(r).success).toBe(true);
    }
  });

  it("rejects an unknown reason code", () => {
    for (const r of ["spam", "bot", "cap", "", "DISPOSABLE_EMAIL"]) {
      expect(SignupRefusalReason.safeParse(r).success).toBe(false);
    }
  });
});

describe("PlatformSettingsInput — the #993 settings", () => {
  it("accepts each #993 setting on its own", () => {
    expect(
      PlatformSettingsInput.safeParse({ newAccountLimits: { windowDays: 7, perDay: 20, perHour: 10 } }).success,
    ).toBe(true);
    expect(PlatformSettingsInput.safeParse({ botProtection: { provider: "hcaptcha" } }).success).toBe(true);
    expect(PlatformSettingsInput.safeParse({ disposableEmails: { extraDomains: ["x.test"] } }).success).toBe(true);
  });

  it("validates a nested #993 setting through the body", () => {
    expect(
      PlatformSettingsInput.safeParse({ newAccountLimits: { windowDays: 7, perDay: 0, perHour: 10 } }).success,
    ).toBe(false);
    expect(PlatformSettingsInput.safeParse({ botProtection: { provider: "recaptcha" } }).success).toBe(false);
  });
});
