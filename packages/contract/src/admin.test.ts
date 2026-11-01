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
