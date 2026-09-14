import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
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

/**
 * Per-process password, never persisted and never a literal in this file.
 * 32 base64url chars clears the 12-character minimum in
 * packages/contract/src/auth.ts (RegisterInput).
 */
const PASSWORD = process.env.QA_E2E_PASSWORD ?? randomBytes(24).toString("base64url");

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
  const email = `l1-cal-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}@example.com`;
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "L1 Calibration", email, password: PASSWORD }),
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
 * Drop-in replacement for support/session.ts#seedSession.
 *
 * Same contract: call it before the first navigation, because addInitScript
 * runs on every document load and the dashboard's route guard reads
 * localStorage as soon as it hydrates.
 *
 * Each call registers a NEW account, so every test gets an isolated workspace —
 * the closest real-stack analogue of fixtures state being re-initialised on
 * every full document load.
 */
export async function seedRealSession(page: Page): Promise<void> {
  const session = await registerRealUser();
  await page.addInitScript(
    ([tokenKey, refreshKey, access, refresh]) => {
      window.localStorage.setItem(tokenKey, access);
      window.localStorage.setItem(refreshKey, refresh);
    },
    [TOKEN_KEY, REFRESH_KEY, session.accessToken, session.refreshToken] as const,
  );
  diag(`seeded keys=${TOKEN_KEY},${REFRESH_KEY}`);
}

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sessionModule = require("./session") as {
    seedSession: (page: Page) => Promise<void>;
  };
  sessionModule.seedSession = seedRealSession;
  diag("installRealSession patched support/session.ts#seedSession");
}
