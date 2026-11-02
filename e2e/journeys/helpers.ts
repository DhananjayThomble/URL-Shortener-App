/**
 * Shared helpers for the journey suite.
 *
 * Journey-suite rules (these were previously cited as "brief-journey.md", a
 * file that does not exist in the repo — the rules it stood for are written
 * out here, and align with .kiro/steering/qa-oracles.md):
 *  - Never hardcode an id/slug/URL the app generates — read it back from the
 *    page or the API, so an assertion compares against the runtime's own value.
 *  - No fixture-shaped assertions: journeys drive the REAL stack, never the
 *    in-memory fixtures fake (qa-oracles.md §5).
 *  - Every identity is derived per run (no fixed emails or passwords), because
 *    a real Postgres backend keeps accounts between runs and a fixed email
 *    collides on the second run.
 *  - Oracle (qa-oracles.md §1): derive the expected value from
 *    packages/contract (zod schemas), docs/, or an invariant that must hold —
 *    never by reading the implementation back as its own oracle.
 *
 * The three keys below are mirrored from web/src/lib/api/client.ts so the
 * seedAccount helper can drop tokens into localStorage before the first nav.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { createDatabase, domains, eq, memberships, refreshTokens, sql, users, workspaces } from "@snapurl/database";

export const TOKEN_KEY = "snapurl.accessToken";
export const REFRESH_KEY = "snapurl.refreshToken";

export const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";
export const REDIRECT_URL = process.env.QA_REDIRECT_URL ?? "http://localhost:3002";
/* The staging Postgres, for the handful of seed steps HTTP cannot express
   (#977: putting a journey workspace on a paid plan — see setWorkspacePlan).
   Defaults to the compose-staging host port (5435), matching the port the
   real-stack CI lane publishes and QA_API_URL targets. */
export const QA_DATABASE_URL =
  process.env.QA_DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5435/snapurl";

/* The shared system short-domain every workspace puts links on. Mirrors the
   API's DEFAULT_DOMAIN (apps/api env) — the real-stack CI journeys step and the
   compose staging stack both run the API with DEFAULT_DOMAIN=localhost:3002, so
   the system domain row the API provisions on first registration carries that
   host. seedUser() provisions the SAME row (idempotent upsert) so a DB-seeded
   account's workspace points at the identical shared domain a registered one
   would, and createLink()'s `ws.defaultDomain` resolves to it exactly as for a
   registered owner. */
export const DEFAULT_DOMAIN = process.env.QA_DEFAULT_DOMAIN ?? "localhost:3002";

/** Stable per-process run token. Same pattern as support/unique-identity.ts. */
export const RUN_ID = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

/** A run-unique email address. `intent` is a short tag, e.g. "j1", "j2-edit". */
export function makeEmail(intent: string): string {
  return `j-${intent}-${RUN_ID}@example.com`;
}

/**
 * A run-scoped password that clears the 12-char minimum in
 * packages/contract/src/auth.ts (RegisterInput).
 */
export const RUN_PASSWORD = `journeys-pw-${RUN_ID}`;

/* ------------------------------------------------------------------ */
/*  Auth-throttle window limiter (#977)                                */
/* ------------------------------------------------------------------ */

