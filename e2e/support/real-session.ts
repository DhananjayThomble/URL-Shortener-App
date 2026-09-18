import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

/* ============================================================
   A REAL session for the existing specs.

   support/session.ts seeds two hard-coded strings ("fixture.access.token" /
   "fixture.refresh.token") into localStorage. Those are the exact values the
   in-memory fake in web/src/lib/api/fixtures.ts hands out, so they only mean
   anything while NEXT_PUBLIC_USE_FIXTURES=true. Against the NestJS API they are
   not JWTs at all and every authenticated request is refused.

   This module registers a throwaway account against a running staging API and
   seeds the tokens that API actually issued, under the SAME two localStorage
   keys (web/src/lib/api/client.ts: TOKEN_KEY / REFRESH_KEY). It is selected by
   playwright.real.config.ts; support/session.ts is left untouched, and so is
   every file in tests/.

   Credentials are generated at runtime. Nothing secret is written to disk.
   ============================================================ */

/** Same keys web/src/lib/api/client.ts reads, mirrored from support/session.ts. */
const TOKEN_KEY = "snapurl.accessToken";
const REFRESH_KEY = "snapurl.refreshToken";

const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

/* ----  Shared seed-state  ------------------------------------------------
   When globalSetup (seed-real.ts) runs, it creates a single seeded workspace
   and writes its tokens to SEED_STATE_FILE. Tests that need the seeded entities
   (links, forms, bio pages, members, reports) must reuse THAT workspace, not
   register a fresh empty one.

   We load the file once (module scope = one load per worker process) and fall
   back to fresh-registration if the file is absent (e.g. running without the
   real-stack config).
   ---------------------------------------------------------------------- */
const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../../.qa-runs/real-stack");
const SEED_STATE_FILE = path.join(RUN_DIR, "seed-state.json");

interface SeedState {
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
}

let _seedState: SeedState | null = null;

function loadSeedState(): SeedState | null {
  if (_seedState) return _seedState;
  try {
    if (existsSync(SEED_STATE_FILE)) {
      _seedState = JSON.parse(readFileSync(SEED_STATE_FILE, "utf8")) as SeedState;
      return _seedState;
    }
  } catch {
    // Unreadable state — fall back to fresh registration
  }
  return null;
}

/**
 * Per-process password, never persisted and never a literal in this file.
 * 32 base64url chars clears the 12-character minimum in
 * packages/contract/src/auth.ts (RegisterInput).
 */
const PASSWORD = process.env.QA_E2E_PASSWORD ?? randomBytes(24).toString("base64url");

/** Per-process monotonic counter, part of the registration local-part so two
 *  registrations in the same worker+millisecond cannot collide. */
let _regSeq = 0;

/**
 * Optional harness diagnostic: proves this module — rather than
 * support/session.ts — is what ran, and in which worker. Token VALUES are never
 * written, only the key names and the account's local-part.
 */
