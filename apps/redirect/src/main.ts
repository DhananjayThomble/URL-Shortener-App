import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { createDatabase } from "@snapurl/database";
import {
  REDIRECT_STATUS,
  buildDeepLink,
  buildDestination,
  cacheHeadersFor,
  evaluateRouting,
  isBot,
  parseBrowser,
  parseDevice,
  parseLanguage,
  parseOs,
  parseReferrerHost,
  visitorHash,
  clientIpFromXff,
} from "@snapurl/domain";
import { PostgresLinkResolver, type LinkResolver, type ResolvedLink } from "./resolver.js";
import { PostgresClickSink, type ClickSink } from "./click-sink.js";
import { DailySaltCache } from "./salt.js";

/* ============================================================
   The redirect service.

   Plain Fastify, not NestJS. The architecture argument was that
   the hot path should carry the least of any app here, and a DI
   container, decorators and reflect-metadata are exactly the kind
   of weight that shows up in a Lambda cold start for no benefit
   on a service with three routes.

   Everything it needs is imported from @snapurl/domain, which the
   API also imports — so the routing chain that decides where a
   visitor lands has exactly one implementation.
   ============================================================ */

const PORT = Number(process.env.PORT ?? 3002);
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
const JWT_SECRET = process.env.JWT_ACCESS_SECRET ?? "";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/* Five is right for a long-running process serving many requests at once. It
   is wrong on Lambda, where each instance handles one request at a time and
   the pool just multiplies idle connections against a db.t4g.micro's small
   max_connections — so the deployment sets this to 1. */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 5);

/* How many proxies in front of this service APPEND their edge IP to
   X-Forwarded-For. The trustworthy client IP that feeds visitorHash is the
   (TRUSTED_PROXY_HOPS+1)th entry from the RIGHT of that chain, so a client
   cannot forge visitor identity by prepending entries. 0 = direct/local dev
   and compose (no trusted appender, hit on localhost with no XFF); production
   behind CloudFront sets it to 1 (or higher for additional appending hops). */
const TRUSTED_PROXY_HOPS = Number(process.env.TRUSTED_PROXY_HOPS ?? 0);

/* trustProxy is OFF: Fastify's request.ip is then the socket peer, and we
   derive the real client IP ourselves via clientIpFromXff. Fastify 5's numeric
   hop-count is disabled as unsafe, and `true` would surface the client-typed
   leftmost X-Forwarded-For entry — the exact forgery #279 fixes. */
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: false });
/* The replica URL and SSL settings are plumbed through for consistency with the
   other apps, but the redirect deliberately uses the PRIMARY `db` handle (not
   readDb) everywhere: the click-limit gate reads a link's click count and then
   records a click, so it is a read-then-write path. Serving that read from a
   replica would let lag hand back a stale count and overshoot the hard cap. */
const { db, close } = createDatabase({
  url: DATABASE_URL,
  replicaUrl: process.env.DATABASE_REPLICA_URL,
  ssl: process.env.DATABASE_SSL === "true",
  sslNoVerify: process.env.DATABASE_SSL_NO_VERIFY === "true",
  sslCaCert: process.env.DATABASE_CA_CERT,
  max: POOL_MAX,
});

const resolver: LinkResolver = new PostgresLinkResolver(db);
const clicks: ClickSink = new PostgresClickSink(db);
const salts = new DailySaltCache(db);

app.get("/health", async () => ({ status: "ok" }));

