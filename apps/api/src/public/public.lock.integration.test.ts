import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { PublicLinkLock, PublicLinkPreview, UnlockLinkInput } from "@snapurl/contract";
import { PublicService } from "./public.service.js";
import { TokenService } from "../auth/token.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #762 — a password-protected link must be unlockable whether or not the
   owner allows public previews, and no public response may carry its
   destination before the right password.

   The redirect bounces a protected link to /p/<slug>?unlock=1. That page used
   to need the preview to render the password form, and the preview 403s when
   previews are off, so the link could not be opened at all. The unlock flow
   now has its own minimal payload, PublicLinkLock (packages/contract
   src/public.ts): the short URL and whether a password guards it — nothing the
   previews switch exists to hide, and never the destination.

   Oracle: packages/contract/src/public.ts (PublicLinkLock, PublicLinkPreview,
   UnlockLinkInput, UnlockLinkResult) and the redirect's gate order in
   apps/redirect/src/main.ts (archived/expired are refused before the password
   check, so an unlock token cannot revive them).

   Every assertion that a response does not leak serialises the WHOLE thing —
   payload or exception body — and looks for the destination's unique marker.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const env = { JWT_ACCESS_SECRET: "test-access-secret", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL_DAYS: 30 } as unknown as Env;
const PASSWORD = "hunter2";

/** Run `fn`, expect it to throw an HttpException, return that exception. */
async function rejection(fn: () => Promise<unknown>): Promise<HttpException> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    return err as HttpException;
  }
  throw new Error("expected the call to throw");
}

/** Everything a client could see from a response or an error, as one string. */
function wire(value: unknown): string {
  if (value instanceof HttpException) return JSON.stringify({ status: value.getStatus(), body: value.getResponse() });
  return JSON.stringify(value);
}