function diag(line: string): void {
  const target = process.env.QA_REAL_SESSION_LOG;
  if (!target) return;
  try {
    appendFileSync(target, `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  } catch {
    /* diagnostics must never fail a test */
  }
}

export interface RealSession {
  accessToken: string;
  refreshToken: string;
  email: string;
  userId: string;
}

/**
 * Register a fresh account (and therefore a fresh, EMPTY workspace) on the
 * staging API.
 *
 * Oracle for the response shape: packages/contract/src/auth.ts — `AuthSession`
 * = { accessToken: string, refreshToken: string, user: AuthUser }. A response
 * that does not carry both tokens is surfaced as a thrown error rather than
 * silently producing a half-authenticated page.
 */
export async function registerRealUser(): Promise<RealSession> {
  // The 409 this previously hit ("That already exists") was NOT an email
  // collision — 8 random bytes do not collide across dozens of registrations,
  // and a duplicate email produces a different message
  // (AuthService.register's own pre-check: "An account with that email
  // already exists. Try signing in instead."). "That already exists" is the
  // generic Postgres 23505 unique-violation mapping
  // (apps/api/src/common/postgres-error.filter.ts), and the column that
  // actually collided is the WORKSPACE SLUG: every registration previously
  // sent a constant display name, so provisionWorkspace's
  // `baseSlug = slugify(displayName)` was identical for every account, and
  // uniqueWorkspaceSlug (auth.service.ts) is a check-then-act loop over
  // `base`, `base-2` … `base-20` before falling back to a millisecond-only
  // suffix with no randomness — a fallback two parallel workers can land on
  // together. Making the email unique alone cannot fix a slug collision, so
  // the suffix is now shared by both the email and the display name, which
  // keeps `baseSlug` itself unique per registration and means
  // uniqueWorkspaceSlug never has to walk the ladder. slugify() also
  // truncates to 40 chars, so the display name uses a short "l1cal" prefix
  // rather than "L1 Calibration" — otherwise the truncation would cut into
  // the random part of the suffix and reopen the same collision.
  const suffix = `${Date.now().toString(36)}-${process.pid.toString(36)}-${(_regSeq++).toString(36)}-${randomBytes(8).toString("hex")}`;
  const email = `l1-cal-${suffix}@example.com`;
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `l1cal ${suffix}`, email, password: PASSWORD }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `real-session: POST ${API_URL}/auth/register returned ${res.status}; body=${text.slice(0, 400)}`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`real-session: /auth/register returned non-JSON: ${text.slice(0, 200)}`);
  }
  const session = body as Partial<RealSession> & { user?: { id?: string } };
  if (typeof session.accessToken !== "string" || typeof session.refreshToken !== "string") {
    throw new Error(
      `real-session: /auth/register response is missing accessToken/refreshToken (contract AuthSession); keys=${Object.keys(
        session as object,
      ).join(",")}`,
    );
  }
  diag(`registered local-part=${email.split("@")[0]}`);
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    email,
    userId: session.user?.id ?? "",
  };
}

/**
 * Create one link in a session's workspace through the real API and return its
 * id. Used by the a11y audit to reach `/links/[id]` — a dynamic route that
 * cannot be scanned without a real entity to point at, and which the a11y
 * config deliberately does not run the entity-seed globalSetup for.
 *
 * Oracle for the request/response shape: packages/contract/src/link.ts —
 * `CreateLinkInput` (destination piped through HttpUrl, domain required, slug
 * optional) and `Link` (carries `id`). The workspace's default domain comes
 * from GET /workspaces/current (contract: workspace.ts `Workspace.defaultDomain`).
 */
export async function createRealLink(
  session: RealSession,
  destination = "https://example.com/a11y-links-id-audit",
): Promise<{ id: string }> {
  const ws = (await (
    await fetch(`${API_URL}/workspaces/current`, {
      headers: { authorization: `Bearer ${session.accessToken}` },
    })
  ).json()) as { defaultDomain?: string };
  const domain = ws.defaultDomain;
  if (!domain) {
    throw new Error("real-session: GET /workspaces/current returned no defaultDomain");
  }
  const slug = `a11y-${randomBytes(4).toString("hex")}`;
  const res = await fetch(`${API_URL}/links`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ destination, domain, slug }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `real-session: POST ${API_URL}/links returned ${res.status}; body=${text.slice(0, 400)}`,
    );
  }
  const link = JSON.parse(text) as { id?: string };
  if (typeof link.id !== "string") {
    throw new Error(
      `real-session: POST /links response is missing id (contract Link); body=${text.slice(0, 200)}`,
    );
  }
  return { id: link.id };
}

/**
 * Seed a specific set of tokens (from an already-registered RealSession) into
 * localStorage before the app boots — the same keys web/src/lib/api/client.ts
 * reads. Lets a test that registered its own account (to create an entity it
 * then scans) drive the browser as that same account, rather than the
 * fresh-per-call account seedRealSession would mint.
 */
export async function seedSessionTokens(page: Page, session: RealSession): Promise<void> {
  await page.addInitScript(
    ([tokenKey, refreshKey, a, r]) => {
      window.localStorage.setItem(tokenKey, a);
      window.localStorage.setItem(refreshKey, r);
    },
    [TOKEN_KEY, REFRESH_KEY, session.accessToken, session.refreshToken] as const,
  );
}

/**
 * Drop-in replacement for support/session.ts#seedSession.
 *
 * Same contract: call it before the first navigation, because addInitScript
 * runs on every document load and the dashboard's route guard reads
 * localStorage as soon as it hydrates.
 *
 * When a seed-state.json file is present (written by globalSetup / seed-real.ts),
 * ALL tests share the SAME workspace so they can see the seeded entities (links,
 * forms, bio pages, members, reports, conversions). Without the state file (e.g.
 * running specs individually without globalSetup), each call registers a fresh
 * account — the original behaviour, which gives an isolated but empty workspace.
 *
 * Note: sharing one workspace means mutations in one test are visible to others.
 * That is intentional: the real-stack run exists to measure behaviour against
 * real data, not to guarantee test isolation. Isolation is the fixtures run's job.
 */
export async function seedRealSession(page: Page): Promise<void> {
  const seed = loadSeedState();
  let access: string;
  let refresh: string;

  if (seed) {
    // Reuse the shared seeded workspace. Verify the token is still live; if not,
    // re-login with the stored password.
    const check = await fetch(`${API_URL}/workspaces/current`, {
      headers: { authorization: `Bearer ${seed.accessToken}` },
    });
    if (check.ok) {
      access = seed.accessToken;
      refresh = seed.refreshToken;
    } else {
      // Token may have expired between globalSetup and this test. Re-login.
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: seed.email, password: seed.password }),
      });
      if (loginRes.ok) {
        const body = await loginRes.json() as { accessToken: string; refreshToken: string };
        access = body.accessToken;
        refresh = body.refreshToken;
        // Update in-memory cache so subsequent tests in this worker don't re-login
        _seedState = { ...seed, accessToken: access, refreshToken: refresh };
      } else {
        // Can't reuse — fall back to fresh account (test will see an empty workspace)
        diag("seed re-login failed, falling back to fresh account");
        const fresh = await registerRealUser();
        access = fresh.accessToken;
        refresh = fresh.refreshToken;
      }
    }
    diag(`seeded from shared workspace email=${seed.email}`);
  } else {
    // No state file — register a fresh isolated account (original behaviour)
    const fresh = await registerRealUser();
    access = fresh.accessToken;
    refresh = fresh.refreshToken;
    diag(`seeded fresh account`);
  }

  await page.addInitScript(
    ([tokenKey, refreshKey, a, r]) => {
      window.localStorage.setItem(tokenKey, a);
      window.localStorage.setItem(refreshKey, r);
    },
    [TOKEN_KEY, REFRESH_KEY, access, refresh] as const,
  );
  diag(`set keys=${TOKEN_KEY},${REFRESH_KEY}`);
}

/**
 * True once installRealSession() has been called (i.e. the real-stack config
 * is active). Specs that need to create pre-existing accounts (login-form,
 * 2fa-login) can import this to guard their beforeAll hooks so they remain
 * harmless in fixtures mode.
 */
export let REAL_BACKEND = false;

/**
 * Swap seedRealSession in for support/session.ts#seedSession without editing
 * either that file or any spec.
 *
 * The specs do `import { seedSession } from "../support/session"`. Playwright
 * transpiles them to CommonJS (e2e/package.json has no "type": "module"), so the
 * call site compiles to a property read on the module's exports object at call
 * time — reassigning that property here therefore changes what the specs call.
 * Playwright loads the config file in every worker process before it loads any
 * test file, so calling this at config module scope covers all workers.
 */
export function installRealSession(): void {
  REAL_BACKEND = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sessionModule = require("./session") as {
    seedSession: (page: Page) => Promise<void>;
  };
  sessionModule.seedSession = seedRealSession;
  diag("installRealSession patched support/session.ts#seedSession");
}
