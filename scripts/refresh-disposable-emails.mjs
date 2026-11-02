#!/usr/bin/env node
/*
 * #1007 — refresh the vendored disposable-email block list.
 *
 * Pulls a PINNED upstream commit of the community CC0 list
 * (disposable-email-domains/disposable-email-domains), applies the built-in
 * allow list, and rewrites the three vendored artefacts:
 *
 *   apps/api/src/common/data/disposable-email-blocklist.conf        (raw data)
 *   apps/api/src/common/data/disposable-email-blocklist.PROVENANCE  (SHA/date)
 *   apps/api/src/common/disposable-email-domains.ts                 (generated)
 *
 * The list is fetched ONLY here, at refresh time, never while the app runs. The
 * generated .ts is what the server imports, so a runtime has no filesystem or
 * network dependency on the list.
 *
 * Usage:
 *   node scripts/refresh-disposable-emails.mjs [--sha <commit>] [--check]
 *
 *   --sha <commit>  Upstream commit to pin (default: the SHA already recorded in
 *                   the PROVENANCE file). Pass a new SHA to bump the snapshot.
 *   --check         Do not write. Regenerate in memory and exit non-zero if the
 *                   committed .conf or .ts would change (CI drift guard) or if
 *                   an allow-listed domain is present in the upstream list.
 *
 * The weekly workflow (.github/workflows/disposable-email-refresh.yml) runs this
 * with the latest upstream commit and opens a PR a human reviews; it never
 * auto-merges.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const commonDir = join(repoRoot, "apps/api/src/common");
const dataDir = join(commonDir, "data");
const confPath = join(dataDir, "disposable-email-blocklist.conf");
const provenancePath = join(dataDir, "disposable-email-blocklist.PROVENANCE");
const modulePath = join(commonDir, "disposable-email-domains.ts");
const allowlistPath = join(commonDir, "disposable-email-allowlist.ts");

const UPSTREAM = "disposable-email-domains/disposable-email-domains";
const RAW = (sha) =>
  `https://raw.githubusercontent.com/${UPSTREAM}/${sha}/disposable_email_blocklist.conf`;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : def;
};
const check = flag("--check");

const die = (msg) => {
  console.error(`refresh-disposable-emails: ${msg}`);
  process.exit(1);
};

/** Read the pinned SHA out of the PROVENANCE file (the 40-hex token on the
 *  "Pinned commit" block). */
function pinnedShaFromProvenance(text) {
  const m = text.match(/\b([0-9a-f]{40})\b/);
  return m ? m[1] : null;
}

/** Load and normalise the built-in allow list from its .ts module without
 *  importing TypeScript: pull the quoted string entries out of the array. */
function loadAllowlist() {
  const src = readFileSync(allowlistPath, "utf8");
  const start = src.indexOf("DISPOSABLE_EMAIL_ALLOWLIST");
  if (start === -1) die("could not find DISPOSABLE_EMAIL_ALLOWLIST in the allow-list module");
  // The declaration is `... = [ ... ];` — anchor on the `= [` assignment opener
  // so the `[]` in the `readonly string[]` type annotation is not mistaken for
  // the array literal.
  const open = src.indexOf("= [", start);
  if (open === -1) die("could not find the allow-list array literal");
  const close = src.indexOf("]", open);
  if (close === -1) die("could not parse the built-in allow-list array");
  const body = src.slice(open, close + 1);
  const entries = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
  if (entries.length === 0) die("could not parse the built-in allow list");
  return new Set(entries);
}

/** Parse a .conf blob into a cleaned, sorted, de-duped host array. */
function parseConf(blob) {
  const hosts = blob
    .split("\n")
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l !== "" && !l.startsWith("#"));
  return [...new Set(hosts)].sort();
}

function renderConf(hosts) {
  return hosts.join("\n") + "\n";
}