describeDb("PublicService — unlocking a password-protected link (#762)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let jwt: JwtService;
  let service: PublicService;

  const stamp = `${Date.now()}`;
  /* Unique marker in every destination, so a leak is found wherever it lands. */
  const MARK = `sekret762-${stamp}`;
  const dest = (name: string) => `https://example.com/${MARK}/${name}`;
  const domainName = `lock-${stamp}.example.com`;

  /* One workspace per previews setting, so the switch is the only variable. */
  const ws = { on: "", off: "" };
  const ids: Record<string, string> = {};
  const slug = (name: string) => `${name}-${stamp}`;
  /* #800 — one slug, two domains. Mixed case so the same lookups also prove
     case-insensitivity holds under host scoping. */
  const COLLIDE = `Vault-${stamp}`;

  async function seedWorkspace(key: "on" | "off") {
    const [w] = await db
      .insert(workspaces)
      .values({ name: `lock ${key}`, slug: `lock-${key}-${stamp}`, publicPreviews: key === "on" })
      .returning({ id: workspaces.id });
    ws[key] = w!.id;
    const [d] = await db
      .insert(domains)
      .values({ workspaceId: w!.id, domain: `${key}.${domainName}`, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    return d!.id;
  }

  async function seedLink(
    name: string,
    workspaceKey: "on" | "off",
    domainId: string,
    extra: Partial<typeof links.$inferInsert> = {},
  ) {
    const [row] = await db
      .insert(links)
      .values({ workspaceId: ws[workspaceKey], domainId, slug: slug(name), destination: dest(name), ...extra })
      .returning({ id: links.id });
    ids[name] = row!.id;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    jwt = new JwtService();
    service = new PublicService(db, env, new TokenService(db, env, jwt));

    const hash = await argon2.hash(PASSWORD, ARGON);
    const onDomain = await seedWorkspace("on");
    const offDomain = await seedWorkspace("off");

    await seedLink("on-locked", "on", onDomain, { passwordHash: hash });
    await seedLink("on-open", "on", onDomain);
    // Workspace allows previews, this one link opts out.
    await seedLink("on-locked-optout", "on", onDomain, { passwordHash: hash, publicPreview: false });
    await seedLink("off-locked", "off", offDomain, { passwordHash: hash });
    await seedLink("off-open", "off", offDomain);
    await seedLink("off-locked-archived", "off", offDomain, { passwordHash: hash, archivedAt: new Date() });
    await seedLink("off-locked-expired", "off", offDomain, {
      passwordHash: hash,
      expiresAt: new Date(Date.now() - 60_000),
    });

    /* #800 — the same slug on two different domains. Uniqueness is
       (domain_id, lower(slug)), so this is allowed, and a hostless lookup can
       answer for the wrong row. Each row has its OWN password, so a lookup
       scoped to the wrong host would reject the right password. */
    const onHash = await argon2.hash(`${PASSWORD}-on`, ARGON);
    const offHash = await argon2.hash(`${PASSWORD}-off`, ARGON);
    await db
      .insert(links)
      .values({ workspaceId: ws.on, domainId: onDomain, slug: COLLIDE, destination: dest("collide-on"), passwordHash: onHash });
    await db
      .insert(links)
      .values({ workspaceId: ws.off, domainId: offDomain, slug: COLLIDE, destination: dest("collide-off"), passwordHash: offHash });
  });

  afterAll(async () => {
    for (const id of [ws.on, ws.off]) if (id) await db.delete(workspaces).where(eq(workspaces.id, id));
    await handle?.close();
  });

  async function expectUnlockToken(name: string) {
    const result = await service.unlock(slug(name), PASSWORD);
    expect(wire(result)).not.toContain(MARK);
    expect(result.expiresIn).toBe(300);
    const claims = await jwt.verifyAsync<{ sub: string; purpose: string }>(result.unlockToken, {
      secret: env.JWT_ACCESS_SECRET,
    });
    expect(claims).toMatchObject({ sub: ids[name], purpose: "unlock" });
  }

  describe.each([
    { previews: "on", name: "on-locked" },
    { previews: "on, link opted out", name: "on-locked-optout" },
    { previews: "off", name: "off-locked" },
  ])("previews $previews — protected link", ({ name }) => {
    it("lock() names the link as protected and carries no destination", async () => {
      const lock = await service.lock(slug(name));
      expect(PublicLinkLock.strict().parse(lock)).toEqual(lock);
      expect(lock).toEqual({ shortUrl: expect.stringMatching(new RegExp(`/${slug(name)}$`)), passwordProtected: true });
      expect(wire(lock)).not.toContain(MARK);
    });

    it("the right password unlocks — a token bound to the link, never the URL", async () => {
      await expectUnlockToken(name);
    });

    it("a wrong password is refused without the destination", async () => {
      const err = await rejection(() => service.unlock(slug(name), "not-the-password"));
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(wire(err)).not.toContain(MARK);
    });

    it("an empty password is refused without the destination", async () => {
      // The controller's zod pipe rejects it first; the service must hold too.
      expect(UnlockLinkInput.safeParse({ password: "" }).success).toBe(false);
      const err = await rejection(() => service.unlock(slug(name), ""));
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(wire(err)).not.toContain(MARK);
    });
  });

  it("previews on: the preview still withholds a protected link's destination", async () => {
    const preview = await service.preview(slug("on-locked"));
    expect(PublicLinkPreview.parse(preview)).toEqual(preview);
    expect(preview).toMatchObject({ passwordProtected: true, destination: null });
    expect(wire(preview)).not.toContain(MARK);
  });

  it.each(["off-locked", "on-locked-optout", "off-open"])(
    "previews off: the preview of %s is refused (403) without the destination",
    async (name) => {
      const err = await rejection(() => service.preview(slug(name)));
      expect(err.getStatus()).toBe(403);
      expect(wire(err)).not.toContain(MARK);
    },
  );

  it("previews off, no password: lock() says so, still without the destination", async () => {
    const lock = await service.lock(slug("off-open"));
    expect(lock).toEqual({ shortUrl: `off.${domainName}/${slug("off-open")}`, passwordProtected: false });
    expect(wire(lock)).not.toContain(MARK);
    const err = await rejection(() => service.unlock(slug("off-open"), PASSWORD));
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(wire(err)).not.toContain(MARK);
  });

  it("works on the host-scoped lookup (the redirect's own domain), case-insensitively", async () => {
    const host = `OFF.${domainName.toUpperCase()}`;
    const lock = await service.lock(slug("off-locked").toUpperCase(), host);
    expect(lock).toEqual({ shortUrl: `off.${domainName}/${slug("off-locked")}`, passwordProtected: true });
    // The same slug on another workspace's domain is not this link.
    await expect(service.lock(slug("off-locked"), `on.${domainName}`)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("an unknown slug is a 404 on lock, unlock and preview, naming nothing", async () => {
    for (const call of [
      () => service.lock(`nope-${stamp}`),
      () => service.unlock(`nope-${stamp}`, PASSWORD),
      () => service.preview(`nope-${stamp}`),
    ]) {
      const err = await rejection(call);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(wire(err)).not.toContain(MARK);
    }
  });

  it.each(["off-locked-archived", "off-locked-expired"])(
    "%s: lock() and unlock() hand out no destination (the redirect refuses it before the password)",
    async (name) => {
      const lock = await service.lock(slug(name));
      expect(lock.passwordProtected).toBe(true);
      expect(wire(lock)).not.toContain(MARK);
      await expectUnlockToken(name);
      const err = await rejection(() => service.unlock(slug(name), "wrong"));
      expect(wire(err)).not.toContain(MARK);
    },
  );

  it("deploy skew: a protected link's preview keeps the shape an older web build parses", async () => {
    // Old web only ever calls preview + unlock; neither changed shape.
    const preview = await service.preview(slug("on-locked"));
    expect(Object.keys(preview).sort()).toEqual(Object.keys(PublicLinkPreview.shape).sort());
  });

  /* #800 — the same slug lives on two domains with two different passwords.
     Every public call must be scoped to the host the redirect resolved, or it
     answers for the wrong domain's link: the correct password gets rejected,
     the wrong short URL is handed back, or (previews off vs on) the wrong
     privacy answer is given. Host comes in URL-encoded and mixed-case from the
     redirect, so the lookups exercise case-insensitivity too. */
  describe("same slug on two domains is scoped by host", () => {
    const onHost = `on.${domainName}`;
    const offHost = `off.${domainName}`;

    it("lock(): each host gets its own domain's short URL, mixed case and all", async () => {
      const onLock = await service.lock(COLLIDE.toLowerCase(), onHost.toUpperCase());
      expect(onLock).toEqual({ shortUrl: `${onHost}/${COLLIDE}`, passwordProtected: true });
      const offLock = await service.lock(COLLIDE, offHost);
      expect(offLock).toEqual({ shortUrl: `${offHost}/${COLLIDE}`, passwordProtected: true });
      expect(onLock.shortUrl).not.toBe(offLock.shortUrl);
    });

    it("unlock(): the right password for a host unlocks it and is rejected on the other host", async () => {
      const onToken = await service.unlock(COLLIDE, `${PASSWORD}-on`, onHost);
      const onClaims = await jwt.verifyAsync<{ sub: string }>(onToken.unlockToken, { secret: env.JWT_ACCESS_SECRET });
      const offToken = await service.unlock(COLLIDE, `${PASSWORD}-off`, offHost);
      const offClaims = await jwt.verifyAsync<{ sub: string }>(offToken.unlockToken, { secret: env.JWT_ACCESS_SECRET });
      // Two distinct links — the tokens are bound to different ids.
      expect(onClaims.sub).not.toBe(offClaims.sub);
      // on's password is NOT off's password: scoped to the right host it fails.
      await expect(service.unlock(COLLIDE, `${PASSWORD}-on`, offHost)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.unlock(COLLIDE, `${PASSWORD}-off`, onHost)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("preview(): the privacy answer follows the resolved host, not whichever row sorts first", async () => {
      // on's workspace allows previews; off's does not. Scoped correctly, the
      // on-host preview resolves (destination still null — it is protected) and
      // the off-host preview is refused. A hostless lookup could answer either.
      const onPreview = await service.preview(COLLIDE, onHost);
      expect(onPreview).toMatchObject({ passwordProtected: true, destination: null });
      expect(wire(onPreview)).not.toContain(MARK);
      const err = await rejection(() => service.preview(COLLIDE, offHost));
      expect(err.getStatus()).toBe(403);
      expect(wire(err)).not.toContain(MARK);
    });
  });
});