app.get<{ Params: { slug: string } }>("/:slug", async (request, reply) => {
  const rawSlug = request.params.slug;
  const host = (request.headers["x-forwarded-host"] as string) ?? request.headers.host ?? "";

  /* The "+" suffix convention from the landing page: anyone can add + to a
     link to see where it goes before clicking. It is a redirect to the trust
     page rather than a render, so the preview lives entirely in the frontend. */
  if (rawSlug.endsWith("+")) {
    return reply.redirect(`${WEB_ORIGIN}/p/${encodeURIComponent(rawSlug.slice(0, -1))}`, 302);
  }

  const link = await resolver.resolve(host, rawSlug);

  if (!link) {
    const domain = await resolver.resolveDomain(host);
    if (domain?.notFoundRedirect) return reply.redirect(domain.notFoundRedirect, 302);
    return reply.code(404).type("text/plain").send("No such link.");
  }

  const userAgent = (request.headers["user-agent"] as string) ?? "";
  /* The trustworthy client IP, derived once here and threaded through every
     visitorHash site. Never request.ip (the socket peer) directly, and never a
     client-typed X-Forwarded-For entry: clientIpFromXff returns the
     rightmost-minus-N entry so a prepended header cannot forge identity (#279). */
  const clientIp = clientIpFromXff({
    xff: request.headers["x-forwarded-for"] as string | string[] | undefined,
    socketIp: request.raw.socket.remoteAddress ?? request.ip,
    trustedHops: TRUSTED_PROXY_HOPS,
  });
  const blocked = gateFor(link);

  if (blocked) {
    // Blocked clicks are still recorded — "how many people hit an expired
    // link" is exactly the number that tells someone to go renew it.
    await record(link, clientIp, request, userAgent, blocked, null, null);

    if (blocked === "expired" && link.expiresTo) return reply.redirect(link.expiresTo, 302);
    if (blocked === "scheduled" && link.scheduledTo) return reply.redirect(link.scheduledTo, 302);
    if (blocked === "flagged") {
      return reply.redirect(`${WEB_ORIGIN}/p/${encodeURIComponent(rawSlug)}?warning=unsafe`, 302);
    }

    /* 404, not 410, and not 503.
       410 means "was here, is gone", which is the opposite of a link that has
       not started yet. 503 would invite crawlers to hammer it and reads as an
       outage on our side. As far as the world is concerned this slug does not
       resolve yet, which is what 404 says. Retry-After carries the date for
       anything that cares to look. */
    if (blocked === "scheduled") {
      if (link.activatesAt) void reply.header("Retry-After", link.activatesAt.toUTCString());
      return reply.code(404).type("text/plain").send("This link is not live yet.");
    }

    return reply
      .code(410)
      .type("text/plain")
      .send(blocked === "click_limit" ? "This link has reached its click limit." : "This link has expired.");
  }

  /* G3 — password-protected links.

     The unlock token is issued by the API after it checks the password. It is
     bound to this link id and lives five minutes, so it cannot be replayed
     against a different link or kept in a bookmark. */
  if (link.hasPassword) {
    const token = (request.query as { k?: string } | undefined)?.k;
    if (!token || !isValidUnlockToken(token, link.id)) {
      return reply.redirect(`${WEB_ORIGIN}/p/${encodeURIComponent(rawSlug)}?unlock=1`, 302);
    }
  }

  const salt = await salts.today();
  const hash = visitorHash({ dailySalt: salt, ip: clientIp, userAgent, linkId: link.id });

  const decision = evaluateRouting(link.rules, link.destination, {
    // CloudFront hands us the country for free and accurate at country level,
    // which is all the contract reports. No GeoIP database to ship.
    country: ((request.headers["cloudfront-viewer-country"] as string) ?? "").toUpperCase() || null,
    device: parseDevice(userAgent),
    language: parseLanguage(request.headers["accept-language"] as string),
    visitorHash: hash,
  });

  const destination = buildDestination({
    destination: decision.destination,
    incomingQuery: request.url.split("?")[1] ?? null,
    forwardQuery: link.forwardQuery,
    utm: link.utm,
  });

  /* Applied last, to the URL the visitor would actually have received —
     otherwise the intent's fallback would point at the pre-UTM destination and
     anyone without the app would lose the campaign parameters.

     Returns `destination` untouched unless there is a real app to open and a
     platform fallback to catch the miss, so this is a no-op for most clicks. */
  const target = buildDeepLink(destination, parseDevice(userAgent), link.deepLink);

  await record(link, clientIp, request, userAgent, null, decision.matchedRuleId, decision.variant, hash);

  for (const [header, value] of Object.entries(cacheHeadersFor(link.redirectType))) {
    void reply.header(header, value);
  }
  if (link.hideReferrer) void reply.header("Referrer-Policy", "no-referrer");

  return reply.redirect(target, REDIRECT_STATUS[link.redirectType]);
});

app.get("/", async (request, reply) => {
  const host = (request.headers["x-forwarded-host"] as string) ?? request.headers.host ?? "";
  const domain = await resolver.resolveDomain(host);
  if (domain?.rootRedirect) return reply.redirect(domain.rootRedirect, 302);
  return reply.code(404).type("text/plain").send("Nothing here.");
});