/*
 * Why this exists.
 *
 * /auth/register, /auth/login and /auth/2fa/verify each carry a route-level
 * @Throttle of 5 requests / 60s PER CLIENT IP (apps/api auth.controller.ts).
 * These are security limits — THROTTLE_LIMIT does not lift them and, per
 * apps/api ProxyAwareThrottlerGuard, they are not runtime-tunable either, so a
 * staging run cannot raise them. A journeys CI shard runs every spec in ONE
 * worker (workers:1, fullyParallel:false) on ONE runner IP, so EVERY spec's
 * registers and logins share the same 5/min buckets.
 *
 * Specs used to budget this by hand with scattered `waitForTimeout(61_000)`
 * staggers, each guessing it is first in the shard. That assumption broke as
 * the suite grew and the shard composition shifted: a register/login-heavy spec
 * (e.g. j777) now precedes another (j778/j781) and drains the bucket, so the
 * next spec's login 429s where it expects 401 and the run reds (#977). The 61s
 * guesses are also "wait it out", not "remove the cause".
 *
 * This limiter removes the cause: a single shared, per-WORKER-PROCESS record of
 * the auth calls made on each route-class, and a deterministic wait until the
 * trailing-60s window has room BEFORE the next call. It paces the suite to the
 * real server limit exactly, independent of spec order, with no fixed sleeps
 * and without changing any assertion. Because a shard is one process, one
 * module-level record covers every spec that runs in it.
 *
 * API-side calls (registerUser) reserve a slot automatically. Browser-driven
 * logins (the UI sign-in specs) cannot be intercepted here, so those specs call
 * `reserveLoginSlots(n)` for the n logins the test is about to drive; the
 * reservation blocks until the window has room, then the UI requests land in a
 * window that can serve them.
 */

/** Route-classes that carry the 5/min-per-IP @Throttle the suite must pace. */
export type ThrottledRoute = "register" | "login" | "2fa/verify";

const THROTTLE_LIMIT_PER_ROUTE = 5;
const THROTTLE_WINDOW_MS = 60_000;
/* A small margin added past the exact 60s edge so a reservation that waits for
   a slot never lands a hair early and 429s on a clock/transport skew. */
const THROTTLE_MARGIN_MS = 1_500;

/** Monotonic timestamps (ms) of the recent reserved calls, per route-class. */
const authCallTimes: Record<ThrottledRoute, number[]> = {
  register: [],
  login: [],
  "2fa/verify": [],
};

/* Serialise reservations per route so two concurrent awaits cannot both read a
   window as having room and then each take the last slot. Each reservation
   chains onto the previous one for its route. */
