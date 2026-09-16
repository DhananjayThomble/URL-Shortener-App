import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { ConversionsService } from "./conversions.service.js";
import type { RequestActor } from "../auth/auth.guard.js";

/* ============================================================
   A conversion may only reference a link in the caller's own workspace.

   The bug this pins: record() resolved `slug` under a workspace-scoped query,
   but took a caller-supplied `linkId` on trust and wrote it straight into the
   row. Workspace A could therefore book a conversion against workspace B's
   link. That is not only a stray row — the conversions report innerJoins links
   on conversions.linkId, so A's own report would surface B's link.

   The oracle is the slug branch, which has always been scoped correctly: the
   two paths into the same field should agree about who owns the link.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("ConversionsService.record — link ownership", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: ConversionsService;

  const attacker = randomUUID();
  const victim = randomUUID();
  let victimLinkId: string;
  let attackerLinkId: string;

  const actorFor = (workspaceId: string): RequestActor => ({
    userId: randomUUID(),
    workspaceId,
    role: "editor",
    email: "t@e2e.local",
    label: "t",
  });

  const seedLink = async (workspaceId: string, slug: string) => {
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `${slug}.test` })
      .returning({ id: domains.id });
    const id = randomUUID();
    await db.insert(links).values({
      id,
      workspaceId,
      domainId: dom!.id,
      slug,
      destination: "https://example.com/ok",
    });
    return id;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    const stamp = Date.now();
    await db.insert(workspaces).values({ id: attacker, name: "A", slug: `conv-a-${stamp}` });
    await db.insert(workspaces).values({ id: victim, name: "B", slug: `conv-b-${stamp}` });
    victimLinkId = await seedLink(victim, `conv-victim-${stamp}`);
    attackerLinkId = await seedLink(attacker, `conv-own-${stamp}`);
    service = new ConversionsService(db, db);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, attacker));
    await db.delete(workspaces).where(eq(workspaces.id, victim));
    await handle?.close();
  });

  it("records a conversion against a link in the caller's own workspace", async () => {
    const result = await service.record(attacker, actorFor(attacker), {
      linkId: attackerLinkId,
      kind: "sale",
      name: "own link",
      valueMinor: 100,
    } as never);
    expect(result).toBeTruthy();
  });

  it("refuses a linkId belonging to another workspace", async () => {
    // The regression. Before the fix this wrote a row referencing the victim's
    // link, which the attacker's own report would then join and display.
    await expect(
      service.record(attacker, actorFor(attacker), {
        linkId: victimLinkId,
        kind: "sale",
        name: "cross tenant",
        valueMinor: 100,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a linkId that does not exist at all", async () => {
    await expect(
      service.record(attacker, actorFor(attacker), {
        linkId: randomUUID(),
        kind: "sale",
        name: "ghost",
        valueMinor: 100,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
