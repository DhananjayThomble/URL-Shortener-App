import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
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
