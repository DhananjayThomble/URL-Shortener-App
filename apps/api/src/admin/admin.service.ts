import { Inject, Injectable } from "@nestjs/common";
import { eq, users, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { ENV, platformAdminEmails, type Env } from "../config/env.js";

/** The live user facts the admin check reads. Resolved from the DB, never from
 *  the JWT: the token's claims (role, email) can be stale, but platform-admin
 *  is a standing, security-critical status that must reflect the row right now. */
export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class AdminService {
  /** PLATFORM_ADMIN_EMAILS, parsed once at construction into a lower-cased set. */
  private readonly allowlist: Set<string>;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) env: Env,
  ) {
    this.allowlist = platformAdminEmails(env.PLATFORM_ADMIN_EMAILS);
  }

  /**
   * Resolve the platform-admin identity for a user id, or null if they are not
   * one.
   *
   * A user is a platform admin only if ALL THREE hold against their live row:
   *   1. their email (lower-cased) is in PLATFORM_ADMIN_EMAILS,
   *   2. that email is VERIFIED (emailVerifiedAt is set), and
   *   3. two-factor login is enabled (totpEnabledAt is set).
   *
   * Fails closed everywhere: a null userId (an API-key caller), an empty
   * allowlist, a missing user, an unverified email, or 2FA off all return null.
   * Nothing in the application can grant the role — it is derived entirely from
   * operator-set config and the user's own verified security state.
   */
  async resolveAdmin(userId: string | null): Promise<AdminIdentity | null> {
    if (!userId) return null;
    // An empty allowlist means no admins — skip the query entirely.
    if (this.allowlist.size === 0) return null;

    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        totpEnabledAt: users.totpEnabledAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return null;
    if (!this.allowlist.has(row.email.toLowerCase())) return null;
    if (!row.emailVerifiedAt) return null;
    if (!row.totpEnabledAt) return null;

    return { id: row.id, name: row.name, email: row.email };
  }

  /** True when the user id resolves to a platform admin. */
  async isAdmin(userId: string | null): Promise<boolean> {
    return (await this.resolveAdmin(userId)) !== null;
  }
}