/** Everything that stops a click short of the destination, in the order the
 *  visitor would care about.
 *
 *  The order after "flagged" is the same one `deriveStatus` uses, so what the
 *  dashboard says about a link and what a visitor to it experiences cannot
 *  disagree: a link that has already expired reports expired even if it also
 *  has an activation date still ahead of it. */
function gateFor(link: ResolvedLink): "archived" | "expired" | "click_limit" | "scheduled" | "flagged" | null {
  if (link.archived) return "archived";
  if (link.safeBrowsingStatus === "flagged") return "flagged";
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return "expired";
  /* The count is the last rollup's, not a live one, so a hard cap can be
     overshot by a handful under concurrency. A synchronous read-modify-write
     here would cost more latency than the accuracy is worth. */
  if (link.clickLimit != null && link.clicks >= link.clickLimit) return "click_limit";
  /* Nothing schedules this. The row carries a date and every request compares
     it against the clock, so the link starts working at exactly that moment
     with no job having to fire — which is the whole point of storing a date
     rather than a flag someone has to flip. */
  if (link.activatesAt && link.activatesAt.getTime() > Date.now()) return "scheduled";
  return null;
}

function isValidUnlockToken(token: string, linkId: string): boolean {
  try {
    const claims = jwt.verify(token, JWT_SECRET) as { sub?: string; purpose?: string };
    return claims.purpose === "unlock" && claims.sub === linkId;
  } catch {
    return false;
  }
}

/**
 * Record the click. Awaited by the handler, but never fatal.
 *
 * This is awaited so the INSERT completes within the invocation. Under the
 * Lambda Web Adapter the sandbox freezes the moment Fastify responds, which
 * suspends any in-flight query: a fire-and-forget write is not just lost, it
 * pins a Postgres backend the pool cannot reclaim and — with DATABASE_POOL_MAX=1
 * — the next request on that warm instance queues behind a query that never
 * finishes, until the function times out. Awaiting the write costs one
 * same-AZ round trip (single-digit ms) and is vastly cheaper than a deadlocked
 * instance billing its full timeout.
 *
 * It stays non-fatal: the try/catch below logs and swallows every error, so
 * awaiting this can never throw into the handler. Analytics being down still
 * cannot break a redirect — a lost click is a worse outcome than a slow
 * redirect only if you are the one counting clicks, and the visitor is not.
 *
 * Phase 7 direction (per the issue): move to the SQS ClickSink adapter the
 * port was designed for. An HTTP send with a bounded flush survives
 * freeze/thaw in a way a Postgres INSERT does not.
 */
async function record(
  link: ResolvedLink,
  clientIp: string,
  request: { headers: Record<string, unknown> },
  userAgent: string,
  blockedReason: string | null,
  matchedRuleId: string | null,
  variant: string | null,
  precomputedHash?: string,
): Promise<void> {
  try {
    const salt = await salts.today();
    const hash =
      precomputedHash ?? visitorHash({ dailySalt: salt, ip: clientIp, userAgent, linkId: link.id });

    await clicks.record({
      linkId: link.id,
      workspaceId: link.workspaceId,
      occurredAt: new Date(),
      visitorHash: hash,
      country: ((request.headers["cloudfront-viewer-country"] as string) ?? "").toUpperCase().slice(0, 2) || null,
      /* Deliberately not paired with CloudFront-Viewer-Latitude/Longitude,
         which the same header family offers: a city is a population, a
         coordinate is a location. */
      city: ((request.headers["cloudfront-viewer-city"] as string) ?? "").slice(0, 100) || null,
      device: parseDevice(userAgent),
      browser: parseBrowser(userAgent),
      os: parseOs(userAgent),
      referrerHost: parseReferrerHost(request.headers.referer as string),
      // A QR scan arrives with no referrer and a mobile UA. Imperfect, and
      // the honest alternative — a ?qr marker the printer must remember to
      // add — is worse because it silently under-counts.
      isQr: !request.headers.referer && parseDevice(userAgent) !== "desktop",
      isBot: isBot(userAgent),
      blockedReason,
      matchedRuleId,
      variant,
    });
  } catch (err) {
    app.log.warn({ err, linkId: link.id }, "failed to record click");
  }
}

async function main() {
  if (!JWT_SECRET) {
    app.log.warn("JWT_ACCESS_SECRET is not set — password-protected links cannot be unlocked.");
  }
  await app.listen({ port: PORT, host: "0.0.0.0" });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}

main().catch((err) => {
  app.log.error(err, "redirect service failed to start");
  process.exit(1);
});
