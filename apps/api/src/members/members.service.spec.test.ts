import "reflect-metadata";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MembersService } from "./members.service.js";

/* ============================================================
   Issue #345 — privilege escalation.

   PATCH /members/:id is gated @Roles("admin"), but "admin" is not "owner".
   Without a rank check in changeRole, any admin could PATCH their own
   membership to { role: "owner" }, then demote the real owner and take the
   workspace. changeRole now enforces two rank rules against the caller's role:
     1. cannot grant a role higher than your own;
     2. cannot change the role of someone who currently outranks you.

   These are pure guard assertions: the db is stubbed to return the target
   membership, and we assert the method throws BEFORE any update runs. No real
   database, so this runs in the normal unit suite (not the DB-gated one).
   ============================================================ */

function serviceWithTarget(targetRole: string) {
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const insert = vi.fn(() => ({ values: async () => undefined }));
  // this.db.select()...limit() -> [target]; this.db.update() should NEVER be
  // reached on the escalation paths.
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ id: "m1", workspaceId: "w1", role: targetRole }] }),
      }),
    }),
    update,
    insert,
    // #783: the mutation and its audit row share a transaction; the stub runs
    // the callback against itself so update/insert are still observed.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as ConstructorParameters<typeof MembersService>[0];
  // READ_DB + MailService are unused on this path.
  const svc = new MembersService(db, db as never, { send: vi.fn() } as never);
  return { svc, update };
}

