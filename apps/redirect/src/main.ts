import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { createDatabase, resolveDatabaseUrl, resolveJwtSecret } from "@snapurl/database";
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
import { createCacheStore, type CacheDriver } from "@snapurl/cache";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoLinkResolver, PostgresLinkResolver, type LinkResolver, type ResolvedLink } from "./resolver.js";
import { CachingLinkResolver } from "./caching-resolver.js";
import { PostgresClickSink, SqsClickSink, type ClickSink } from "./click-sink.js";
import { CacheStoreSaltCache, PostgresSaltCache, type SaltSource } from "./salt.js";

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
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

/* DATABASE_URL and the JWT signing key used to be read at module top. They are
   now resolved inside init() (called at the start of main()) so that, when a
   *_SECRET_ARN env var is set, the values come from Secrets Manager at cold
   start before the connection is opened or a token is verified. With no ARN
   set, resolveDatabaseUrl / resolveJwtSecret return the plain env values (or
   the compose defaults below) and make no SDK call, so the plain-env path is
   unchanged. Building `db` lazily also keeps module import side-effect free:
   nothing connects to Postgres just by importing this file, which matters for
   the tests that import from ./resolver.js. */
const JWT_SECRET_DEFAULT = process.env.JWT_ACCESS_SECRET ?? "";

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

/* Which CacheStore backs the hot-link cache and the daily-salt cache. 'memory'
   (the default) is a per-instance in-memory cache, which is all local/CI/compose
   and any single-node deployment needs. The scaled profile sets 'redis' +
   REDIS_URL so the cache is shared across instances; the AWS profile sets
   'dynamodb' + CACHE_DYNAMO_TABLE so it is shared via DynamoDB — which is what
   lets the out-of-VPC redirect share one daily salt across instances instead of
   each holding its own. See docs/DECISIONS.md for the per-profile reasoning. */
const CACHE_DRIVER = (process.env.CACHE_DRIVER ?? "memory") as CacheDriver;
const REDIS_URL = process.env.REDIS_URL;
/* The cache table name, required only when CACHE_DRIVER=dynamodb (the AWS
   profile). It backs both the hot-link cache and — crucially — the shared
   daily-salt cache: with the redirect out of the VPC, this shared DynamoDB
   store is what lets every instance agree on today's salt instead of each
   holding its own per-instance value. The factory throws if the driver is
   'dynamodb' and this is unset, so a misconfigured deploy fails loudly at boot
   rather than silently falling back to a per-instance store. */
const CACHE_DYNAMO_TABLE = process.env.CACHE_DYNAMO_TABLE;

/* Which store the redirect resolves link config from, keyed on LINK_PROJECTION:
   'dynamo' reads the DynamoDB projection the worker writes (the AWS profile);
   anything else / unset reads Postgres directly, which is what local dev,
   compose, the single-node and the Kubernetes profiles all use — byte-for-byte
   the behaviour before this switch existed. LINK_PROJECTION_TABLE names the
   DynamoDB table on the 'dynamo' path. */
const LINK_PROJECTION = process.env.LINK_PROJECTION ?? "none";
const LINK_PROJECTION_TABLE = process.env.LINK_PROJECTION_TABLE;

/* Where a click goes after the redirect, keyed on CLICK_SINK:
   'sqs' sends an awaited SendMessage to CLICK_QUEUE_URL (the AWS profile — the
   worker drains it back into click_events); anything else / unset writes
   straight to Postgres, which is what local dev, compose, the single-node and
   Kubernetes profiles all use — byte-for-byte the behaviour before this switch.
   Under LINK_PROJECTION=dynamo + CLICK_SINK=sqs the redirect touches only
   DynamoDB + SQS (public AWS endpoints) and opens NO Postgres connection, which
   is what lets it leave the VPC (#288 3b). */
const CLICK_SINK = process.env.CLICK_SINK ?? "postgres";
const CLICK_QUEUE_URL = process.env.CLICK_QUEUE_URL;

/* OPTIONAL endpoint-url overrides for the AWS SDK clients. Both return
   undefined in production, so the DynamoDB and SQS clients resolve their real
   regional endpoints and `endpoint` is simply omitted — a genuine no-op. CI
   sets AWS_ENDPOINT_URL_DYNAMODB (a dynamodb-local container) and, if it ever
   runs an SQS emulator, AWS_ENDPOINT_URL_SQS, so the same adapters can be
   exercised against local emulators without any code change. The
   service-specific env wins over the service-agnostic AWS_ENDPOINT_URL,
   matching the SDK's own precedence. */
function dynamoEndpoint(): string | undefined {
  return process.env.AWS_ENDPOINT_URL_DYNAMODB ?? process.env.AWS_ENDPOINT_URL ?? undefined;
}
function sqsEndpoint(): string | undefined {
  return process.env.AWS_ENDPOINT_URL_SQS ?? process.env.AWS_ENDPOINT_URL ?? undefined;
}
/* A short bounded-staleness window: an edited link stops serving its old
   destination within this many seconds even before edit-invalidation lands.
   Ten seconds keeps the database out of the hot path for the common repeated
   click while honouring "change where it points forever". */
