import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  domains,
  eq,
  links,
  memberships,
  planVersions,
  plans,
  usageWarnings,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { FeatureMatrix, LimitMatrix } from "@snapurl/contract";
import { PlansService } from "./plans.service.js";
import { UsageService } from "./usage.service.js";

/* ============================================================
   #970 — usage against limits + the owner 80%/100% warnings, asserted on the
   rows this test seeds (shared DB — never on table counts).

   Oracle (issue §7): a workspace sees its usage against limits; owners get an
   in-app + email warning at 80% and 100%.
     - a plan with links=2: a workspace with 2 links is at 100% -> a "full"
       warning row exists AND the owner got one email;
     - re-evaluating at the same band does NOT re-email (dedup);
     - the usage view reports used/limit/percent per limit.

   Red-on-broken: if evaluateWarnings did not insert the row (or email), the
   warning + mail assertions fail; if it re-emailed every call, the dedup
   assertion fails.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

class CapturingMail {
  sends: Array<{ to: string; subject: string }> = [];
  async send(m: { to: string; subject: string; body: string }) {
    this.sends.push({ to: m.to, subject: m.subject });
  }
}

describeDb("UsageService warnings (#970)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let plansRead: PlansService;
  let usage: UsageService;
  let mail: CapturingMail;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const planKey = `uw-${stamp}`;
  let planId: string;
  let wsId: string;
  let domainId: string;
  let ownerId: string;
  const ownerEmail = `owner-${stamp}@example.com`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    plansRead = new PlansService(db);
    mail = new CapturingMail();
    usage = new UsageService(db, plansRead, mail as never);

    // A test plan with a links limit of 2.
    const [plan] = await db.insert(plans).values({ key: planKey, displayName: "UW", visibility: "hidden" }).returning({ id: plans.id });
    planId = plan!.id;
    // links capped at 2 (the limit under test); everything else generous so only
    // the links limit can trip a warning.
    const [v] = await db
      .insert(planVersions)
      .values({
        planId,
        version: 1,
        features: FeatureMatrix.parse({}),
        limits: LimitMatrix.parse({
          links: 2,
          clicksPerMonth: null,
          customDomains: 100,
          teamMembers: 100,
          apiKeys: 100,
          bioPages: 100,
          forms: 100,
        }),
      })
      .returning({ id: planVersions.id });
    await db.update(plans).set({ currentVersionId: v!.id }).where(eq(plans.id, planId));

    // A workspace on that plan, an owner, a system domain for the links.
    wsId = randomUUID();
    await db.insert(workspaces).values({ id: wsId, name: "uw", slug: `uw-${wsId.slice(0, 8)}`, plan: planKey });
    const [u] = await db.insert(users).values({ name: "Owner", email: ownerEmail }).returning({ id: users.id });
    ownerId = u!.id;
    await db.insert(memberships).values({ workspaceId: wsId, userId: ownerId, email: ownerEmail, role: "owner", status: "active" });
    const [d] = await db
      .insert(domains)
      .values({ domain: `uw-${stamp}.test`, workspaceId: wsId, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    domainId = d!.id;
  });

  afterAll(async () => {
    await db.delete(usageWarnings).where(eq(usageWarnings.workspaceId, wsId));
    await db.delete(links).where(eq(links.workspaceId, wsId));
    await db.delete(domains).where(eq(domains.id, domainId));
    await db.delete(memberships).where(eq(memberships.workspaceId, wsId));
    await db.delete(workspaces).where(eq(workspaces.id, wsId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(planVersions).where(eq(planVersions.planId, planId));
    await db.delete(plans).where(eq(plans.id, planId));
    await handle?.close();
  });

  async function addLinks(n: number) {
    for (let i = 0; i < n; i++) {
      await db.insert(links).values({ workspaceId: wsId, domainId, slug: `${stamp}-${i}-${Math.random().toString(16).slice(2, 6)}`, destination: "https://example.com" });
    }
  }

  it("reports usage rows with used/limit/percent", async () => {
    await addLinks(1); // 1 of 2
    const view = await usage.usageFor(wsId);
    const linksRow = view.rows.find((r) => r.name === "links")!;
    expect(linksRow.used).toBe(1);
    expect(linksRow.limit).toBe(2);
    expect(linksRow.percent).toBe(50);
    expect(view.planKey).toBe(planKey);
  });

  it("raises a full warning and emails the owner at 100%, once (dedup)", async () => {
    await addLinks(1); // now 2 of 2 -> 100%
    mail.sends = [];

    const active1 = await usage.evaluateWarnings(wsId);
    const linksWarn = active1.find((w) => w.limitName === "links");
    expect(linksWarn?.band).toBe("full");

    // One warning row persisted, and one email to the owner.
    const [row] = await db.select().from(usageWarnings).where(eq(usageWarnings.workspaceId, wsId));
    expect(row?.band).toBe("full");
    expect(mail.sends.length).toBe(1);
    expect(mail.sends[0]!.to).toBe(ownerEmail);

    // Re-evaluating at the same band does NOT re-email.
    await usage.evaluateWarnings(wsId);
    expect(mail.sends.length).toBe(1);
  });

  it("clears the warning when usage drops back below 80%", async () => {
    // Remove all but zero links -> 0% -> no warning.
    await db.delete(links).where(eq(links.workspaceId, wsId));
    const active = await usage.evaluateWarnings(wsId);
    expect(active.find((w) => w.limitName === "links")).toBeUndefined();
    const rows = await db.select().from(usageWarnings).where(eq(usageWarnings.workspaceId, wsId));
    expect(rows.length).toBe(0);
  });
});
