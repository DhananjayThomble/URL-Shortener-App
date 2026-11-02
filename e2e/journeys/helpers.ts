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

import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { createDatabase, eq, workspaces } from "@snapurl/database";

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
