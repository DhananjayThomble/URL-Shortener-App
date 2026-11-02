import { and, eq, links, projectionOutbox, sql, type Database } from "@snapurl/database";
import type { UrlScanner } from "./safe-browsing.js";

/* ============================================================
   #994 point 2 — rescanning links after creation.

   Phishing URLs are usually clean when first shortened and get listed later,
   so a one-time scan on create is not enough. This job re-checks links against
   Google Safe Browsing on three cadences, and GATES a link that turns flagged
   at the edge through the projection outbox — the same mechanism the API uses
   when an operator flags a link, so the redirect stops bouncing to the unsafe
   destination within the projection window.

   The three cadences, all expressed as one candidate query so a single pass
   covers them:

     1. PENDING links — a scan that could not complete on create (scanner down,
        no key, a timeout). Re-checked within minutes (RESCAN_PENDING_SECONDS),
        because a pending link has never actually been cleared.
     2. RECENT links — anything created in the last RESCAN_RECENT_DAYS (30),
        rescanned at most once per RESCAN_RECENT_SECONDS (daily). This is the
        window where a freshly-shortened phishing link gets listed.
     3. CLICK-BURST links — a link taking real traffic today
        (>= RESCAN_BURST_CLICKS clicks) is rescanned even if it is older than
        the recent window and even if it was scanned recently: a sudden burst
        is exactly when a dormant bad link is being distributed.

   A link already 'flagged' or admin-disabled is skipped — flagged is terminal
   for this job (an operator lifts it), and a disabled link does not resolve at
   all. The batch is bounded (RESCAN_BATCH) so one pass never scans the whole
   table; the oldest-checked candidates come first, so nothing starves.
   ============================================================ */

export interface RescanConfig {
  /** A pending link is re-checked once it is older than this many seconds. */
  pendingSeconds: number;
  /** A link created within this many days is in the daily-rescan window. */
  recentDays: number;
  /** A recent/burst link is rescanned at most once per this many seconds. */
  recentSeconds: number;
  /** Clicks today at or above this count mark a link as a burst candidate. */
  burstClicks: number;
  /** Most links to scan in one pass. */
  batch: number;
}

export const DEFAULT_RESCAN_CONFIG: RescanConfig = {
  pendingSeconds: Number(process.env.RESCAN_PENDING_SECONDS ?? 180),
  recentDays: Number(process.env.RESCAN_RECENT_DAYS ?? 30),
  recentSeconds: Number(process.env.RESCAN_RECENT_SECONDS ?? 86_400),
  burstClicks: Number(process.env.RESCAN_BURST_CLICKS ?? 100),
  batch: Number(process.env.RESCAN_BATCH ?? 200),
};

export interface RescanResult {
  /** Candidate links actually scanned this pass. */
  scanned: number;
  /** Links that turned flagged (and were gated at the edge) this pass. */
  flagged: number;
}

interface Candidate {
  id: string;
  destination: string;
}

/**
 * One rescan pass. Selects the links due a re-check (pending, recent, or
 * click-burst), scans each with the injected `scan` function, and for any that
 * come back 'flagged' flips safe_browsing_status and enqueues a projection
 * 'upsert' in the SAME transaction so the flag reaches the edge. Every scanned
 * link's safe_browsing_checked_at is advanced so it is not immediately picked
 * again.
 *
 * `scan` is injected (see safe-browsing.ts): production passes the real Safe
 * Browsing scanner; tests pass a stub, so a pass makes no network call.
 */
export async function rescanLinks(
  db: Database,
  scan: UrlScanner,
  config: RescanConfig = DEFAULT_RESCAN_CONFIG,
): Promise<RescanResult> {
  /* The candidate set. A link qualifies when it is NOT already flagged and NOT
     disabled, and one of:
       - it is pending and was last checked (or created) more than
         pendingSeconds ago;
       - it was created within recentDays and was last checked more than
         recentSeconds ago (or never);
       - it took at least burstClicks clicks today, regardless of age, and was
         last checked before today.
     Oldest-checked first so nothing starves; bounded by batch. */
  const candidates = (await db.execute(sql`
    with todays_clicks as (
      select link_id, sum(clicks)::int as clicks
      from click_daily
      where day = (now() at time zone 'UTC')::date
      group by link_id
    )
    select l.id, l.destination
    from links l
    left join todays_clicks c on c.link_id = l.id
    where l.safe_browsing_status <> 'flagged'
      and l.disabled_at is null
      and (
        (l.safe_browsing_status = 'pending'
          and coalesce(l.safe_browsing_checked_at, l.created_at) < now() - (${config.pendingSeconds} * interval '1 second'))
        or
        (l.created_at > now() - (${config.recentDays} * interval '1 day')
          and (l.safe_browsing_checked_at is null
            or l.safe_browsing_checked_at < now() - (${config.recentSeconds} * interval '1 second')))
        or
        (coalesce(c.clicks, 0) >= ${config.burstClicks}
          and (l.safe_browsing_checked_at is null
            or l.safe_browsing_checked_at < (now() at time zone 'UTC')::date))
      )
    order by l.safe_browsing_checked_at asc nulls first
    limit ${config.batch}
  `)) as unknown as Candidate[];

  let scanned = 0;
  let flagged = 0;

  for (const link of candidates) {
    const verdict = await scan(link.destination);
    scanned++;

    if (verdict === "flagged") {
      /* Gate it at the edge: flip the status and project the change in ONE
         transaction, exactly as the API's flag path does (reports.service /
         admin.moderation.service). The redirect reads 'flagged' as a gate, so
         once the projection drains the link stops bouncing to the destination.
         Guarded on <> 'flagged' so a concurrent flag is not double-projected. */
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(links)
          .set({ safeBrowsingStatus: "flagged", safeBrowsingCheckedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(links.id, link.id), sql`${links.safeBrowsingStatus} <> 'flagged'`))
          .returning({ id: links.id });
        if (updated.length > 0) {
          await tx.insert(projectionOutbox).values({
            linkId: link.id,
            operation: "upsert",
            payload: { linkId: link.id, operation: "upsert" },
          });
        }
      });
      flagged++;
    } else {
      /* clean or pending: just advance the check time so the link moves to the
         back of the queue. A still-pending link keeps its 'pending' status and
         will be picked again after pendingSeconds. */
      await db
        .update(links)
        .set({ safeBrowsingStatus: verdict, safeBrowsingCheckedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(links.id, link.id), sql`${links.safeBrowsingStatus} <> 'flagged'`));
    }
  }

  return { scanned, flagged };
}


