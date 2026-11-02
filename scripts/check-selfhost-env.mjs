#!/usr/bin/env node
/*
 * #998 — self-host guide / .env.example consistency check.
 *
 * The acceptance for #998: "every env var the guide mentions exists in
 * .env.example." This script enforces it. It scans SELF-HOSTING.md for env-var
 * tokens and fails if any is neither:
 *   - a key in deploy/single-node/.env.example (the single-node self-host
 *     config contract), present or commented-out; nor
 *   - in the small, explicit EXCEPTIONS set below — vars the guide mentions
 *     that are deliberately NOT .env config keys (backup/restore script
 *     overrides, or the DATABASE_URL alternative to the compose path).
 *
 * Run by `pnpm check:selfhost-env` and in CI (verify.yml). The decision core
 * `findMissingEnvVars` is PURE (takes the two file contents as strings) so
 * check-selfhost-env.test.mjs can drive it with no filesystem.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* Vars the guide names on purpose that are NOT single-node .env keys. Each is
 * here with the reason it is an exception, so the list cannot grow silently. */
export const EXCEPTIONS = new Map([
  ["DATABASE_URL", "an ALTERNATIVE to the compose path ('if instead you set DATABASE_URL ...'), not a key you set in the single-node .env"],
  ["BACKUP_DIR", "an env override read only by backup.sh, not app config"],
  ["PG_DUMP", "an env override read only by backup.sh (point it at a version-matched client)"],
  ["PSQL", "an env override read only by restore.sh"],
]);

/** Env-var keys defined in a .env.example — a key line, optionally commented
 *  out (an "optional/advanced" entry shown as `# VAR=...`). */
export function envExampleKeys(envExample) {
  return new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

/** Env-var tokens a guide mentions: UPPER_SNAKE with at least one underscore,
 *  so prose words (TLS, DNS, ACME) are not mistaken for variables. */
export function mentionedEnvVars(guide) {
  return new Set([...guide.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)].map((m) => m[1]));
}

/** The pure core: which mentioned vars are neither a .env.example key nor a
 *  documented exception. Returns a sorted array (empty = consistent). */
export function findMissingEnvVars(guide, envExample, exceptions = EXCEPTIONS) {
  const keys = envExampleKeys(envExample);
  const missing = [];
  for (const v of mentionedEnvVars(guide)) {
    if (keys.has(v) || exceptions.has(v)) continue;
    missing.push(v);
  }
  return missing.sort();
}

/* ── CLI ── (skipped when imported by the test) */
function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const guide = readFileSync(join(repoRoot, "SELF-HOSTING.md"), "utf8");
  const envExample = readFileSync(join(repoRoot, "deploy/single-node/.env.example"), "utf8");

  const missing = findMissingEnvVars(guide, envExample);
  if (missing.length > 0) {
    console.error("These env vars are named in SELF-HOSTING.md but are not keys in");
    console.error("deploy/single-node/.env.example (add them there, or add them to the");
    console.error("documented EXCEPTIONS set in this script if they are not .env config):");
    for (const v of missing) console.error(`  - ${v}`);
    console.error(`FAIL check-selfhost-env: ${missing.length} guide env var(s) missing from .env.example`);
    process.exit(1);
  }

  const mentioned = mentionedEnvVars(guide);
  const keys = envExampleKeys(envExample);
  for (const v of EXCEPTIONS.keys()) {
    if (!mentioned.has(v)) {
      console.warn(`note: EXCEPTIONS lists ${v}, but SELF-HOSTING.md no longer mentions it — consider removing it.`);
    }
  }
  console.log(
    `PASS check-selfhost-env: all ${mentioned.size} env var(s) named in SELF-HOSTING.md are ` +
      `accounted for (${keys.size} keys in .env.example, ${EXCEPTIONS.size} documented exceptions).`,
  );
}
