import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, eq, webhookDeliveries, webhooks, workspaces, type Database } from "@snapurl/database";

/* ============================================================
   Issue #534 — the worker-side half of the SSRF guard, against a real
   Postgres, with only dns.lookup and global fetch mocked.

   The write-time guard (apps/api/src/common/ssrf-guard.ts's
   assertNoSsrfDnsTarget, exercised end-to-end in
   apps/api/src/common/ssrf-guard.integration.test.ts) proves a webhook
   endpoint resolved to a public address at the moment it was created. It
   cannot prove anything about what that same hostname resolves to later —
   DNS rebinding, or a record that simply changed — because it only ever runs
   once, at creation. This file proves the other half: deliverWebhooks()
   re-resolves the endpoint immediately before its own fetch and refuses to
   make the request at all when that second resolution lands on a private,
   loopback or link-local address, even though the exact same row would have
   passed the write-time check a moment earlier.

   The webhook/delivery rows are inserted directly via @snapurl/database
   rather than through apps/api's DevelopersService: apps/worker cannot import
   from apps/api (packages/architecture.md forbids cross-`apps` imports), and
   the row shape itself is the whole of what the write-time check would have
   produced — a webhook with an endpoint that, at insert time, nothing here
   claims resolved anywhere in particular.
   ============================================================ */

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const fetchMock = vi.fn();

const { deliverWebhooks } = await import("./webhooks.js");

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("deliverWebhooks — DNS re-checked at delivery time (#534)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  const stamp = Date.now();
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "webhook ssrf test", slug: `webhook-ssrf-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await handle.sql.end();
  });

  afterEach(() => {
    lookupMock.mockReset();
    fetchMock.mockReset();
  });

  async function insertPendingDelivery(endpoint: string) {
    const [webhook] = await db
      .insert(webhooks)
      .values({ workspaceId, endpoint, events: ["link.created"], secret: "whsec_test" })
      .returning({ id: webhooks.id });

    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({ webhookId: webhook!.id, event: "link.created", payload: { id: "l1" } })
      .returning({ id: webhookDeliveries.id });

    return { webhookId: webhook!.id, deliveryId: delivery!.id };
  }

  it("never calls fetch, and records a failure, for an endpoint that resolves to a denied address at delivery time", async () => {
    // Stands in for "this hostname resolved public when the webhook was
    // created" — nothing here needs to prove that separately, since the
    // point under test is that deliverWebhooks() does not trust it and
    // resolves again right now.
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const endpoint = `http://rebinding-${stamp}.example/hook`;
    const { deliveryId, webhookId } = await insertPendingDelivery(endpoint);

    const result = await deliverWebhooks(db, 10);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.sent).toBe(0);

    const [row] = await db
      .select({ status: webhookDeliveries.status, error: webhookDeliveries.error })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("pending"); // retried, not silently dropped
    expect(row?.error).toMatch(/permitted address/);

    const [wh] = await db
      .select({ health: webhooks.health, consecutiveFailures: webhooks.consecutiveFailures })
      .from(webhooks)
      .where(eq(webhooks.id, webhookId));
    expect(wh?.consecutiveFailures).toBeGreaterThanOrEqual(1);
  });

  it("calls fetch for an endpoint that resolves only to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const endpoint = `https://public-${stamp}.example/hook`;
    const { deliveryId } = await insertPendingDelivery(endpoint);

    const result = await deliverWebhooks(db, 10);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.anything());
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({ status: webhookDeliveries.status })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, deliveryId));
    expect(row?.status).toBe("delivered");
  });
});
