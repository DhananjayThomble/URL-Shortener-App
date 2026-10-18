import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { PublicLinkPreview } from "@snapurl/contract";
import { PublicService } from "./public.service.js";
import { TokenService } from "../auth/token.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   PublicController#preview -> PublicService.preview, against a real Postgres.

   The trust page's preview is public — no session — so whatever it returns is
   readable by anyone holding the short link. For a password-protected link
   that must not include the destination: the password is what guards it, and
   handing it back here let a visitor read and follow it without the password
   (and without a recorded click).

   Oracle: PublicLinkPreview in packages/contract/src/public.ts — a protected
   link's preview is `passwordProtected: true, destination: null`; an
   unprotected link's carries its destination. The unlock flow (G3) is the
   only way through and returns a token bound to the link, never the URL.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const env = { JWT_ACCESS_SECRET: "test-access-secret", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL_DAYS: 30 } as unknown as Env;

describeDb("PublicService.preview — password-protected links", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let jwt: JwtService;
  let service: PublicService;

  let workspaceId: string;
  let lockedId: string;

  const stamp = Date.now();
  const domainName = `preview-${stamp}.example.com`;
  const openSlug = `open-${stamp}`;
  const lockedSlug = `locked-${stamp}`;
  const OPEN_DEST = `https://example.com/open-${stamp}`;
  const SECRET_DEST = `https://example.com/secret-${stamp}`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    jwt = new JwtService();
    service = new PublicService(db, env, new TokenService(db, env, jwt));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "preview test", slug: `preview-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [domain] = await db
      .insert(domains)
      .values({ workspaceId, domain: domainName, status: "live", ssl: "active" })
      .returning({ id: domains.id });

    await db.insert(links).values({ workspaceId, domainId: domain!.id, slug: openSlug, destination: OPEN_DEST });
    const [locked] = await db
      .insert(links)
      .values({
        workspaceId,
        domainId: domain!.id,
        slug: lockedSlug,
        destination: SECRET_DEST,
        passwordHash: await argon2.hash("hunter2", ARGON),
      })
      .returning({ id: links.id });
    lockedId = locked!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("returns the destination of an unprotected link", async () => {
    const preview = await service.preview(openSlug);
    expect(PublicLinkPreview.parse(preview)).toEqual(preview);
    expect(preview.destination).toBe(OPEN_DEST);
    expect(preview.passwordProtected).toBe(false);
  });

  it("withholds the destination of a password-protected link", async () => {
    const preview = await service.preview(lockedSlug);
    expect(PublicLinkPreview.parse(preview)).toEqual(preview);
    expect(preview.passwordProtected).toBe(true);
    expect(preview.destination).toBeNull();
    // Nowhere in the payload, not just not in the `destination` field.
    expect(JSON.stringify(preview)).not.toContain("secret-");
    expect(preview.shortUrl).toBe(`${domainName}/${lockedSlug}`);
  });

  it("withholds it on the host-scoped lookup too (the redirect's own domain)", async () => {
    const preview = await service.preview(lockedSlug, domainName.toUpperCase());
    expect(preview.destination).toBeNull();
    expect(preview.passwordProtected).toBe(true);
  });

  it("still unlocks with the right password — a token bound to the link, never the URL", async () => {
    await expect(service.unlock(lockedSlug, "wrong")).rejects.toBeInstanceOf(UnauthorizedException);

    const { unlockToken, expiresIn } = await service.unlock(lockedSlug, "hunter2");
    expect(expiresIn).toBe(300);
    expect(unlockToken).not.toContain("secret-");
    const claims = await jwt.verifyAsync<{ sub: string; purpose: string }>(unlockToken, {
      secret: env.JWT_ACCESS_SECRET,
    });
    expect(claims).toMatchObject({ sub: lockedId, purpose: "unlock" });
  });

  it("shows the destination again once the password is removed", async () => {
    await db.update(links).set({ passwordHash: null }).where(eq(links.id, lockedId));
    const preview = await service.preview(lockedSlug);
    expect(preview.passwordProtected).toBe(false);
    expect(preview.destination).toBe(SECRET_DEST);
  });
});
