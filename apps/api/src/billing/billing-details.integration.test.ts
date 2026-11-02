import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  eq,
  subscriptions,
  workspaceBillingDetails,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { BillingProvider, SyncBillingDetailsParams } from "./billing-provider.js";
import { NoneBillingProvider } from "./none-billing.provider.js";
import { BillingDetailsService } from "./billing-details.service.js";

/* ============================================================
   #992 §5 — billing details, asserted on seeded rows (shared DB, never counts).

   Oracles (issue §5 + the conductor's test list):
     - the details round-trip: set then get returns what was stored, as the wire
       shape (an all-null record before anything is set);
     - a partial edit updates only the fields given and leaves the rest;
     - an explicit null clears a field; an address replaces the whole block;
     - the details are pushed to the provider (best-effort) only when the
       workspace has a provider subscription to attach to, and a provider
       failure NEVER loses the DB write.

   Validation (the GSTIN shape, owner-only, billing email) is enforced by the
   contract BillingDetailsInput (unit-tested in packages/contract) and the
   controller's assertOwner + zod pipe; this exercises the service's storage and
   provider-sync logic against the real DB.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** A provider that records every syncBillingDetails call, so the test can
 *  assert the details reached the provider (and with what). */
class RecordingProvider extends NoneBillingProvider {
  readonly synced: SyncBillingDetailsParams[] = [];
  async syncBillingDetails(params: SyncBillingDetailsParams): Promise<void> {
    this.synced.push(params);
  }
}

describeDb("BillingDetailsService (#992 §5)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let provider: RecordingProvider;
  let svc: BillingDetailsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];

  async function makeWorkspace(withSub = false): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `bd-${id.slice(0, 8)}` });
    workspaceIds.push(id);
    if (withSub) {
      await db.insert(subscriptions).values({
        workspaceId: id,
        planKey: "pro",
        interval: "monthly",
        provider: "razorpay",
        providerSubscriptionId: `sub_${stamp}_${id.slice(0, 8)}`,
        providerCustomerId: `cust_${stamp}_${id.slice(0, 8)}`,
        status: "active",
      });
    }
    return id;
  }

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    provider = new RecordingProvider();
    svc = new BillingDetailsService(db, provider as unknown as BillingProvider);
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of workspaceIds) {
      await db.delete(workspaceBillingDetails).where(eq(workspaceBillingDetails.workspaceId, id));
      await db.delete(subscriptions).where(eq(subscriptions.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await handle?.close();
  });

  it("returns an all-null record before anything is set", async () => {
    const ws = await makeWorkspace();
    const d = await svc.get(ws);
    expect(d).toEqual({ billingEmail: null, companyName: null, taxId: null, address: null, updatedAt: null });
  });

  it("sets and reads back the full details as the wire shape", async () => {
    const ws = await makeWorkspace();
    const saved = await svc.set(ws, {
      billingEmail: "accounts@acme.example",
      companyName: "Acme Pvt Ltd",
      taxId: "29ABCDE1234F1Z5",
      address: {
        line1: "1 MG Road",
        line2: null,
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "IN",
      },
    });
    expect(saved.companyName).toBe("Acme Pvt Ltd");
    expect(saved.taxId).toBe("29ABCDE1234F1Z5");
    expect(saved.address).toEqual({
      line1: "1 MG Road",
      line2: null,
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "IN",
    });
    expect(saved.updatedAt).not.toBeNull();

    // A fresh read matches.
    const read = await svc.get(ws);
    expect(read).toEqual(saved);
  });

  it("a partial edit updates only the field given and leaves the rest", async () => {
    const ws = await makeWorkspace();
    await svc.set(ws, { companyName: "First Co", taxId: "29ABCDE1234F1Z5" });
    // Change only the company name; the tax id must survive.
    const after = await svc.set(ws, { companyName: "Renamed Co" });
    expect(after.companyName).toBe("Renamed Co");
    expect(after.taxId).toBe("29ABCDE1234F1Z5"); // untouched
  });

  it("an explicit null clears a field; an empty string is normalised to null", async () => {
    const ws = await makeWorkspace();
    await svc.set(ws, { companyName: "To Be Cleared", billingEmail: "x@y.example" });
    const cleared = await svc.set(ws, { companyName: null, billingEmail: "   " });
    expect(cleared.companyName).toBeNull();
    expect(cleared.billingEmail).toBeNull();
  });

  it("setting an address replaces the whole block; null address clears it", async () => {
    const ws = await makeWorkspace();
    await svc.set(ws, {
      address: { line1: "A", line2: "B", city: "C", state: "D", postalCode: "E", country: "US" },
    });
    const replaced = await svc.set(ws, { address: { line1: "New", country: "US" } });
    expect(replaced.address).toEqual({
      line1: "New",
      line2: null,
      city: null,
      state: null,
      postalCode: null,
      country: "US",
    });
    const nulled = await svc.set(ws, { address: null });
    expect(nulled.address).toBeNull();
  });

  it("pushes the details to the provider when the workspace has a subscription to attach to", async () => {
    const ws = await makeWorkspace(true);
    const before = provider.synced.length;
    await svc.set(ws, { companyName: "Synced Co", taxId: "29ABCDE1234F1Z5", address: { country: "IN", city: "Pune" } });
    expect(provider.synced.length).toBe(before + 1);
    const last = provider.synced.at(-1)!;
    expect(last.companyName).toBe("Synced Co");
    expect(last.taxId).toBe("29ABCDE1234F1Z5");
    expect(last.providerCustomerId).toContain("cust_");
    expect(last.address?.city).toBe("Pune");
  });

  it("does NOT call the provider for a workspace with no subscription", async () => {
    const ws = await makeWorkspace(false);
    const before = provider.synced.length;
    await svc.set(ws, { companyName: "No Sub Co" });
    expect(provider.synced.length).toBe(before); // nothing to attach to
    // The DB write still happened.
    expect((await svc.get(ws)).companyName).toBe("No Sub Co");
  });

  it("a provider sync failure never loses the DB write (best-effort)", async () => {
    const ws = await makeWorkspace(true);
    const spy = vi.spyOn(provider, "syncBillingDetails").mockRejectedValueOnce(new Error("provider down"));
    // The set resolves (does not throw) and the DB holds the details.
    const saved = await svc.set(ws, { companyName: "Resilient Co" });
    expect(saved.companyName).toBe("Resilient Co");
    expect((await svc.get(ws)).companyName).toBe("Resilient Co");
    spy.mockRestore();
  });
});
