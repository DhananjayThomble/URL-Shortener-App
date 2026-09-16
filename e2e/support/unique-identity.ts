import { createHmac } from "node:crypto";
import { randomBytes } from "node:crypto";

/* ============================================================
   Per-run unique identity helper (issue #440).

   The specs in tests/ were written against the in-memory fixtures fake, which
   forgets everything between runs. Against a real Postgres backend, hard-coded
   emails (e.g. new-user@snapurl.local, demo@snapurl.local) conflict on the
   second run because user accounts are global — a fresh workspace from
   registerRealUser() does not free up the email.

   This module provides:
     - RUN_ID       — a per-process token that makes every identity unique per
                      run, following the same Date.now()+randomBytes approach
                      already used in real-session.ts.
     - makeEmail()  — wraps an intent string (e.g. "login", "register") into a
                      run-scoped address that is valid per RegisterInput/LoginInput
                      zod schemas (email().min(1)).
     - makePassword — a run-scoped password that exceeds the 12-char minimum in
                      packages/contract/src/auth.ts and is never persisted.
     - registerAccount() — POST /auth/register against the staging API and return
                      the AuthSession. Used in spec setup for flows that must sign
                      in as an account that already exists. In fixtures mode this
                      function is NOT called (see note below).
     - enableTotp()  — register an account, set up TOTP, and enable it in one
                      call, returning {email, password, secret, accessToken,
                      refreshToken}. In fixtures mode NOT called.

   Fixtures-mode invariant: in playwright.config.ts (NEXT_PUBLIC_USE_FIXTURES=true),
   the specs that call registerAccount / enableTotp do NOT call those functions —
   they provide their own beforeAll hook that runs only under the real config.
   The fixtures fake accepts any well-formed input, so the specs pass unchanged.

   ============================================================ */

const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Stable for the lifetime of the Node.js process. Uses the same
 * Date.now().toString(36) + randomBytes hex pattern as real-session.ts, so
 * there is one convention in the support/ layer.
 */
export const RUN_ID = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

/**
 * A run-unique, RFC 5321-compliant email address.
 *
 * @param intent  Short label describing the account's purpose, e.g. "login",
 *                "register", "2fa". Kept short so the full address stays under
 *                254 chars and is valid per the zod email() schema.
 */
export function makeEmail(intent: string): string {
  return `e2e-${intent}-${RUN_ID}@example.com`;
}

/**
 * A run-scoped password that satisfies the 12-char minimum in
 * packages/contract/src/auth.ts and is never written to disk.
 */
export const RUN_PASSWORD = `run-pw-${RUN_ID}`;

/**
 * The password the fixtures fake (web/src/lib/api/fixtures.ts) accepts for
 * login. Any email + this password → SESSION; any other password → rejected.
 * Used by login-form.spec.ts in the fixtures lane so the happy path passes and
 * the wrong-password path can actually fail.
 *
 * Keep in sync with FIXTURE_PASSWORD in web/src/lib/api/fixtures.ts.
 * (#445 fixture-fidelity fix)
 */
export const FIXTURE_LOGIN_PASSWORD = "Fixture.pw-445";

/* ------------------------------------------------------------ */
/* TOTP helpers — RFC 6238/4226 in pure Node.js crypto.         */
/* No external library needed; used only by enableTotp().       */
/* ------------------------------------------------------------ */

/**
 * Decode a Base32 string (RFC 4648, case-insensitive, no padding required)
 * into a Buffer. otplib uses standard Base32 for secrets.
 */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/**
 * Generate a 6-digit TOTP code for the given Base32 secret at the current
 * time step (window = 30 s, digits = 6), as per RFC 6238.
 */
export function totpCode(secret: string): string {
  const key = base32Decode(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  const counter = Buffer.alloc(8);
  // Write the 64-bit big-endian step counter
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

/* ------------------------------------------------------------ */
/* API helpers                                                   */
/* ------------------------------------------------------------ */

export interface SeedSession {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/**
 * Register a new account on the staging API and return its session.
 *
 * Oracle: packages/contract/src/auth.ts — AuthSession
 * = { accessToken: string, refreshToken: string, user: AuthUser }
 *
 * Only called in specs that need a pre-existing account (login-form, 2fa-login).
 * NEVER called in fixtures mode — the caller guards with `if (!USE_REAL_BACKEND)`.
 */
export async function registerAccount(email: string, password: string): Promise<SeedSession> {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "E2E Seed User", email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `unique-identity: POST /auth/register → ${res.status}; body=${text.slice(0, 400)}`,
    );
  }
  const body = JSON.parse(text) as {
    accessToken?: string;
    refreshToken?: string;
    user?: { id?: string };
  };
  if (!body.accessToken || !body.refreshToken) {
    throw new Error(
      `unique-identity: /auth/register missing tokens; keys=${Object.keys(body).join(",")}`,
    );
  }
  return {
    email,
    password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user?.id ?? "",
  };
}

export interface TotpSession extends SeedSession {
  secret: string;
}

/**
 * Register an account, set up TOTP, and enable it in one call.
 *
 * Flow (per apps/api/src/auth/auth.controller.ts):
 *   1. POST /auth/register          → AuthSession (accessToken)
 *   2. POST /auth/2fa/setup         → TotpSetup { otpauthUri, secret }
 *   3. POST /auth/2fa/enable {code} → TotpRecoveryCodes
 *
 * Returns enough to drive the 2fa-login spec: email, password, TOTP secret,
 * and the initial tokens (valid for 15 min, enough for one test).
 *
 * Only called in specs that need a 2FA-enabled account.
 * NEVER called in fixtures mode.
 */
export async function registerWith2FA(email: string, password: string): Promise<TotpSession> {
  const seed = await registerAccount(email, password);

  // Step 2: initiate TOTP setup (requires a valid access token).
  // No request body — omit content-type so Fastify does not try to parse an
  // empty body as JSON and reject with 400 "Body cannot be empty".
  const setupRes = await fetch(`${API_URL}/auth/2fa/setup`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${seed.accessToken}`,
    },
  });
  const setupText = await setupRes.text();
  if (!setupRes.ok) {
    throw new Error(
      `unique-identity: POST /auth/2fa/setup → ${setupRes.status}; body=${setupText.slice(0, 400)}`,
    );
  }
  const setupBody = JSON.parse(setupText) as { otpauthUri?: string; secret?: string };
  if (!setupBody.secret) {
    throw new Error(
      `unique-identity: /auth/2fa/setup missing secret; keys=${Object.keys(setupBody).join(",")}`,
    );
  }
  const { secret } = setupBody;

  // Step 3: confirm TOTP with a live code generated from the secret
  const code = totpCode(secret);
  const enableRes = await fetch(`${API_URL}/auth/2fa/enable`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${seed.accessToken}`,
    },
    body: JSON.stringify({ code }),
  });
  const enableText = await enableRes.text();
  if (!enableRes.ok) {
    throw new Error(
      `unique-identity: POST /auth/2fa/enable → ${enableRes.status}; body=${enableText.slice(0, 400)}`,
    );
  }

  return { ...seed, secret };
}