const authReserveChain: Record<ThrottledRoute, Promise<void>> = {
  register: Promise.resolve(),
  login: Promise.resolve(),
  "2fa/verify": Promise.resolve(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function reserveOne(route: ThrottledRoute): Promise<void> {
  const times = authCallTimes[route];
  for (;;) {
    const now = Date.now();
    // Drop calls that have aged out of the trailing window.
    while (times.length > 0 && now - times[0] >= THROTTLE_WINDOW_MS) times.shift();
    if (times.length < THROTTLE_LIMIT_PER_ROUTE) {
      // Room now — claim the slot and return.
      times.push(now);
      return;
    }
    // Full: wait until the oldest call ages out, then re-check.
    const waitMs = times[0] + THROTTLE_WINDOW_MS - now + THROTTLE_MARGIN_MS;
    await sleep(waitMs);
  }
}

/**
 * Reserve `count` slots on a throttled auth route, blocking until the trailing
 * 60s window has room for each. Call it immediately BEFORE the matching
 * requests (API or browser-driven) so they land inside a window that can serve
 * them. Reservations on a route are serialised, so parallel callers cannot race
 * for the same slot.
 *
 * `register` is reserved for you by `registerUser`. Use this directly for the
 * UI sign-in specs: `await reserveLoginSlots(n)` for the n `/auth/login`
 * requests the test is about to drive through the browser, and
 * `reserveAuthSlots("2fa/verify", n)` for 2FA-verify POSTs.
 */
export function reserveAuthSlots(route: ThrottledRoute, count = 1): Promise<void> {
  // Chain `count` reservations onto the route's serial chain and hand back the
  // tail, so the caller awaits until all are granted.
  let tail = authReserveChain[route];
  for (let i = 0; i < count; i++) tail = tail.then(() => reserveOne(route));
  authReserveChain[route] = tail;
  return tail;
}

/** Convenience wrapper for the UI sign-in specs. */
export function reserveLoginSlots(count = 1): Promise<void> {
  return reserveAuthSlots("login", count);
}

/* ------------------------------------------------------------------ */
/*  API helpers — direct fetch against the staging API                 */
/* ------------------------------------------------------------------ */

export interface Session {
  accessToken: string;
  refreshToken: string;
  email: string;
  userId: string;
  workspaceId: string;
}

/**
 * Register a fresh account and return its session tokens.
 * Oracle: packages/contract/src/auth.ts — AuthSession schema.
 */
export async function registerUser(email: string, password = RUN_PASSWORD): Promise<Session> {
  // /auth/register carries a route-level 5/min-per-IP throttle (security
  // behaviour that THROTTLE_LIMIT does NOT lift — .kiro/specs/real-stack-ci/
  // design.md §1 "Throttles"). A spec that registers several accounts, or a
  // CI shard running back-to-back specs on one IP, can hit a 429.
  //
  // Reserve a slot on the shared `register` window FIRST (#977): this paces the
  // whole shard — every spec's registers share this one process-wide record —
  // so a register is issued only when the trailing-60s window has room, instead
  // of each spec guessing it starts with a clean bucket. The 429 back-off below
  // is kept as a belt-and-suspenders safety net for any register that does not
  // route through this helper (none in the journey suite today).
  await reserveAuthSlots("register");
  let text = "";
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Journey Tester", email, password }),
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    text = await res.text();
    break;
  }
  if (!res!.ok) {
    throw new Error(`registerUser: POST /auth/register → ${res!.status}; body=${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as {
    accessToken?: string;
    refreshToken?: string;
    user?: { id?: string };
    workspaceId?: string;
  };
  if (!body.accessToken || !body.refreshToken) {
    throw new Error(`registerUser: missing tokens; keys=${Object.keys(body).join(",")}`);
  }
  // workspaceId comes from the JWT sub-claim; parse it out of the token
  const payload = JSON.parse(Buffer.from(body.accessToken.split(".")[1], "base64").toString());
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    email,
    userId: body.user?.id ?? payload.sub ?? "",
    workspaceId: payload.wid ?? "",
  };
}

/**
 * Put a workspace on a paid plan so it may connect custom domains (#977).
 *
 * Why this exists. #966 made custom domains a paid-plan feature, and #970
 * replaced the static table with a DB-backed plan catalogue: `POST /domains`
 * now 403s a workspace on the default "Free" plan (apps/api domains.service.ts
 * → EntitlementsService.hasFeature → PlansService.resolveForWorkspace over the
 * plans table). Journey accounts are created by registerUser() on "Free", so
 * every custom-domain journey (j20/j23/j26/j782/j783/j784 …) started 403ing — a
 * test-seed gap, not a product bug. The plan gate itself is proven by
 * domains.plan-gate.integration.test.ts; these journeys exercise the domain UX
 * on a workspace that is ENTITLED to it, so they must seed the entitlement
 * rather than assert the gate.
 *
 * The seed is written exactly the way the HTTP stack principals are put on a
 * paid plan (apps/api/src/stack/principals.ts, still `.set({ plan: "Enterprise" })`
 * on main under #970): a direct UPDATE of the workspace's `plan` column — the
 * one thing the public API cannot express (changing your own plan is a
 * billing/webhook action, not a user route, and the admin route needs a 2FA'd
 * platform-admin the staging stack has none of). The engine then resolves the
 * entitlement through EntitlementsService/the plans table; this only sets that
 * engine's INPUT, it does not re-decide entitlements itself.
 *
 * Under #970 the plan string must be a REAL catalogue key: resolveForWorkspace
 * lower-cases `workspaces.plan` and looks it up in the DB catalogue, with the
 * compiled-in SEED_PLANS (apps/api/src/plans/plan-seed.ts) as the documented
 * fallback for "a test that writes workspaces.plan directly"; an UNKNOWN key
 * now fails closed to Free (the #970 behaviour change). "Enterprise" → the
 * seeded `enterprise` plan (customDomains: true, a 1000 cap far clear of the
 * fixture domains these journeys mint without cleanup across a run), so the gate
 * opens; a made-up name would not. Keep this value a shipped SEED_PLANS key.
 *
 * Idempotent and safe to call right after registerUser(), before the first
 * navigation (per-workspace resolution is read fresh each request — only the
 * catalogue is cached — so there is no stale-plan window). It opens a
 * short-lived pool (max: 1) and closes it before returning, so a spec can call
 * it per owner without leaking connections.
 */
export async function setWorkspacePlan(workspaceId: string, plan = "Enterprise"): Promise<void> {
  const handle = createDatabase({ url: QA_DATABASE_URL, max: 1 });
  try {
    await handle.db.update(workspaces).set({ plan }).where(eq(workspaces.id, workspaceId));
  } finally {
    await handle.close();
  }
}

/**
 * Register a fresh owner whose workspace is already on a paid plan, so it can
 * connect custom domains (#977). Convenience wrapper over registerUser() +
 * setWorkspacePlan() for the custom-domain journeys.
 */
export async function registerPaidOwner(email: string, password = RUN_PASSWORD): Promise<Session> {
  const session = await registerUser(email, password);
  await setWorkspacePlan(session.workspaceId);
  return session;
}

/* ------------------------------------------------------------------ */
/*  DB-seeded accounts — zero throttled auth calls (#977 Option A)     */
/* ------------------------------------------------------------------ */

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Produce the `base/base-2/base-3/.../base-<rand>` slug ladder the API uses,
 * mirroring apps/api auth.service.ts insertWorkspaceWithUniqueSlug so a seeded
 * workspace's slug is shaped identically to a registered one and collides the
 * same (benign) way under the unique index.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Create a fully-provisioned, email-verified owner account WITHOUT touching the
 * throttled /auth/register route, and return a session carrying REAL
 * API-issued tokens (#977 Option A).
 *
 * WHY. /auth/register and /auth/login are 5/min-per-IP security throttles the
 * staging stack cannot lift (apps/api auth.controller.ts; ProxyAwareThrottler
 * only overrides routes WITHOUT an explicit @Throttle). A journeys CI shard
 * runs every spec in one worker on ONE runner IP, and the suite's ~150+
 * registerUser() calls (most specs mint 2-5 disposable owners just to get an
 * authenticated session) overrun the register bucket over the shard's length no
 * matter how they are paced — a sustained-demand-exceeds-capacity problem, not
 * a windowing one (#977 diagnosis). Pacing only moves the 429 to whoever runs
 * last. The only durable fix is to stop spending the bucket for accounts whose
 * SUBJECT is not the register UI.
 *
 * HOW (no forged JWT; real issuance). This replicates exactly what
 * AuthService.register() + provisionWorkspace() write — a user row, a
 * uniquely-slugged workspace, the shared system default domain, and an owner
 * membership — by direct DB insert (the ruling: "DB-inserted accounts are fine
 * for API-only setup"). It then inserts ONE refresh-token row the way
 * TokenService.issueRefreshToken() does (a random opaque token, stored only as
 * its sha256 hash) and exchanges it at POST /auth/refresh — which is NOT
 * throttled (no @Throttle on the controller; only the global 120/min applies) —
 * for a real access token + rotated refresh token. The tokens therefore come
 * off the real issuance path; nothing is hand-signed. The account is stamped
 * email_verified_at so #993's unverified-owner link hold does not apply, matching
 * a registered-then-verified owner.
 *
 * Use this for every spec whose subject is NOT the register/login/2FA UI. The
 * auth-UI specs (j01, j778, j794, j10/j776 2FA, j777, j26-login-next, j15 accept,
 * j17 (x)) keep registerUser()/the real forms, so the register and login flows
 * are still exercised end-to-end — just not 150 times a shard.
 *
 * The signature mirrors registerUser(email): pass the account's email (usually
 * makeEmail("tag")), so a conversion is a 1:1 rename and any spec that needs the
 * account's address to match an invite keeps using the same value.
 */
export async function seedUser(emailArg: string, opts: { plan?: string } = {}): Promise<Session> {
  const email = emailArg.toLowerCase();
  const name = "Journey Tester";
  const handle = createDatabase({ url: QA_DATABASE_URL, max: 1 });
  let userId = "";
  let workspaceId = "";
  const rawRefresh = randomBytes(48).toString("base64url");
  try {
    await handle.db.transaction(async (tx) => {
      // 1. The user row — email-verified so #993's unverified-owner link hold
      //    never applies (a seeded owner is the equivalent of registered+verified).
      //    passwordHash stays null: a seeded account authenticates ONLY through
      //    its seeded session, never the password path, which is exactly what
      //    the auth-volume guard enforces. A null hash makes the login path
      //    refuse it, so the account can never be driven through the UI login.
      const [user] = await tx
        .insert(users)
        .values({ name, email, passwordHash: null, emailVerifiedAt: new Date() })
        .returning();
      userId = user!.id;

      // 2. The workspace, with the same unique-slug ladder the API uses.
      const base = slugify(name) || "workspace";
      let workspace: typeof workspaces.$inferSelect | undefined;
      for (let attempt = 0; attempt < 30 && !workspace; attempt++) {
        const candidate =
          attempt === 0 ? base : attempt < 20 ? `${base}-${attempt + 1}` : `${base}-${randomBytes(6).toString("hex")}`;
        [workspace] = await tx
          .insert(workspaces)
          .values({ name: `${name}'s workspace`, slug: candidate, defaultRedirect: "302", ...(opts.plan ? { plan: opts.plan } : {}) })
          .onConflictDoNothing({ target: workspaces.slug })
          .returning();
      }
      if (!workspace) throw new Error(`seedUser: could not allocate a unique workspace slug for "${base}"`);
      workspaceId = workspace.id;

      // 3. The shared system default domain (idempotent — the API's first
      //    registration creates it, the rest find it), then point the workspace at it.
      await tx
        .insert(domains)
        .values({
          workspaceId: null,
          domain: DEFAULT_DOMAIN,
          isSystem: true,
          status: "live",
          ssl: "active",
          verifiedAt: new Date(),
        })
        .onConflictDoNothing();
      const [systemDomain] = await tx
        .select({ id: domains.id })
        .from(domains)
        .where(sql`lower(${domains.domain}) = ${DEFAULT_DOMAIN.toLowerCase()}`)
        .limit(1);
      if (systemDomain) {
        await tx.update(workspaces).set({ defaultDomainId: systemDomain.id }).where(eq(workspaces.id, workspace.id));
      }

      // 4. The owner membership.
      await tx.insert(memberships).values({
        workspaceId: workspace.id,
        userId,
        email,
        role: "owner",
        status: "active",
        acceptedAt: new Date(),
      });

      // 5. A refresh-token row (hashed, exactly as TokenService.issueRefreshToken
      //    stores it) that /auth/refresh will exchange for a real session below.
      //    A fresh familyId, 30-day expiry matching the default JWT_REFRESH_TTL_DAYS.
      await tx.insert(refreshTokens).values({
        userId,
        familyId: randomUUID(),
        tokenHash: sha256Hex(rawRefresh),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      });
    });
  } finally {
    await handle.close();
  }

  // 6. Exchange the seeded refresh token for a REAL access token at the
  //    UNTHROTTLED /auth/refresh route. No forged JWT — the server signs it.
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rawRefresh }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`seedUser: POST /auth/refresh → ${res.status}; body=${text.slice(0, 400)}`);
  }
  const body = JSON.parse(text) as { accessToken?: string; refreshToken?: string };
  if (!body.accessToken || !body.refreshToken) {
    throw new Error(`seedUser: /auth/refresh returned no tokens; keys=${Object.keys(body).join(",")}`);
  }
  const payload = JSON.parse(Buffer.from(body.accessToken.split(".")[1], "base64").toString());
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    email,
    userId: userId || (payload.sub ?? ""),
    workspaceId: workspaceId || (payload.wid ?? ""),
  };
}

