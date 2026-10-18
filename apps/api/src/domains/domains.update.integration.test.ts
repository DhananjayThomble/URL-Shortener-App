import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
  and,
  auditLog,
  createDatabase,
  desc,
  domains,
  eq,
  links,
  projectionOutbox,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { UpdateDomainInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { REQUIRED_ROLES, REQUIRED_SCOPE, satisfiesRole, type RequestActor } from "../auth/auth.guard.js";
import { DomainsController } from "./domains.controller.js";
import { DomainsService } from "./domains.service.js";

/* ============================================================
   #648 — PATCH /domains/:id sets, changes and clears a domain's root and
   404 redirects.

   Oracles (none of them this file's implementation):
     - packages/contract: Domain.rootRedirect / notFoundRedirect, and the
       SSRF-guarded HttpUrl that AddDomainInput already uses for them.
     - the role gate every other domain mutation declares: @Roles("admin")
       + @Scope("domains:write").
     - the multi-tenancy invariant: no workspace may write a row it does not
       own; the shared system domain (workspace_id NULL, is_system true) is
       owned by nobody, and a redirect set on it would capture every
       workspace's root/404 traffic.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
  resolveTxt: vi.fn(),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService.update / PATCH /domains/:id (#648)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: DomainsService;
  let controller: DomainsController;
  const nudge = vi.fn();

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const own = randomUUID();
  const other = randomUUID();
  let ownDomainId: string;
  let ownDomainWithLinkId: string;
  let ownLinkId: string;
  let otherDomainId: string;
  let sharedDomainId: string;
  const sharedName = `shared-${stamp}.test`;

  const admin: RequestActor = {
    userId: null,
    workspaceId: own,
    role: "admin",
    email: "admin@example.com",
    label: "admin@example.com",
  };
  const pipe = zodBody(UpdateDomainInput);

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new DomainsService(db, { nudge } as never, { DEFAULT_DOMAIN: "snap.example.com" } as never);
    controller = new DomainsController(service);

    await db.insert(workspaces).values({ id: own, name: "own", slug: `dom-own-${stamp}` });
    await db.insert(workspaces).values({ id: other, name: "other", slug: `dom-other-${stamp}` });

    const [d1] = await db
      .insert(domains)
      .values({ workspaceId: own, domain: `own-${stamp}.test`, rootRedirect: "https://example.org/old-root" })
      .returning({ id: domains.id });
    ownDomainId = d1!.id;

    const [d2] = await db
      .insert(domains)
      .values({ workspaceId: own, domain: `own-links-${stamp}.test` })
      .returning({ id: domains.id });
    ownDomainWithLinkId = d2!.id;
    ownLinkId = randomUUID();
    await db.insert(links).values({
      id: ownLinkId,
      workspaceId: own,
      domainId: ownDomainWithLinkId,
      slug: `dl-${stamp}`,
      destination: "https://example.com/ok",
    });

    const [d3] = await db
      .insert(domains)
      .values({ workspaceId: other, domain: `other-${stamp}.test`, rootRedirect: "https://example.org/other" })
      .returning({ id: domains.id });
    otherDomainId = d3!.id;

    // Modelled exactly like the seeded shared domain: no owner, is_system.
    const [d4] = await db
      .insert(domains)
      .values({ workspaceId: null, domain: sharedName, isSystem: true, status: "live" })
      .returning({ id: domains.id });
    sharedDomainId = d4!.id;
  });

  /** Outbox rows queued for a domain (a domain op carries the domain id in link_id). */
  const outboxFor = (domainId: string) =>
    db.select().from(projectionOutbox).where(eq(projectionOutbox.linkId, domainId)).orderBy(projectionOutbox.id);

  afterAll(async () => {
    await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, ownLinkId));
    for (const id of [ownDomainId, ownDomainWithLinkId]) {
      await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, id));
    }
    await db.execute(sql`delete from projection_outbox where payload->>'host' like ${`%-${stamp}.test`}`);
    await db.delete(links).where(eq(links.id, ownLinkId));
    await db.delete(domains).where(eq(domains.id, sharedDomainId));
    await db.delete(workspaces).where(eq(workspaces.id, own));
    await db.delete(workspaces).where(eq(workspaces.id, other));
    await handle?.close();
  });

  beforeEach(() => {
    // Every public name resolves to a public address unless a test says otherwise.
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
    nudge.mockReset();
  });

  const read = async (id: string) => {
    const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    return row!;
  };

  it("sets both redirects and returns them in the Domain DTO", async () => {
    const body = pipe.transform({
      rootRedirect: "https://example.org/new-root",
      notFoundRedirect: "https://example.org/not-found",
    });
    const dto = await controller.update(admin, ownDomainId, body);
    expect(dto.rootRedirect).toBe("https://example.org/new-root");
    expect(dto.notFoundRedirect).toBe("https://example.org/not-found");
    const row = await read(ownDomainId);
    expect(row.rootRedirect).toBe("https://example.org/new-root");
    expect(row.notFoundRedirect).toBe("https://example.org/not-found");
  });

  it("an omitted field is left alone; null clears", async () => {
    await controller.update(admin, ownDomainId, pipe.transform({ rootRedirect: null }));
    const row = await read(ownDomainId);
    expect(row.rootRedirect).toBeNull();
    expect(row.notFoundRedirect).toBe("https://example.org/not-found");

    await controller.update(admin, ownDomainId, pipe.transform({ notFoundRedirect: null }));
    expect((await read(ownDomainId)).notFoundRedirect).toBeNull();
  });

  it("refuses the shared system domain with a 409, and the row is untouched", async () => {
    await expect(
      controller.update(admin, sharedDomainId, pipe.transform({ rootRedirect: "https://example.org/hijack" })),
    ).rejects.toBeInstanceOf(ConflictException);
    const row = await read(sharedDomainId);
    expect(row.rootRedirect).toBeNull();
    expect(row.notFoundRedirect).toBeNull();
  });

  it("another workspace's domain is a 404, and the row is untouched", async () => {
    await expect(
      controller.update(admin, otherDomainId, pipe.transform({ rootRedirect: "https://example.org/hijack" })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await read(otherDomainId)).rootRedirect).toBe("https://example.org/other");
  });

  it("an unknown id is a 404", async () => {
    await expect(
      controller.update(admin, randomUUID(), pipe.transform({ rootRedirect: "https://example.org/x" })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ["javascript:", { rootRedirect: "javascript:alert(1)" }],
    ["data:", { notFoundRedirect: "data:text/html;base64,PHNjcmlwdD4=" }],
    ["file:", { rootRedirect: "file:///etc/passwd" }],
    ["metadata IP", { rootRedirect: "http://169.254.169.254/latest/meta-data/" }],
    ["loopback", { notFoundRedirect: "http://127.0.0.1:3001/" }],
    ["localhost", { rootRedirect: "http://localhost/" }],
    ["private v4", { rootRedirect: "http://10.0.0.5/admin" }],
    ["ipv6 loopback", { rootRedirect: "http://[::1]/" }],
    ["relative", { rootRedirect: "/elsewhere" }],
    ["protocol-relative", { rootRedirect: "//evil.example/" }],
    ["empty string", { rootRedirect: "" }],
    ["empty body", {}],
    ["unknown key (cannot re-home or re-flag a domain)", { rootRedirect: null, isSystem: false }],
    ["unknown key domain", { domain: "x.example.com" }],
  ])("the pipe rejects %s", (_label, raw) => {
    expect(() => pipe.transform(raw)).toThrow(BadRequestException);
  });

  it("rejects a name that only RESOLVES to a denied address (DNS half of the SSRF guard)", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const body = pipe.transform({ rootRedirect: "http://rebind.example.org/" });
    await expect(controller.update(admin, ownDomainId, body)).rejects.toBeInstanceOf(BadRequestException);
    expect((await read(ownDomainId)).rootRedirect).toBeNull();
  });

  it("is gated exactly like the other domain mutations: admin role + domains:write scope", () => {
    const reflector = new Reflector();
    const handler = DomainsController.prototype.update;
    const roles = reflector.get<string[]>(REQUIRED_ROLES, handler);
    expect(roles).toEqual(reflector.get<string[]>(REQUIRED_ROLES, DomainsController.prototype.remove));
    expect(reflector.get<string>(REQUIRED_SCOPE, handler)).toBe("domains:write");
    expect(satisfiesRole("editor", roles)).toBe(false);
    expect(satisfiesRole("viewer", roles)).toBe(false);
    expect(satisfiesRole("admin", roles)).toBe(true);
    expect(satisfiesRole("owner", roles)).toBe(true);
  });

  it("re-projects the domain for LINK_PROJECTION=dynamo: one domain-scoped outbox op, plus a drain nudge", async () => {
    const before = await outboxFor(ownDomainWithLinkId);
    await controller.update(
      admin,
      ownDomainWithLinkId,
      pipe.transform({ notFoundRedirect: "https://example.org/missing" }),
    );
    const after = await outboxFor(ownDomainWithLinkId);
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)!.operation).toBe("domain");
    expect(after.at(-1)!.payload).toMatchObject({ domainId: ownDomainWithLinkId, host: `own-links-${stamp}.test` });
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  /* #711 review, Blocker-1: the domain-meta item was only ever re-projected
     piggy-backed on a link upsert, so a domain with NO links (a freshly
     connected one, or one whose last link was deleted) never had a set /
     change / clear reach the redirect service under LINK_PROJECTION=dynamo. */
  it("a domain with no links still enqueues a domain-scoped projection op and nudges", async () => {
    const before = await outboxFor(ownDomainId);
    await controller.update(admin, ownDomainId, pipe.transform({ rootRedirect: "https://example.org/r" }));
    const after = await outboxFor(ownDomainId);
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)!.operation).toBe("domain");
    expect(after.at(-1)!.payload).toMatchObject({ domainId: ownDomainId, host: `own-${stamp}.test` });
    expect(nudge).toHaveBeenCalledTimes(1);

    // Clearing is enqueued the same way: a revocation must reach the edge too.
    await controller.update(admin, ownDomainId, pipe.transform({ rootRedirect: null }));
    expect((await outboxFor(ownDomainId)).length - after.length).toBe(1);
  });

  it("connecting a domain WITH redirects enqueues its domain op; disconnecting enqueues one to drop the meta item", async () => {
    const host = `own-add-${stamp}.test`;
    const dto = await service.add(own, { domain: host, rootRedirect: "https://example.org/at-create" }, admin);
    const queued = await outboxFor(dto.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.operation).toBe("domain");
    expect(queued[0]!.payload).toMatchObject({ domainId: dto.id, host });

    await service.remove(own, dto.id, admin);
    const afterRemove = await outboxFor(dto.id);
    expect(afterRemove).toHaveLength(2);
    expect(afterRemove.at(-1)!.payload).toMatchObject({ domainId: dto.id, host });
  });

  /* #711 review, Minor-3: a redirect back to the domain being edited is a loop. */
  it.each([
    ["root to its own root", { rootRedirect: "https://LOOP-HOST/" }],
    ["404 to its own missing slug", { notFoundRedirect: "https://loop-host/still-missing" }],
    ["http variant", { rootRedirect: "http://loop-host/x" }],
    ["trailing-dot host", { rootRedirect: "https://loop-host./" }],
  ])("refuses a redirect loop: %s (400, nothing stored)", async (_label, raw) => {
    const host = `own-${stamp}.test`;
    const body = JSON.parse(JSON.stringify(raw).replaceAll("loop-host", host).replaceAll("LOOP-HOST", host.toUpperCase()));
    const before = await read(ownDomainId);
    await expect(controller.update(admin, ownDomainId, pipe.transform(body))).rejects.toBeInstanceOf(BadRequestException);
    const row = await read(ownDomainId);
    expect(row.rootRedirect).toBe(before.rootRedirect);
    expect(row.notFoundRedirect).toBe(before.notFoundRedirect);
  });

  it("a redirect to a DIFFERENT subdomain of the same parent is not a loop", async () => {
    const dto = await controller.update(
      admin,
      ownDomainId,
      pipe.transform({ rootRedirect: `https://www.own-${stamp}.test/` }),
    );
    expect(dto.rootRedirect).toBe(`https://www.own-${stamp}.test/`);
  });

  it("refuses a self-loop at create time too", async () => {
    const host = `own-loop-add-${stamp}.test`;
    await expect(service.add(own, { domain: host, notFoundRedirect: `https://${host}/x` }, admin)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /* #711 review, Minor-6: the audit entry must let a redirect change be
     reconstructed, i.e. carry the old and new values of what changed. */
  it("the domain.updated audit entry records before/after values of the changed fields only", async () => {
    await controller.update(
      admin,
      ownDomainId,
      pipe.transform({ rootRedirect: "https://example.org/audit-before", notFoundRedirect: "https://example.org/nf-keep" }),
    );
    await controller.update(admin, ownDomainId, pipe.transform({ rootRedirect: "https://example.org/audit-after" }));
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, ownDomainId), eq(auditLog.action, "domain.updated")))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(entry!.metadata).toMatchObject({
      domain: `own-${stamp}.test`,
      fields: ["rootRedirect"],
      changes: { rootRedirect: { from: "https://example.org/audit-before", to: "https://example.org/audit-after" } },
    });
    expect((entry!.metadata as { changes: Record<string, unknown> }).changes).not.toHaveProperty("notFoundRedirect");

    await controller.update(admin, ownDomainId, pipe.transform({ notFoundRedirect: null }));
    const [cleared] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, ownDomainId), eq(auditLog.action, "domain.updated")))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(cleared!.metadata).toMatchObject({
      changes: { notFoundRedirect: { from: "https://example.org/nf-keep", to: null } },
    });
  });
});
