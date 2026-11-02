#!/usr/bin/env node
/**
 * Auth-volume guard for the real-stack journey suite (#977).
 *
 * WHY. /auth/register and /auth/login are throttled 5/min per IP (security
 * limits, not tunable). A journeys CI shard runs every spec in one worker on
 * ONE runner IP, so every spec's registers and UI logins share those buckets.
 * The suite was made green by cutting that volume at the source (#977 Option A):
 * a spec whose SUBJECT is not the auth UI establishes its session with
 * signInViaSeed()/seedAccount() (a localStorage seed of tokens the API already
 * issued — zero login calls) instead of driving the /login form, and registers
 * only the accounts it truly needs. Without a guard that volume creeps back the
 * next time someone copies an old signIn() helper into a new spec, and a later
 * shard reds again.
 *
 * WHAT THIS CHECKS. Every e2e/journeys/*.spec.ts, except an explicit allow-list
 * of specs that legitimately TEST the auth UI, must NOT drive a UI login — i.e.
 * must not click a "Sign in" button on /login, nor fill the login form. A spec
 * that needs an authenticated session uses signInViaSeed()/seedAccount().
 *
 * It is deliberately a cheap text check (no TS parse): it looks for the login
 * form's own locators. If a legitimately-new auth-UI spec is added, add it to
 * AUTH_UI_SPECS below (and say why) — that edit is the reviewable signal.
 *
 * Exit 0 = clean. Exit 1 = a non-auth spec drives a UI login (prints which).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const JOURNEYS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "journeys");

/* Specs whose SUBJECT is the login / register / 2FA UI, or an auth-navigation
 * behaviour that can only be exercised through the real form. These MAY drive a
 * UI login. Keep this list short and justified; every entry is a spec that
 * asserts on the auth UI itself. */
const AUTH_UI_SPECS = new Set([
  "j01-signup-first-link.spec.ts", // registers + signs in through the real forms (the signup journey)
  "j10-2fa.spec.ts", // 2FA login challenge via the form
  "j15-team-invite-accept.spec.ts", // accept-invite flow signs in / registers through the UI
  "j17-workspace-coherence.spec.ts", // (x) asserts a real sign-out + UI sign-in moves other tabs
  "j26-login-next.spec.ts", // the ?next= behaviour IS the login redirect under test
  "j776-2fa-recovery-code.spec.ts", // recovery-code 2FA login via the form
  "j777-signed-in-marketing.spec.ts", // signed-in/out header + /login,/register redirects under test
  "j778-login-enter-after-failure.spec.ts", // Enter-after-failed-login is the subject
  "j794-legal-register.spec.ts", // the register form + inline validation is the subject
]);

/* The login form's own locators — present only when a spec drives a UI login.
 * (seedAccount/signInViaSeed touch neither the /login nav nor these controls.) */
const LOGIN_NAV = /\.goto\(\s*["'`]\/login/;
const LOGIN_SUBMIT = /getByRole\(\s*["']button["']\s*,\s*\{\s*name:\s*(\/\^?sign in|["']Sign in)/i;
const LOGIN_FIELD = /getByPlaceholder\(\s*["']you@company\.com["']\)/;

const offenders = [];
for (const file of readdirSync(JOURNEYS_DIR).filter((f) => f.endsWith(".spec.ts")).sort()) {
  if (AUTH_UI_SPECS.has(file)) continue;
  const src = readFileSync(join(JOURNEYS_DIR, file), "utf8");
  const drivesLogin = LOGIN_NAV.test(src) && (LOGIN_SUBMIT.test(src) || LOGIN_FIELD.test(src));
  if (drivesLogin) offenders.push(file);
}

if (offenders.length > 0) {
  console.error("Auth-volume guard (#977): these journey specs drive a UI /auth/login but are not");
  console.error("on the auth-UI allow-list. A UI login spends the 5/min-per-IP login bucket and, across");
  console.error("a shard, reds the real-stack lane. Use signInViaSeed()/seedAccount() to establish the");
  console.error("session instead (zero login calls), OR — if this spec genuinely tests the auth UI — add");
  console.error("it to AUTH_UI_SPECS in e2e/scripts/check-auth-volume.mjs with a one-line reason.\n");
  for (const f of offenders) console.error(`  - journeys/${f}`);
  process.exit(1);
}

console.log(`Auth-volume guard: OK (${AUTH_UI_SPECS.size} auth-UI specs allow-listed; no stray UI logins).`);
