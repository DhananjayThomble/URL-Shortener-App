import { describe, expect, it } from "vitest";
import {
  AdminActionResult,
  AdminListQuery,
  AdminMe,
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
