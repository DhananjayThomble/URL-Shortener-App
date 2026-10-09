import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createDatabase, domains, eq, links, projectionOutbox, workspaces, type Database } from "@snapurl/database";
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
    service = new DomainsService(db, { nudge } as never);
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

  afterAll(async () => {
    await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, ownLinkId));
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

  it("re-projects the domain for LINK_PROJECTION=dynamo: one outbox upsert for a link on it, plus a drain nudge", async () => {
    const before = await db.select().from(projectionOutbox).where(eq(projectionOutbox.linkId, ownLinkId));
    await controller.update(
      admin,
      ownDomainWithLinkId,
      pipe.transform({ notFoundRedirect: "https://example.org/missing" }),
    );
    const after = await db.select().from(projectionOutbox).where(eq(projectionOutbox.linkId, ownLinkId));
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)!.operation).toBe("upsert");
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("a domain with no links enqueues nothing and does not nudge", async () => {
    await controller.update(admin, ownDomainId, pipe.transform({ rootRedirect: "https://example.org/r" }));
    expect(nudge).not.toHaveBeenCalled();
  });
});
