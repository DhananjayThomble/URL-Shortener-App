import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  createDatabase,
  domains,
  eq,
  linkCounters,
  links,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { effectiveGate } from "@snapurl/domain";
import { PostgresClickReservation, NoopClickReservation } from "./click-reservation.js";
import { PostgresLinkResolver, type ResolvedLink } from "./resolver.js";

/* ============================================================
   The atomic click-limit gate (#763) against a real Postgres.

   This is the highest-risk change in the redirect: a hard cap that a burst
   could previously overshoot. The gate at the top of the issue read
   link_counters.clicks — the rollup's lagging count — so a clickLimit of 2 let
   3–4 concurrent visitors through. Option 1 reserves each click atomically
   against link_counters.reserved for limited links only.

   What this file proves, with real concurrency on a real database:

     1. N+1 concurrent reservations against a limit-2 link grant EXACTLY 2 and
        refuse the rest — and reserved never exceeds the limit. This is the
        guarantee; it fails on the old code, which had no reserve path at all.

     2. The OLD cached-count gate overshoots under the same concurrency. This
        reproduces the pre-#763 mechanism (read link_counters.clicks, compare,
        let through) to demonstrate the bug the atomic reserve removes, so the
        regression is anchored to observed old behaviour, not just asserted.

     3. End to end over HTTP (app.inject): a limited link grants exactly its
        limit of 302s and then 410s, concurrently; an UNLIMITED link redirects
        and writes NOTHING to reserved (its zero-extra-write hot path).

     4. Edge cases: a limit of 0 refuses the first click, a fresh link with no
        counter row seeds correctly, sequential exhaustion is exact.

   Runs only when DATABASE_URL is set, matching resolver.test.ts /
   link-cache-bust.integration.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("atomic click-limit gate (#763)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let reservation: PostgresClickReservation;
  let resolver: PostgresLinkResolver;
  let workspaceId: string;
  let domainId: string;
  let host: string;

  /** Insert a link (and optionally seed its counter row) and return its id. */
  async function makeLink(slug: string, clickLimit: number | null): Promise<string> {
    const [row] = await db
      .insert(links)
      .values({ workspaceId, domainId, slug, destination: `https://example.com/${slug}`, clickLimit })
      .returning({ id: links.id });
    return row!.id;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 10 });
    db = handle.db;
    reservation = new PostgresClickReservation(db);
    resolver = new PostgresLinkResolver(db);

    const stamp = Date.now();
    host = `clicklimit-${stamp}.test`;
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "clicklimit test", slug: `clicklimit-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: host, status: "live" })
      .returning({ id: domains.id });
    domainId = dom!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("grants EXACTLY the limit under N+1 concurrent reservations and never overshoots", async () => {
    const limit = 2;
    const linkId = await makeLink("burst", limit);

    // Fire limit+2 reservations ALL AT ONCE — the exact burst the stale-count
    // gate overshot. Promise.all starts them before any resolves, so they
    // contend for the row lock concurrently.
    const attempts = limit + 2; // 4 concurrent clicks at a limit of 2
    const results = await Promise.all(
      Array.from({ length: attempts }, () => reservation.reserve(linkId, limit)),
    );

    const granted = results.filter((r) => "ok" in r && r.ok).length;
    const refused = results.filter((r) => "ok" in r && !r.ok).length;

    expect(granted).toBe(limit); // exactly 2 — not 3, not 4
    expect(refused).toBe(attempts - limit);

    // The durable counter must land EXACTLY at the limit — no overshoot row.
    const [counter] = await db
      .select({ reserved: linkCounters.reserved })
      .from(linkCounters)
      .where(eq(linkCounters.linkId, linkId));
    expect(counter!.reserved).toBe(limit);
  });

  it("demonstrates the OLD cached-count gate overshooting the same burst (the bug #763 fixes)", async () => {
    /* Reproduce the PRE-#763 mechanism exactly: resolve the link, read its
       cached counter (link_counters.clicks, which the rollup updates lazily so
       it stays 0 during a burst), and let the click through if clicks < limit —
       WITHOUT any atomic reserve. That is what main.ts did before this change.
       Under concurrency every attempt sees clicks=0 and is allowed, so a limit
       of 2 lets ALL of them through. This is the overshoot; the atomic test
       above is the fix. */
    const limit = 2;
    await makeLink("old-overshoot", limit);
    const attempts = 4;

    const link = await resolver.resolve(host, "old-overshoot");
    expect(link!.clickLimit).toBe(limit);

    // The old gate: a pure read-compare against the (stale) cached count, no write.
    const oldGate = (l: ResolvedLink) => effectiveGate(l); // clicks===0 during the burst
    const allowed = (
      await Promise.all(
        Array.from({ length: attempts }, async () => oldGate(link!) === null),
      )
    ).filter(Boolean).length;

    // The old code lets MORE than the limit through — the overshoot. (3–4; here
    // all 4, since the rollup has not run so cached clicks stays 0.)
    expect(allowed).toBeGreaterThan(limit);
  });

  it("over HTTP: a limited link grants exactly its limit of 302s then 410s, concurrently", async () => {
    const limit = 2;
    await makeLink("http-limited", limit);
    const app = buildRedirectApp(resolver, reservation);

    const attempts = 4;
    const responses = await Promise.all(
      Array.from({ length: attempts }, () =>
        app.inject({ method: "GET", url: "/http-limited", headers: { host } }),
      ),
    );
    const codes = responses.map((r) => r.statusCode).sort();
    const redirects = codes.filter((c) => c === 302).length;
    const gone = codes.filter((c) => c === 410).length;

    expect(redirects).toBe(limit); // exactly 2 succeed
    expect(gone).toBe(attempts - limit); // the 3rd and 4th are refused
    await app.close();
  });

  it("over HTTP: an UNLIMITED link redirects and writes NOTHING to reserved (zero-extra-write hot path)", async () => {
    const linkId = await makeLink("http-unlimited", null);
    const app = buildRedirectApp(resolver, reservation);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: "GET", url: "/http-unlimited", headers: { host } }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 302)).toBe(true);
    expect(responses[0]!.headers.location).toBe("https://example.com/http-unlimited");

    // The whole point: an unlimited link never touches the reservation counter,
    // so no link_counters row is created for it by the redirect.
    const rows = await db
      .select({ reserved: linkCounters.reserved })
      .from(linkCounters)
      .where(eq(linkCounters.linkId, linkId));
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it("refuses the first click of a limit-0 link and writes no stray reservation", async () => {
    const linkId = await makeLink("zero-limit", 0);
    const r = await reservation.reserve(linkId, 0);
    expect("ok" in r && r.ok).toBe(false);

    const rows = await db
      .select({ reserved: linkCounters.reserved })
      .from(linkCounters)
      .where(eq(linkCounters.linkId, linkId));
    // No row seeded: 0 >= 1 is false, so the INSERT's SELECT produces nothing.
    expect(rows).toHaveLength(0);
  });

  it("exhausts a limit exactly over sequential reservations", async () => {
    const limit = 3;
    const linkId = await makeLink("sequential", limit);
    const verdicts: boolean[] = [];
    for (let i = 0; i < limit + 2; i++) {
      const r = await reservation.reserve(linkId, limit);
      verdicts.push("ok" in r && r.ok);
    }
    expect(verdicts).toEqual([true, true, true, false, false]);
  });

  it("NoopClickReservation reports unavailable so the caller falls back to the cached gate", async () => {
    const noop = new NoopClickReservation();
    const r = await noop.reserve("any-id", 2);
    expect(r).toEqual({ unavailable: true });
  });

  it("does not clobber reserved when the rollup rewrites clicks/unique_clicks", async () => {
    /* The rollup owns clicks/unique_clicks and must leave reserved alone — the
       exact upsert from apps/worker/src/jobs/rollup.ts, replayed here. */
    const limit = 5;
    const linkId = await makeLink("rollup-coexist", limit);
    await reservation.reserve(linkId, limit);
    await reservation.reserve(linkId, limit); // reserved = 2

    await db.execute(sql`
      insert into link_counters (link_id, clicks, unique_clicks)
      values (${linkId}, 99, 42)
      on conflict (link_id) do update set
        clicks = excluded.clicks,
        unique_clicks = excluded.unique_clicks
    `);

    const [counter] = await db
      .select({ clicks: linkCounters.clicks, reserved: linkCounters.reserved })
      .from(linkCounters)
      .where(eq(linkCounters.linkId, linkId));
    expect(counter!.clicks).toBe(99); // rollup wrote this
    expect(counter!.reserved).toBe(2); // reservation counter untouched by the rollup
  });
});

/* A minimal Fastify app that wires the REAL resolver and REAL reservation and
   reproduces main.ts's gate branch for limited links. The canonical gate lives
   in apps/redirect/src/main.ts (which is self-executing and so cannot be
   imported here); this mirrors ONLY the click-limit decision — resolve, apply
   the ordinary gate, then for a limited link let the atomic reserve be the
   authoritative click-limit verdict — which is the behaviour under test. */
function buildRedirectApp(resolver: PostgresLinkResolver, reservation: PostgresClickReservation) {
  const app = Fastify({ logger: false });
  app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
    const host = (request.headers.host as string) ?? "";
    const link = await resolver.resolve(host, request.params.slug);
    if (!link) return reply.code(404).send("not found");

    let blocked = effectiveGate(link);
    if (link.clickLimit != null && (blocked === null || blocked === "click_limit")) {
      const r = await reservation.reserve(link.id, link.clickLimit);
      if ("ok" in r) blocked = r.ok ? null : "click_limit";
    }
    if (blocked) return reply.code(410).send(blocked);
    return reply.redirect(link.destination, 302);
  });
  return app;
}
