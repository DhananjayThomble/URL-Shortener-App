/**
 * Shared helpers for the journey suite.
 *
 * Rules (brief-journey.md):
 *  - Never hardcode an id/slug/URL the app generates — read it back from page/API.
 *  - Every identity derived per run (no fixed emails, no fixed passwords).
 *  - Oracle: packages/contract (zod schemas) and observed behaviour.
 *
 * The three keys below are mirrored from web/src/lib/api/client.ts so the
 * seedAccount helper can drop tokens into localStorage before the first nav.
 */

import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

export const TOKEN_KEY = "snapurl.accessToken";
export const REFRESH_KEY = "snapurl.refreshToken";

export const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";
export const REDIRECT_URL = process.env.QA_REDIRECT_URL ?? "http://localhost:3002";

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
  const res = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Journey Tester", email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`registerUser: POST /auth/register → ${res.status}; body=${text.slice(0, 400)}`);
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
