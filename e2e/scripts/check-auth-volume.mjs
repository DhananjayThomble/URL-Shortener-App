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

/* Specs that legitimately call the THROTTLED /auth/register route (registerUser/
 * registerPaidOwner) because registering — or a password sign-in that needs a
 * real password account — is their subject. Every AUTH_UI_SPEC qualifies (they
 * drive the register/login forms), plus j792 whose subject is the register
 * endpoint's validation copy. Everything else must get its account from
 * seedUser()/seedPaidOwner() (DB insert + the UNTHROTTLED /auth/refresh), so the
 * 5/min-per-IP /auth/register bucket is not spent ~150 times a shard (#977). */
const REGISTER_OK_SPECS = new Set([
  ...AUTH_UI_SPECS,
  "j792-validation-copy.spec.ts", // asserts /auth/register's validation copy (the register endpoint IS the subject)
]);

/* The login form's own locators — present only when a spec drives a UI login.
 * (seedAccount/signInViaSeed touch neither the /login nav nor these controls.) */
const LOGIN_NAV = /\.goto\(\s*["'`]\/login/;
const LOGIN_SUBMIT = /getByRole\(\s*["']button["']\s*,\s*\{\s*name:\s*(\/\^?sign in|["']Sign in)/i;
const LOGIN_FIELD = /getByPlaceholder\(\s*["']you@company\.com["']\)/;

/* A call to the throttled /auth/register helpers. seedUser()/seedPaidOwner()
 * match neither (word boundary keeps registerUser from matching seedUser). */
const REGISTER_CALL = /\b(registerUser|registerPaidOwner)\s*\(/;

const loginOffenders = [];
const registerOffenders = [];
for (const file of readdirSync(JOURNEYS_DIR).filter((f) => f.endsWith(".spec.ts")).sort()) {
  const src = readFileSync(join(JOURNEYS_DIR, file), "utf8");
  if (!AUTH_UI_SPECS.has(file)) {
    const drivesLogin = LOGIN_NAV.test(src) && (LOGIN_SUBMIT.test(src) || LOGIN_FIELD.test(src));
    if (drivesLogin) loginOffenders.push(file);
  }
  if (!REGISTER_OK_SPECS.has(file) && REGISTER_CALL.test(src)) registerOffenders.push(file);
}

let failed = false;
if (loginOffenders.length > 0) {
  failed = true;
  console.error("Auth-volume guard (#977): these journey specs drive a UI /auth/login but are not");
  console.error("on the auth-UI allow-list. A UI login spends the 5/min-per-IP login bucket and, across");
  console.error("a shard, reds the real-stack lane. Use signInViaSeed()/seedAccount() to establish the");
  console.error("session instead (zero login calls), OR — if this spec genuinely tests the auth UI — add");
  console.error("it to AUTH_UI_SPECS in e2e/scripts/check-auth-volume.mjs with a one-line reason.\n");
  for (const f of loginOffenders) console.error(`  - journeys/${f}`);
  console.error("");
}
if (registerOffenders.length > 0) {
  failed = true;
  console.error("Auth-volume guard (#977): these journey specs call registerUser()/registerPaidOwner()");
  console.error("(the THROTTLED 5/min-per-IP /auth/register route) but are not on the register allow-list.");
  console.error("Across a shard the suite's register volume overruns that bucket no matter how it is paced,");
  console.error("which is what reds j1/j2/j3. Use seedUser()/seedPaidOwner() (DB insert + the unthrottled");
  console.error("/auth/refresh) to get the account instead, OR — if registering IS this spec's subject — add");
  console.error("it to REGISTER_OK_SPECS in e2e/scripts/check-auth-volume.mjs with a one-line reason.\n");
  for (const f of registerOffenders) console.error(`  - journeys/${f}`);
  console.error("");
}
if (failed) process.exit(1);

console.log(
  `Auth-volume guard: OK (${AUTH_UI_SPECS.size} auth-UI specs may UI-login; ` +
    `${REGISTER_OK_SPECS.size} may call /auth/register; no stray UI logins or register calls).`,
);