const LINK_CACHE_TTL_SECONDS = Number(process.env.LINK_CACHE_TTL_SECONDS ?? 10);

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
/* Assigned by init() before app.listen(), and used only from inside request
   handlers (which cannot fire before the server is listening). Kept as
   module-level bindings so the handlers below can close over them. */
let close: () => Promise<void> = async () => {};
let resolver: LinkResolver;
let clicks: ClickSink;
let salts: SaltSource;
let JWT_SECRET = JWT_SECRET_DEFAULT;

/** Resolve secrets, open the connection and wire up the adapters. Called once
 *  at the start of main(), before the server starts accepting requests. */
async function init(): Promise<void> {
  JWT_SECRET = (await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET")) ?? "";

  /* Which of the three hot-path stores each adapter reads from decides whether
     the redirect needs Postgres at all:

       - the resolver reads Postgres UNLESS LINK_PROJECTION=dynamo;
       - the click sink writes Postgres UNLESS CLICK_SINK=sqs;
       - the salt source reads Postgres only when the db handle exists,
         otherwise it reads the shared CacheStore (DynamoDB on the AWS profile).

     So Postgres is opened only when the resolver or the sink needs it. Under
     LINK_PROJECTION=dynamo + CLICK_SINK=sqs both are off Postgres and the
     redirect opens NO connection — no pool, no ENI, no ~109-connection RDS
     ceiling — which is exactly what lets it leave the VPC (#288 3b). We never
     resolve DATABASE_URL or build a pool on that path. */
  const resolverUsesPostgres = LINK_PROJECTION !== "dynamo";
  const sinkUsesPostgres = CLICK_SINK !== "sqs";
  const needsPostgres = resolverUsesPostgres || sinkUsesPostgres;

  let database: ReturnType<typeof createDatabase> | undefined;
  if (needsPostgres) {
    const url =
      (await resolveDatabaseUrl()) ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
    database = createDatabase({
      url,
      replicaUrl: process.env.DATABASE_REPLICA_URL,
      ssl: process.env.DATABASE_SSL === "true",
      sslNoVerify: process.env.DATABASE_SSL_NO_VERIFY === "true",
      sslCaCert: process.env.DATABASE_CA_CERT,
      max: POOL_MAX,
    });
    close = database.close;
  }

  /* The base resolver: DynamoDB projection on the AWS profile, Postgres
     everywhere else. Under 'dynamo' the redirect does NOT need Postgres to
     RESOLVE a link — the projection carries everything. */
  let baseResolver: LinkResolver;
  if (LINK_PROJECTION === "dynamo") {
    if (!LINK_PROJECTION_TABLE) throw new Error("LINK_PROJECTION=dynamo requires LINK_PROJECTION_TABLE to be set.");
    /* removeUndefinedValues mirrors the worker's writer client. The resolver
       only reads (GetItem/Query), but keeping the marshall options identical on
       both sides means the reader and writer never disagree about how an
       optional/absent field is represented, and a future write on this client
       (none today) could not reintroduce the undefined-marshalling throw that
       silently emptied the projection. */
    const dynamo = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION, endpoint: dynamoEndpoint() }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
    baseResolver = new DynamoLinkResolver(dynamo, LINK_PROJECTION_TABLE);
  } else {
    baseResolver = new PostgresLinkResolver(database!.db);
  }
  /* Wrap the base resolver in the short-lived cache. With the default 'memory'
     driver this is a per-instance cache with a 10s TTL — a safe optimization
     that never changes redirect correctness: a hot link still 302s to the
     right place and the click is still recorded per request. DynamoDB is
     already fast, but the wrap is kept uniform (it cuts read cost and keeps hit
     and miss returning an identical link); the 'none' path wraps
     PostgresLinkResolver exactly as before. */
  const cacheStore = await createCacheStore({
    driver: CACHE_DRIVER,
    redisUrl: REDIS_URL,
    dynamoTable: CACHE_DYNAMO_TABLE,
  });
  resolver = new CachingLinkResolver(baseResolver, cacheStore, LINK_CACHE_TTL_SECONDS);

  /* The click sink: an awaited SQS SendMessage on the AWS profile (freeze-safe,
     drained by the worker), a Postgres INSERT everywhere else. */
  if (CLICK_SINK === "sqs") {
    if (!CLICK_QUEUE_URL) throw new Error("CLICK_SINK=sqs requires CLICK_QUEUE_URL to be set.");
    clicks = new SqsClickSink(
      new SQSClient({ region: process.env.AWS_REGION, endpoint: sqsEndpoint() }),
      CLICK_QUEUE_URL,
    );
  } else {
    clicks = new PostgresClickSink(database!.db);
  }

  /* The salt source: the daily_salts table when a Postgres handle exists,
     otherwise the shared CacheStore so a redirect that has left Postgres can
     still salt its visitor hashes without a connection. */
  salts = database ? new PostgresSaltCache(database.db) : new CacheStoreSaltCache(cacheStore);
}

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
     here would cost more latency than the accuracy is worth. Note the
     CachingLinkResolver freezes link.clicks for up to LINK_CACHE_TTL_SECONDS
     on a cache hit, so on the hot path the overshoot window widens by that
     TTL on top of the rollup lag; still bounded, still cheaper than a live
     count, and the short TTL keeps it small. */
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
  await init();
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
