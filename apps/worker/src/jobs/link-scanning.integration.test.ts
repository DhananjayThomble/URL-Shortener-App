import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickDaily,
  createDatabase,
  domains,
  eq,
  links,
  projectionOutbox,
  workspaces,
  type Database,
} from "@snapurl/database";
import { rescanLinks, type RescanConfig } from "./link-scanning.js";
import type { UrlScanner } from "./safe-browsing.js";

/* ============================================================
   #994 point 2 — rescanLinks against a real Postgres.

   The candidate query (pending / recent / click-burst), the "skip flagged and
   disabled" exclusions, and the gate-at-the-edge write (flagged status + a
   projection_outbox 'upsert' in one transaction) are all relational — a mock
   cannot prove them. The scanner is injected so no network call happens; the
   verdict per URL is fixed by a map the test controls.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/* A scanner driven by a per-destination verdict map, defaulting to "clean". */
const verdicts = new Map<string, "clean" | "flagged" | "pending">();
const scan: UrlScanner = async (url) => verdicts.get(url) ?? "clean";

const config: RescanConfig = {
  pendingSeconds: 60,
  recentDays: 30,
  recentSeconds: 86_400,
  burstClicks: 100,
  batch: 200,
};

describeDb("rescanLinks (#994 point 2)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let domainId: string;

  const stamp = Date.now();

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);

  async function addLink(opts: {
    slug: string;
    status?: string;
    checkedAt?: Date | null;
    createdAt?: Date;
    disabledAt?: Date | null;
    destination?: string;
  }): Promise<string> {
    const [row] = await db
      .insert(links)
      .values({
        workspaceId,
        domainId,
        slug: opts.slug,
        destination: opts.destination ?? `https://dest.example/${opts.slug}`,
        safeBrowsingStatus: opts.status ?? "clean",
        safeBrowsingCheckedAt: opts.checkedAt ?? null,
        createdAt: opts.createdAt ?? new Date(),
        disabledAt: opts.disabledAt ?? null,
      })
      .returning({ id: links.id });
    return row!.id;
  }

  const statusOf = async (id: string) =>
    (await db.select({ s: links.safeBrowsingStatus }).from(links).where(eq(links.id, id)))[0]!.s;
  const outboxCount = async (id: string) =>
    (await db.select({ id: projectionOutbox.id }).from(projectionOutbox).where(eq(projectionOutbox.linkId, id))).length;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "rescan test", slug: `rescan-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `rescan-${stamp}.test` })
      .returning({ id: domains.id });
    domainId = dom!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("gates a link whose rescan turns flagged: status flagged + a projection upsert", async () => {
    const dest = `https://turns-bad.example/${stamp}`;
    verdicts.set(dest, "flagged");
    // A pending link, last checked > pendingSeconds ago, so it is a candidate.
    const id = await addLink({ slug: `flag-${stamp}`, status: "pending", checkedAt: minsAgo(10), destination: dest });

    const result = await rescanLinks(db, scan, config);

    expect(await statusOf(id)).toBe("flagged");
    expect(await outboxCount(id)).toBeGreaterThanOrEqual(1);
    expect(result.flagged).toBeGreaterThanOrEqual(1);
  });

  it("re-checks a pending link and clears it to clean when the scan comes back clean", async () => {
    const id = await addLink({ slug: `pend-${stamp}`, status: "pending", checkedAt: minsAgo(10) });
    await rescanLinks(db, scan, config);
    expect(await statusOf(id)).toBe("clean");
    // A clean rescan does not project.
    expect(await outboxCount(id)).toBe(0);
  });

  it("does NOT rescan a clean link that is old and was checked recently (no window applies)", async () => {
    const dest = `https://old-clean.example/${stamp}`;
    verdicts.set(dest, "flagged"); // would flag IF it were scanned
    const id = await addLink({
      slug: `old-${stamp}`,
      status: "clean",
      createdAt: daysAgo(60), // outside recentDays
      checkedAt: minsAgo(5), // checked well within recentSeconds
      destination: dest,
    });
    await rescanLinks(db, scan, config);
    // Untouched: still clean, never scanned, so the flagging verdict never applied.
    expect(await statusOf(id)).toBe("clean");
    expect(await outboxCount(id)).toBe(0);
  });

  it("rescans a click-burst link even when old and checked recently, and gates it if flagged", async () => {
    const dest = `https://burst-bad.example/${stamp}`;
    verdicts.set(dest, "flagged");
    const id = await addLink({
      slug: `burst-${stamp}`,
      status: "clean",
      createdAt: daysAgo(90), // old
      checkedAt: daysAgo(2), // checked before today
      destination: dest,
    });
    // A burst of clicks today.
    await db
      .insert(clickDaily)
      .values({ linkId: id, workspaceId, day: new Date().toISOString().slice(0, 10), clicks: 500 });

    await rescanLinks(db, scan, config);
    expect(await statusOf(id)).toBe("flagged");
    expect(await outboxCount(id)).toBeGreaterThanOrEqual(1);
  });

  it("never touches an already-flagged or a disabled link", async () => {
    const flaggedDest = `https://already-flagged.example/${stamp}`;
    verdicts.set(flaggedDest, "clean"); // a rescan would clear it — but it must be skipped
    const flaggedId = await addLink({
      slug: `skip-flag-${stamp}`,
      status: "flagged",
      checkedAt: daysAgo(10),
      destination: flaggedDest,
    });
    const disabledId = await addLink({
      slug: `skip-disabled-${stamp}`,
      status: "pending",
      checkedAt: daysAgo(10),
      disabledAt: new Date(),
    });

    await rescanLinks(db, scan, config);

    expect(await statusOf(flaggedId)).toBe("flagged"); // not cleared
    // the disabled pending link was not scanned (still pending, not advanced to clean)
    expect(await statusOf(disabledId)).toBe("pending");
  });
});
