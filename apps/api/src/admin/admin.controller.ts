import { Controller, Get, UseGuards } from "@nestjs/common";
import type { AdminMe } from "@snapurl/contract";
import { AdminGuard, Admin } from "./admin.guard.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #968 — the platform-admin API surface (/api/v1/admin/*).

   Every route is behind AdminGuard, so reaching any handler here already means
   the caller is a confirmed platform admin (verified allow-listed email + 2FA).
   This first part ships only GET /admin/me; later parts of the epic (#975) add
   the real admin operations, each of which records through writeAdminAuditEntry.
   ============================================================ */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  /** Who the caller is, confirmed as a platform admin. The client uses a 200
   *  here as "you may enter the admin area"; a non-admin gets a 403 from the
   *  guard and never reaches this. */
  @Get("me")
  me(@Admin() admin: AdminIdentity): AdminMe {
    return { id: admin.id, name: admin.name, email: admin.email, isPlatformAdmin: true };
  }
}
