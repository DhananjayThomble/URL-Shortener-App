import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import { createDatabase, inArray, memberships, users, workspaces, type Database } from "@snapurl/database";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import type { TotpService } from "./totp.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   Regression for #477 — concurrent signups sharing a display name.

   `uniqueWorkspaceSlug` used to be check-then-act: a SELECT decided a slug
   was free, and only afterwards did the caller INSERT it. Two concurrent
   registrations with the same display name could both observe the same
   candidate as free (including the un-randomised `Date.now()` fallback once
   the readable ladder was exhausted) and race on `workspaces_slug_key`,
   surfacing to one caller as a raw 23505 -> generic 409 "That already
   exists." — signup failing outright with no clue what conflicted.

   This drives `AuthService.register` concurrently against a real Postgres
   (DATABASE_URL, same convention as the other *.integration.test.ts files)
   rather than asserting against the implementation, so it fails before the
   fix and passes after it. The oracle is the acceptance criteria in #477:
   every concurrent registration with a unique email must succeed, including
   past the 20-entry readable-ladder fallback.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class FakeMail {
  async sendEmailVerification() {}
  async sendPasswordReset() {}
}

const env = {
  JWT_ACCESS_SECRET: "test-access-secret",
  JWT_ACCESS_TTL: "15m",
  JWT_REFRESH_TTL_DAYS: 30,
  DEFAULT_DOMAIN: "snapurl.test",
} as unknown as Env;

describeDb("AuthService workspace slug allocation under concurrency", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let auth: AuthService;
  const createdUserIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  const stamp = Date.now();
  const displayName = `Race Tester ${stamp}`;

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 10 });
    db = handle.db;
    auth = new AuthService(
      db,
      env,
      new TokenService(db, env, new JwtService()),
      {} as unknown as TotpService,
      {} as unknown as OAuthService,
      new FakeMail() as unknown as MailService,
    );
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdWorkspaceIds.length > 0) {
      await db.delete(workspaces).where(inArray(workspaces.id, createdWorkspaceIds));
    }
    await handle.close?.();
  });

  it("registers many accounts sharing a display name concurrently, all succeeding", async () => {
    // 25 concurrent registrations: more than the 20-entry readable ladder
    // (base, base-2 .. base-20), so some are forced onto the fallback path —
    // exactly the regime #477 describes as increasingly likely to collide.
    const CONCURRENCY = 25;
    const emails = Array.from({ length: CONCURRENCY }, (_, i) => `race-${stamp}-${i}@example.com`);

    const results = await Promise.allSettled(
      emails.map((email) => auth.register({ name: displayName, email, password: "a-strong-password-123" })),
    );

    const rejected = results.filter((r) => r.status === "rejected");
    if (rejected.length > 0) {
      // Surface what actually failed rather than just the count, for a
      // useful assertion message if this regresses.
      const reasons = rejected.map((r) => (r as PromiseRejectedResult).reason);
      expect(reasons).toEqual([]);
    }

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const sessions = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof auth.register>>>).value);
    createdUserIds.push(...sessions.map((s) => s.user.id));

    // Every workspace slug allocated must be unique — the invariant the fix
    // establishes at the INSERT rather than at a prior, racy SELECT.
    const membershipRows = await db
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(inArray(memberships.userId, createdUserIds));
    const rows = await db
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(inArray(workspaces.id, membershipRows.map((m) => m.workspaceId)));
    createdWorkspaceIds.push(...rows.map((r) => r.id));

    const slugs = rows.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.length).toBe(CONCURRENCY);
  });
});
