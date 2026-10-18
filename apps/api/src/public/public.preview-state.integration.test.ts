import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import {
  createDatabase,
  domains,
  eq,
  linkCounters,
  links,
  routingRules,
  workspaces,
  type Database,
} from "@snapurl/database";
import { PublicLinkPreview } from "@snapurl/contract";
import { PublicService } from "./public.service.js";
import { TokenService } from "../auth/token.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #764 — the "+" preview must say what a visitor actually gets.

   It said "This link is safe to open" with a Continue button for links the
   redirect refuses (expired, click limit reached, not live yet, archived),
   because preview() returned no lifecycle at all.

   Oracle: the redirect's own gate (`gateFor` in apps/redirect/src/main.ts):
   archived -> 410, a passed expiry -> expiresTo or 410, a reached click limit
   -> 410 (never a fallback), a future start -> scheduledTo or 404. The preview
   must report the same state, and whether routing rules may send a visitor
   elsewhere — WITHOUT the rules, and without the expiresTo / scheduledTo URLs
   (whether those are public for a protected link is decision #802).

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const env = { JWT_ACCESS_SECRET: "test-access-secret", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL_DAYS: 30 } as unknown as Env;

const DAY = 24 * 60 * 60 * 1000;

describeDb("PublicService.preview — link state (#764)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: PublicService;
  let workspaceId: string;
  let domainId: string;

  const stamp = Date.now();
  const domainName = `state-${stamp}.example.com`;
  const DEST = `https://example.com/dest-${stamp}`;
  const EXPIRED_FALLBACK = `https://example.com/expired-fallback-${stamp}`;
  const SCHEDULED_FALLBACK = `https://example.com/scheduled-fallback-${stamp}`;
  const RULE_TARGET = `https://example.com/rule-target-${stamp}`;
  const past = new Date(Date.now() - DAY);
  const future = new Date(Date.now() + 3 * DAY);

  async function link(slug: string, values: Partial<typeof links.$inferInsert> = {}): Promise<string> {
    const [row] = await db
      .insert(links)
      .values({ workspaceId, domainId, slug: `${slug}-${stamp}`, destination: DEST, ...values })
      .returning({ id: links.id });
    return row!.id;
  }
  const preview = async (slug: string) => {
    const p = await service.preview(`${slug}-${stamp}`);
    expect(PublicLinkPreview.parse(p)).toEqual(p);
    // Neither fallback nor any rule target ever appears, in any field.
    const raw = JSON.stringify(p);
    expect(raw).not.toContain("fallback-");
    expect(raw).not.toContain("rule-target-");
    return p;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new PublicService(db, env, new TokenService(db, env, new JwtService()));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "state test", slug: `state-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [domain] = await db
      .insert(domains)
      .values({ workspaceId, domain: domainName, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    domainId = domain!.id;

    await link("plain");
    await link("expiring", { expiresAt: future });
    await link("expired", { expiresAt: past });
    await link("expired-fb", { expiresAt: past, expiresTo: EXPIRED_FALLBACK });
    const limited = await link("limit", { clickLimit: 5, expiresTo: EXPIRED_FALLBACK });
    await db.insert(linkCounters).values({ linkId: limited, clicks: 5 });
    const under = await link("under-limit", { clickLimit: 5 });
    await db.insert(linkCounters).values({ linkId: under, clicks: 4 });
    await link("scheduled", { activatesAt: future });
    await link("scheduled-fb", { activatesAt: future, scheduledTo: SCHEDULED_FALLBACK });
    await link("archived", { archivedAt: past, expiresAt: past, expiresTo: EXPIRED_FALLBACK });
    const ruled = await link("ruled");
    await db.insert(routingRules).values({ linkId: ruled, position: 0, whenCountry: "IN", then: RULE_TARGET });
    const ruledExpired = await link("ruled-expired", { expiresAt: past });
    await db.insert(routingRules).values({ linkId: ruledExpired, position: 0, whenDevice: "mobile", then: RULE_TARGET });
    await link("locked-expired", {
      expiresAt: past,
      expiresTo: EXPIRED_FALLBACK,
      passwordHash: await argon2.hash("hunter2", ARGON),
    });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("reports a plain link as active, with no rules, dates or fallback", async () => {
    expect(await preview("plain")).toMatchObject({
      state: "active",
      expiresAt: null,
      activatesAt: null,
      hasRules: false,
      hasFallback: false,
    });
  });

  it("reports an expiry still ahead as active, and says when", async () => {
    const p = await preview("expiring");
    expect(p.state).toBe("active");
    expect(p.expiresAt).toBe(future.toISOString());
  });

  it("reports a passed expiry as expired, without a fallback when none is set", async () => {
    const p = await preview("expired");
    expect(p).toMatchObject({ state: "expired", expiresAt: past.toISOString(), hasFallback: false });
  });

  it("says an expired link has a fallback, never what it is", async () => {
    expect(await preview("expired-fb")).toMatchObject({ state: "expired", hasFallback: true });
  });

  it("reports a reached click limit apart from expiry, and with no fallback (the redirect never uses one)", async () => {
    expect(await preview("limit")).toMatchObject({ state: "click_limit", hasFallback: false });
    expect((await preview("under-limit")).state).toBe("active");
  });

  it("reports a future start as scheduled, with its date and whether it has a fallback", async () => {
    expect(await preview("scheduled")).toMatchObject({
      state: "scheduled",
      activatesAt: future.toISOString(),
      hasFallback: false,
    });
    expect(await preview("scheduled-fb")).toMatchObject({ state: "scheduled", hasFallback: true });
  });

  it("reports archived above an expiry, with no fallback (the redirect answers 410)", async () => {
    expect(await preview("archived")).toMatchObject({ state: "archived", hasFallback: false });
  });

  it("says a link has routing rules, and nothing about them", async () => {
    const p = await preview("ruled");
    expect(p).toMatchObject({ state: "active", hasRules: true, destination: DEST });
    expect(JSON.stringify(p)).not.toContain('"IN"');
    expect(await preview("ruled-expired")).toMatchObject({ state: "expired", hasRules: true });
  });

  it("reports a protected link's state but discloses nothing about its fallback (#802)", async () => {
    const p = await preview("locked-expired");
    expect(p).toMatchObject({ state: "expired", passwordProtected: true, destination: null, hasFallback: null });
    expect(JSON.stringify(p)).not.toContain("dest-");
  });

  it("does the same on the host-scoped lookup", async () => {
    const p = await service.preview(`expired-fb-${stamp}`, domainName.toUpperCase());
    expect(p).toMatchObject({ state: "expired", hasFallback: true });
  });
});