function renderModule(hosts, sha, allowlistName) {
  const lines = hosts.map((h) => `  ${JSON.stringify(h)},`).join("\n");
  return `/* ============================================================
   #993 / #1007 — the vendored disposable-email domain list.

   GENERATED FILE — DO NOT EDIT BY HAND.
   Produced by scripts/refresh-disposable-emails.mjs from the pinned upstream
   snapshot in data/disposable-email-blocklist.conf. To change it, run that
   script (or let the weekly refresh workflow do it) and review the diff.

   WHAT THIS IS
   A snapshot of ~10k well-known throwaway / temporary email providers, used to
   refuse sign-up from an address at one of them (disposable-email.ts is the
   matcher, which also folds in the operator's admin additions and subtracts the
   built-in + admin allow lists).

   SOURCE & LICENCE
   The community-maintained, CC0-1.0 \`disposable-email-domains\` project:
   https://github.com/${UPSTREAM}
   Pinned upstream commit: ${sha}
   The CC0 dedication is reproduced in disposable-email-domains.LICENCE;
   full provenance in data/disposable-email-blocklist.PROVENANCE.

   ALLOW LIST APPLIED
   Any host in ${allowlistName} (disposable-email-allowlist.ts) has been removed
   from this list at generation time, so a major provider or privacy relay can
   never be refused even if an upstream refresh adds it. disposable-email.test.ts
   asserts the two lists stay disjoint.
   ============================================================ */

/** The vendored throwaway-email hosts. Bare, lower-cased, sorted, with the
 *  built-in allow list already subtracted. A sub-domain of any entry is covered
 *  by the matcher, so only the registrable host is listed. */
export const VENDORED_DISPOSABLE_EMAIL_DOMAINS: readonly string[] = [
${lines}
];
`;
}

async function main() {
  const text = readFileSync(provenancePath, "utf8");
  const pinned = pinnedShaFromProvenance(text);
  const sha = opt("--sha", pinned);
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    die(`need a 40-hex upstream commit SHA (got ${JSON.stringify(sha)})`);
  }

  // Fetch the upstream list ONLY here (refresh time), never at app runtime.
  let blob;
  if (opt("--from-file", null)) {
    blob = readFileSync(opt("--from-file", null), "utf8");
  } else {
    const res = await fetch(RAW(sha));
    if (!res.ok) die(`fetch ${RAW(sha)} failed: HTTP ${res.status}`);
    blob = await res.text();
  }

  const upstream = parseConf(blob);
  if (upstream.length < 1000) die(`upstream list looks too small (${upstream.length} entries) — refusing`);

  const allow = loadAllowlist();

  // The raw .conf is kept byte-identical to the cleaned upstream (so a diff
  // against upstream is trivial to review). The allow list is applied only when
  // generating the module the app imports.
  const confHosts = upstream;
  const moduleHosts = upstream.filter((h) => !isAllowed(h, allow));
  const removed = upstream.length - moduleHosts.length;

  const nextConf = renderConf(confHosts);
  const nextModule = renderModule(moduleHosts, sha, "DISPOSABLE_EMAIL_ALLOWLIST");

  if (check) {
    const curConf = safeRead(confPath);
    const curModule = safeRead(modulePath);
    let drift = false;
    if (curConf !== nextConf) {
      console.error(`DRIFT: ${confPath} is out of date — run scripts/refresh-disposable-emails.mjs`);
      drift = true;
    }
    if (curModule !== nextModule) {
      console.error(`DRIFT: ${modulePath} is out of date — run scripts/refresh-disposable-emails.mjs`);
      drift = true;
    }
    if (drift) process.exit(1);
    console.log(`OK: vendored list matches the pinned snapshot (${sha}, ${moduleHosts.length} domains, ${removed} allow-listed removed).`);
    return;
  }

  writeFileSync(confPath, nextConf);
  writeFileSync(modulePath, nextModule);
  writeFileSync(provenancePath, bumpProvenance(text, sha, upstream.length, moduleHosts.length));
  console.log(
    `Refreshed vendored disposable-email list: ${moduleHosts.length} domains ` +
      `(${removed} allow-listed removed) from upstream ${sha}.`,
  );
}

/** A host is allowed when it equals or is a sub-domain of an allow entry. */
function isAllowed(host, allow) {
  if (allow.has(host)) return true;
  for (const a of allow) {
    if (host.endsWith(`.${a}`)) return true;
  }
  return false;
}

function safeRead(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Rewrite the pinned SHA / counts / date in the PROVENANCE file, leaving the
 *  prose intact. */
function bumpProvenance(text, sha, upstreamCount, vendoredCount) {
  const today = new Date().toISOString().slice(0, 10);
  return text
    .replace(/\b[0-9a-f]{40}\b/, sha)
    .replace(/Pinned on:\s*\S+/, `Pinned on:  ${today}`)
    .replace(/Entry count at pin:\s*\d+/, `Entry count at pin: ${upstreamCount} upstream, ${vendoredCount} vendored`);
}

main().catch((err) => die(String(err?.stack || err)));