/**
 * Register a DB-seeded owner whose workspace is already on a paid plan (#977).
 * The seeded equivalent of registerPaidOwner for custom-domain journeys whose
 * subject is not the auth UI.
 */
export async function seedPaidOwner(email: string): Promise<Session> {
  return seedUser(email, { plan: "Enterprise" });
}

/**
 * Seed tokens into localStorage before the first navigation.
 * Must be called before page.goto().
 */
export async function seedAccount(page: Page, session: Session): Promise<void> {
  await page.addInitScript(
    ([tokenKey, refreshKey, access, refresh]) => {
      window.localStorage.setItem(tokenKey as string, access as string);
      window.localStorage.setItem(refreshKey as string, refresh as string);
    },
    [TOKEN_KEY, REFRESH_KEY, session.accessToken, session.refreshToken],
  );
}

/**
 * Establish an authenticated browser session WITHOUT a UI /auth/login (#977,
 * Option A). Seeds the session's real tokens into localStorage (seedAccount),
 * then lands on the dashboard and waits for the app shell. This is the drop-in
 * replacement for the boilerplate `signIn()` helpers that drove the login form
 * purely to reach an authenticated state: those UI logins spend the 5/min-per-IP
 * /auth/login route bucket, and a full shard's worth of them (one per spec on a
 * single runner IP) overruns it no matter how they are paced. The tokens here
 * came from the real API issuance path (registerUser / a pooled login), so no
 * JWT is forged — the only thing removed is a redundant SECOND trip through the
 * login UI whose behaviour the spec is not testing.
 *
 * Use this for every spec whose SUBJECT is not the login/register UI. Specs
 * that actually test auth (j01, j778, j794, j26-login-next, j10/j776 2FA,
 * j777, j15 accept, j17 (x)) keep driving the real form.
 *
 * `landingPath` defaults to /links; pass another authed route if the spec
 * starts elsewhere. It asserts the app left /login (the guard accepted the
 * seeded session), which is the same post-condition the old signIn() helpers
 * asserted — no weakened assertion, just no network login.
 */