describe("MembersService.changeRole — #345 privilege-escalation guards", () => {
  it("an admin cannot grant a role higher than their own (admin -> owner is refused)", async () => {
    const { svc, update } = serviceWithTarget("admin");
    await expect(
      svc.changeRole("w1", "m1", "owner" as never, "Admin User", "admin"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("an admin cannot change the role of an owner (target outranks caller)", async () => {
    const { svc, update } = serviceWithTarget("owner");
    await expect(
      svc.changeRole("w1", "m1", "editor" as never, "Admin User", "admin"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("an unknown caller role fails closed (cannot grant anything)", async () => {
    const { svc, update } = serviceWithTarget("editor");
    await expect(
      svc.changeRole("w1", "m1", "editor" as never, "Nobody", "banana"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it("an owner may still grant owner (rank permits it)", async () => {
    const { svc, update } = serviceWithTarget("editor");
    await svc.changeRole("w1", "m1", "owner" as never, "Owner User", "owner");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   Issue #700 item 2 — a pending ('invited') membership must not leak the
   resolved account's details through GET /members.

   When an invited email already has an account, list()'s LEFT JOIN resolves
   that user row. Pre-acceptance, the invitee has NOT agreed to join, so their
   name, 2FA status, per-workspace link count and last-active time are not the
   workspace's to see — only the invited email + invite metadata (role, status,
   invitedAt) may surface. The readDb is stubbed to return exactly that leaky
   shape (an 'invited' row joined to a fully-populated user).
   ============================================================ */

function serviceWithListRows(rows: unknown[]) {
  const readDb = {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: async () => rows }),
        }),
      }),
    }),
  } as unknown as ConstructorParameters<typeof MembersService>[1];
  const svc = new MembersService({} as never, readDb, { sendInvite: vi.fn() } as never);
  return svc;
}

describe("MembersService.list — #700 pending invites expose only the invited email", () => {
  it("does not surface the resolved account's name, 2FA, links or last-active for an 'invited' row", async () => {
    const svc = serviceWithListRows([
      {
        membership: {
          id: "m-invited",
          email: "invitee@example.com",
          role: "editor",
          status: "invited",
          invitedAt: new Date("2026-01-01T00:00:00.000Z"),
          lastActiveAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        // The invited email already has an account — the LEFT JOIN resolves it.
        user: { name: "Real Name", totpEnabledAt: new Date("2025-01-01T00:00:00.000Z") },
        linkCount: 7,
      },
    ]);

    const [member] = await svc.list("w1");

    expect(member.email).toBe("invitee@example.com");
    expect(member.status).toBe("invited");
    expect(member.role).toBe("editor");
    expect(member.invitedAt).toBe("2026-01-01T00:00:00.000Z");
    // Nothing from the resolved account may leak before acceptance.
    expect(member.name).toBe("invitee@example.com");
    expect(member.twoFactor).toBe(false);
    expect(member.links).toBe(0);
    expect(member.lastActive).toBeNull();
    expect(member.initials).toBe("IN");
  });

  it("still surfaces the full details for an 'active' member", async () => {
    const svc = serviceWithListRows([
      {
        membership: {
          id: "m-active",
          email: "member@example.com",
          role: "admin",
          status: "active",
          invitedAt: new Date("2026-01-01T00:00:00.000Z"),
          lastActiveAt: new Date("2026-02-02T00:00:00.000Z"),
        },
        user: { name: "Active Member", totpEnabledAt: new Date("2025-01-01T00:00:00.000Z") },
        linkCount: 7,
      },
    ]);

    const [member] = await svc.list("w1");

    expect(member.name).toBe("Active Member");
    expect(member.twoFactor).toBe(true);
    expect(member.links).toBe(7);
    expect(member.lastActive).toBe("2026-02-02T00:00:00.000Z");
    expect(member.invitedAt).toBeNull();
  });
});

/* ============================================================
   Issue #700 item 1 — an admin can resend a pending/expired invitation.

   resend() regenerates the token (so an expired invite becomes valid again),
   refreshes invitedAt (resetting the 7-day TTL), persists the new token hash,
   re-sends the mail and writes an audit row. It returns the invited (email-only)
   Member shape. It 404s when there's no invited membership and refuses an
   active member (nothing to resend).
   ============================================================ */

function serviceForResend(target: Record<string, unknown> | undefined) {
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const insert = vi.fn(() => ({ values: async () => undefined }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (target ? [target] : []) }),
      }),
    }),
    update,
    insert,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as ConstructorParameters<typeof MembersService>[0];
  const sendInvite = vi.fn(async () => undefined);
  const svc = new MembersService(db, db as never, { sendInvite } as never);
  return { svc, update, insert, sendInvite };
}

describe("MembersService.resend — #700 admin resend of a pending invite", () => {
  it("regenerates the token, refreshes invitedAt, re-sends mail, writes audit, returns the invited shape", async () => {
    const { svc, update, insert, sendInvite } = serviceForResend({
      id: "m1",
      workspaceId: "w1",
      email: "invitee@example.com",
      role: "editor",
      status: "invited",
      invitedAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const result = await svc.resend("w1", "m1", "Admin User");

    expect(sendInvite).toHaveBeenCalledTimes(1);
    const sent = sendInvite.mock.calls[0]![0] as { to: string; token: string; invitedBy: string };
    expect(sent.to).toBe("invitee@example.com");
    expect(typeof sent.token).toBe("string");
    expect(sent.token.length).toBeGreaterThan(0);
    expect(sent.invitedBy).toBe("Admin User");

    // A new token hash and a fresh invitedAt are persisted.
    expect(update).toHaveBeenCalledTimes(1);
    // The audit row is written.
    expect(insert).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({
      id: "m1",
      email: "invitee@example.com",
      name: "invitee@example.com",
      role: "editor",
      status: "invited",
      links: 0,
      lastActive: null,
      twoFactor: false,
    });
  });

  it("throws NotFoundException when no invited membership exists", async () => {
    const { svc, update, sendInvite } = serviceForResend(undefined);
    await expect(svc.resend("w1", "missing", "Admin User")).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });

  it("refuses to resend to an already-active member", async () => {
    const { svc, update, sendInvite } = serviceForResend({
      id: "m1",
      workspaceId: "w1",
      email: "member@example.com",
      role: "admin",
      status: "active",
    });
    await expect(svc.resend("w1", "m1", "Admin User")).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(sendInvite).not.toHaveBeenCalled();
  });
});