/* ============================================================
   #994 point 5 — domain reputation watch.

   A daily check of SnapURL's OWN hosts — the dashboard domain and the redirect
   host — against two independent reputation sources, alerting the operator on
   a hit. The point is catching the catastrophe where our own domain gets
   listed (a compromise, a shared-IP neighbour, a bad actor abusing the
   service): if snapurl.in lands on a blocklist, every link we serve is
   degraded, and we need to know before customers do.

   The two sources:
     1. Google Safe Browsing — the same scanner the rest of this file uses,
        asked about our host as a URL.
     2. A public domain blocklist (e.g. Spamhaus DBL), queried through an
        injected lookup. Spamhaus DBL is a DNS blocklist, but the query
        mechanism is deliberately NOT baked in here: it is a function the caller
        supplies, so production wires the real DNS lookup and a test passes a
        stub. No live network call happens in CI.

   This job does not gate anything — our own domain being listed is an operator
   emergency, not something to auto-disable — it ALERTS. The alert sink is
   injected too (a log line in the single-node worker; an SNS publish / email
   in production), so the job stays pure and testable.
   ============================================================ */

/** The hosts to watch. Defaults to snapurl.in and the configured redirect host,
 *  overridable via REPUTATION_WATCH_HOSTS (comma-separated). */
export function reputationWatchHosts(): string[] {
  const configured = process.env.REPUTATION_WATCH_HOSTS;
  if (configured) {
    return configured
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  }
  const hosts = new Set<string>(["snapurl.in"]);
  const redirectHost = hostOf(process.env.REDIRECT_ORIGIN);
  if (redirectHost) hosts.add(redirectHost);
  return [...hosts];
}

function hostOf(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return origin.trim().toLowerCase() || null;
  }
}

/** A lookup against a public domain blocklist (e.g. Spamhaus DBL). Returns true
 *  when the host is LISTED. Injected so production wires the real DNS query and
 *  a test passes a stub — no live lookup in CI. */
export type DomainBlocklistLookup = (host: string) => Promise<boolean>;

/** One reputation hit on one of our hosts. */
export interface ReputationHit {
  host: string;
  /** Which source listed it. */
  source: "safe-browsing" | "domain-blocklist";
}

/** Where a reputation hit is reported. Production wires SNS / email; the
 *  single-node worker logs. */
export type ReputationAlert = (hit: ReputationHit) => Promise<void> | void;

export interface ReputationWatchResult {
  checked: number;
  hits: ReputationHit[];
}

/**
 * Check every watched host against Safe Browsing and the public domain
 * blocklist, alerting on each hit. Both lookups are injected so this makes no
 * live network call in a test. A lookup that throws is treated as "no
 * definitive hit" for that source on that host (an outage must not fire a false
 * alarm), so only a POSITIVE listing ever alerts.
 */
export async function reputationWatch(opts: {
  hosts?: string[];
  scan: UrlScanner;
  domainBlocklist: DomainBlocklistLookup;
  alert: ReputationAlert;
}): Promise<ReputationWatchResult> {
  const hosts = opts.hosts ?? reputationWatchHosts();
  const hits: ReputationHit[] = [];

  for (const host of hosts) {
    // Safe Browsing wants a URL; ask about the host's root over https. "pending"
    // (outage) is NOT a hit — only "flagged" fires.
    let sbListed = false;
    try {
      sbListed = (await opts.scan(`https://${host}/`)) === "flagged";
    } catch {
      sbListed = false;
    }
    if (sbListed) {
      const hit: ReputationHit = { host, source: "safe-browsing" };
      hits.push(hit);
      await opts.alert(hit);
    }

    let dblListed = false;
    try {
      dblListed = await opts.domainBlocklist(host);
    } catch {
      dblListed = false;
    }
    if (dblListed) {
      const hit: ReputationHit = { host, source: "domain-blocklist" };
      hits.push(hit);
      await opts.alert(hit);
    }
  }

  return { checked: hosts.length, hits };
}