export async function signInViaSeed(page: Page, session: Session, landingPath = "/links"): Promise<void> {
  await seedAccount(page, session);
  await page.goto(landingPath);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/**
 * Create a link via the API and return the full Link object.
 * Oracle: packages/contract/src/link.ts — Link schema.
 */
export async function createLink(
  token: string,
  opts: { destination: string; slug?: string; domain?: string },
): Promise<{ id: string; slug: string; domain: string; destination: string }> {
  // First, get the workspace to know the default domain
  const wsRes = await fetch(`${API_URL}/workspaces/current`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const ws = await wsRes.json() as { defaultDomain?: string };
  const domain = opts.domain ?? ws.defaultDomain ?? "localhost:3002";

  const slug = opts.slug ?? `j-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ destination: opts.destination, domain, slug }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`createLink: POST /links → ${res.status}; body=${text.slice(0, 400)}`);
  }
  const link = JSON.parse(text) as { id: string; slug: string; domain: string; destination: string };
  return link;
}

/**
 * The public short URL the web app puts on the clipboard / in a QR payload.
 *
 * Oracle (#641 / #721, web/src/lib/utils.ts shortUrlHref): the scheme is the
 * one the app itself is served over, NOT a hard-coded https:// — the local
 * staging stack serves web and redirect over http, a deployed stack over
 * https. Never hard-code the scheme in an assertion: derive it from the page
 * under test, so the expectation tracks the runtime and still compares the
 * whole string (scheme, host, slug).
 */
export function expectedShortUrl(page: Page, link: { domain: string; slug: string }): string {
  const { protocol } = new URL(page.url());
  return `${protocol}//${link.domain}/${link.slug}`;
}

/* ------------------------------------------------------------------ */
/*  TOTP helpers (RFC 6238) — pure Node.js, no external library        */
/* ------------------------------------------------------------------ */

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(output);
}

import { createHmac } from "node:crypto";

export function totpCode(secret: string): string {
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1_000_000;
  return code.toString().padStart(6, "0");
}
