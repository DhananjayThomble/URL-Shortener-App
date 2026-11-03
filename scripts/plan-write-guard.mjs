#!/usr/bin/env node
/*
 * Plan-write guard for #1043.
 *
 * A workspace's plan (the `workspaces.plan` label and the `subscriptions`
 * planKey/interval that back it) is money: a write to it with no payment
 * confirmation hands a paid plan away for free, and a write that races the
 * billing webhook silently undoes a real subscription. Issue #1043 pins the set
 * of code paths allowed to write those columns, so a NEW write site has to be
 * reviewed into the allowlist before it can ship — the same shape as
 * deploy-sync-guard and vercel-build-deps.
 *
 * It scans `apps/api/src` and `apps/worker/src` for every drizzle write that
 * sets `plan`, `planKey` or `interval` (an `.update(...).set({ ... })` or an
 * `.insert(...).values({ ... })` whose object names one of those keys). Every
 * write site it finds must be in the reviewed allowlist (plan-write-allow.json),
 * keyed by file + the function it lives in, with a one-line reason recording WHY
 * the write is safe: a verified-webhook path, a 409-guarded admin path on
 * subscribed workspaces, the pending_plan_key/pending_interval staging pattern,
 * or a test-only seed. A write site not in the allowlist reds the guard; an
 * allowlist entry that no longer matches a real write site also reds it (so the
 * list cannot rot).
 *
 * The decision core `evaluatePlanWrites(sites, allow)` is PURE — it takes the
 * discovered sites and the parsed allowlist and returns the two violation sets —
 * so plan-write-guard.test.mjs drives it with inline fixtures (a planted
 * unlisted write reds; the real allowlist passes) with no filesystem. The
 * scanner `scanSource(text, relFile)` is also pure (text in, sites out).
 *
 * Run by `node --test scripts/plan-write-guard.test.mjs` in verify.yml.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The plan-bearing columns a write site is not allowed to touch unreviewed.
// `plan` is the workspaces.plan label; `planKey`/`interval` are the subscription
// columns of record. `pendingPlanKey`/`pendingInterval` are DELIBERATELY not
// here: the pending_* staging pattern records a REQUEST, not entitlement, and is
// the safe pattern the steering doc prescribes — flagging it would invert the
// rule. A write whose object sets a pending_* key but NOT a guarded key is not a
// plan write.
export const GUARDED_KEYS = ["plan", "planKey", "interval"];

// The plan-bearing tables. A `planKey`/`interval` write to any OTHER table
// (e.g. couponRedemptions, which records which plan a coupon was used against)
// is not a plan-entitlement write and is not this guard's concern. The table is
// read from the `.update(TABLE)` / `.insert(TABLE)` that opens the write chain.
export const GUARDED_TABLES = ["workspaces", "subscriptions"];

/**
 * Find every drizzle plan write in one source file.
 *
 * A write is an `.update(TABLE)` or `.insert(TABLE)` call followed (within the
 * same chain) by a `.set({ ... })` / `.values({ ... })` whose object literal
 * names one of GUARDED_KEYS as a key. We locate each `.set(` / `.values(`, take
 * the balanced `{ ... }` that follows, and test its top-level keys — so a
 * `pendingPlanKey:` write with no `plan`/`planKey`/`interval` key is correctly
 * NOT a plan write, and a `plan:` inside a SELECT projection (no `.set`/`.values`)
 * is never looked at.
 *
 * Returns the sites as { file, fn, key, line } — `fn` is the nearest enclosing
 * `function`/method/arrow name above the write, which is the stable identity the
 * allowlist keys on (line numbers drift; function names do not).
 *
 * @param {string} text  the file's contents
 * @param {string} relFile  the file path, repo-relative, for the site identity
 * @returns {{file:string, fn:string, key:string, line:number}[]}
 */
export function scanSource(text, relFile) {
  const sites = [];
  const callRe = /\.(set|values)\s*\(/g;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    const braceStart = text.indexOf("{", m.index + m[0].length - 1);
    if (braceStart === -1) continue;
    // The call's argument must START with the object literal (allowing only
    // whitespace between `(` and `{`), so `.set(patch)` with a variable is
    // handled separately below, and `.values([...])` arrays are skipped.
    const between = text.slice(m.index + m[0].length - 1, braceStart);
    if (!/^\(\s*$/.test(between)) continue;
    const obj = balancedBraces(text, braceStart);
    if (obj === null) continue;
    const keys = topLevelKeys(obj);
    const hit = GUARDED_KEYS.find((k) => keys.includes(k));
    if (hit && chainTargetsGuardedTable(text, m.index)) {
      sites.push({
        file: relFile,
        fn: enclosingName(text, m.index),
        key: hit,
        line: lineAt(text, m.index),
      });
    }
  }
  // `.set(patch)` / `.values(patch)` where `patch` is a variable built just
  // above with a guarded key assigned to it (e.g. `patch.plan = input.plan`).
  // The #969 admin updateWorkspace builds its patch this way, so the scanner
  // must see it or that write site would be invisible to the guard.
  const varCallRe = /\.(set|values)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = varCallRe.exec(text)) !== null) {
    const varName = m[2];
    // A `<var>.<guardedKey> =` assignment anywhere in the file (the patch is
    // built in the same function as the write in every real case).
    const assignRe = new RegExp(
      `\\b${escapeRe(varName)}\\.(` + GUARDED_KEYS.map(escapeRe).join("|") + `)\\s*=`,
    );
    const am = assignRe.exec(text);
    if (am && chainTargetsGuardedTable(text, m.index)) {
      sites.push({
        file: relFile,
        fn: enclosingName(text, m.index),
        key: am[1],
        line: lineAt(text, m.index),
      });
    }
  }
  // De-dupe sites that both scanners found at the same (fn, key).
  const seen = new Set();
  return sites.filter((s) => {
    const id = `${s.file}::${s.fn}::${s.key}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Whether the drizzle write chain containing the `.set(`/`.values(` at `callPos`
 * targets a guarded table. Scans backward for the nearest `.update(TABLE)` or
 * `.insert(TABLE)` and tests TABLE against GUARDED_TABLES — matching the bare
 * table identifier (`workspaces`) and a qualified one (`schema.subscriptions`).
 * A chain with no update/insert before the call (a plain object build that
 * happens to use `.set`/`.values` on something else) is NOT a guarded write.
 */
function chainTargetsGuardedTable(text, callPos) {
  // Look back a bounded window — a drizzle chain's update/insert is always a few
  // hundred chars before its set/values, never the whole file.
  const windowStart = Math.max(0, callPos - 2000);
  const head = text.slice(windowStart, callPos);
  const re = /\.(update|insert)\s*\(\s*([A-Za-z_$][\w$.]*)\s*\)/g;
  let last = null;
  let mm;
  while ((mm = re.exec(head)) !== null) last = mm[2];
  if (!last) return false;
  const bare = last.split(".").pop();
  return GUARDED_TABLES.includes(bare);
}

/** The balanced `{ ... }` beginning at `open` (index of the `{`), or null. */
function balancedBraces(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** Top-level `key:` identifiers of an object-literal string (depth 1 only, so a
 *  nested object's keys don't leak in). Shorthand (`plan,`) counts too. */
function topLevelKeys(objText) {
  const inner = objText.slice(1, -1);
  const keys = [];
  let depth = 0;
  // Walk and collect identifiers that sit at depth 0 immediately before a `:`
  // or a `,`/end (shorthand). A light scan is enough for drizzle's flat set
  // objects; it does not need to be a full JS parser.
  const tokenRe = /([{}[\]()])|([A-Za-z_$][\w$]*)\s*(:)?/g;
  let t;
  while ((t = tokenRe.exec(inner)) !== null) {
    if (t[1]) {
      if (t[1] === "{" || t[1] === "[" || t[1] === "(") depth++;
      else depth--;
      continue;
    }
    if (depth === 0 && t[2]) {
      // An identifier at depth 0: a key if a `:` follows (or shorthand). Guard
      // against matching a value identifier by requiring it be preceded by a
      // `{`, `,` or the start.
      const before = inner.slice(0, t.index).trimEnd();
      const lastCh = before.slice(-1);
      if (lastCh === "" || lastCh === "{" || lastCh === "," ) {
        keys.push(t[2]);
      }
    }
  }
  return keys;
}

/** The nearest function / method / named-arrow above `pos`. Best-effort — it is
 *  the allowlist key, so it must be stable, not perfectly precise. */
function enclosingName(text, pos) {
  // Strip line and block comments before matching declarations, so prose like
  // `idempotently on (provider id):` in a comment is never mistaken for a method
  // named `on`. Replace comment bodies with spaces to preserve byte offsets.
  const head = stripComments(text.slice(0, pos));
  // Scan upward for the closest of several declaration shapes.
  // Each pattern yields a candidate declaration name AND its match index. A
  // leading `(?<![.\w])` rejects method-call fragments like `.on(` / `.set(` and
  // `transaction(` inside a chain — those are calls, not the enclosing
  // declaration — so the name resolves to the real function/method the write
  // lives in.
  const patterns = [
    /(?<![.\w])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g, // function foo(
    /(?<![.\w])(?:public |private |protected |static |async |readonly )*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^={]+)?\{/g, // class method foo(...) {  / foo(...): T {
    /(?<![.\w])(?:const |let |var )?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, // const foo = ( / foo = async (
    /(?<![.\w])([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g, // foo: (...) =>
  ];
  // Control-flow keywords read as `name(...) {` — they are never the function.
  const KEYWORDS = new Set([
    "if", "for", "while", "switch", "catch", "return", "await", "else",
    "do", "with", "function", "async", "typeof", "new", "throw",
  ]);
  // Collect every candidate declaration with its position, then keep only those
  // whose body is still OPEN at `pos` — i.e. the `{` after the declaration has
  // not been balanced shut before `pos`. A nested arrow/function declared and
  // closed earlier in the same parent is therefore skipped, so the write is
  // attributed to its real enclosing function, not a sibling helper above it.
  const candidates = [];
  for (const re of patterns) {
    let mm;
    while ((mm = re.exec(head)) !== null) {
      if (KEYWORDS.has(mm[1])) continue;
      candidates.push({ idx: mm.index, name: mm[1] });
    }
  }
  candidates.sort((a, b) => b.idx - a.idx); // nearest first
  for (const cand of candidates) {
    // The declaration's body opens at the first `{` at/after its match. If that
    // brace is still unbalanced at `pos` (depth > 0 across head[open..end]), the
    // write is inside this declaration.
    const open = head.indexOf("{", cand.idx);
    if (open === -1) continue;
    let depth = 0;
    let stillOpen = true;
    for (let i = open; i < head.length; i++) {
      if (head[i] === "{") depth++;
      else if (head[i] === "}") {
        depth--;
        if (depth === 0) { stillOpen = false; break; } // body closed before pos
      }
    }
    if (stillOpen && depth > 0) return cand.name;
  }
  return "(top-level)";
}

function lineAt(text, pos) {
  return text.slice(0, pos).split("\n").length;
}

/** Replace `//...` and block-comment bodies with spaces (newlines kept), so a
 *  declaration scan never matches prose inside a comment. Offsets are preserved
 *  so a stripped `head` still aligns with the original up to `pos`. */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      if (i < n) { out += "  "; i += 2; }
    } else {
      out += c; i++;
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PURE decision core: compare discovered write sites against the reviewed
 * allowlist.
 *
 * An allowlist entry is { file, fn, reason } (key optional — an entry covers
 * every guarded key written in that fn of that file). A site is allowed when
 * some entry matches its file AND fn. Returns:
 *  - `unlisted`: sites with no matching allowlist entry (a NEW, unreviewed plan
 *    write — reds the guard).
 *  - `stale`: allowlist entries that match no discovered site (the write moved
 *    or went away — the list must be pruned, also reds the guard).
 *
 * Both empty => the guard passes.
 *
 * @param {{file:string, fn:string, key:string, line:number}[]} sites
 * @param {{file:string, fn:string, reason:string}[]} allow
 * @returns {{unlisted: object[], stale: object[]}}
 */
export function evaluatePlanWrites(sites, allow) {
  const matches = (site, entry) => site.file === entry.file && site.fn === entry.fn;
  const unlisted = sites.filter((s) => !allow.some((e) => matches(s, e)));
  const stale = allow.filter((e) => !sites.some((s) => matches(s, e)));
  return { unlisted, stale };
}

// ─── CLI / test entry: scan the real tree and the committed allowlist. ───────

/** Recursively list every .ts file under `dir` that is not a test file. */
export function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === "dist") continue;
        walk(full);
      } else if (
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        !name.endsWith(".spec.ts") &&
        !name.endsWith(".integration.test.ts")
      ) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/** Scan the repo's api+worker source for plan write sites. Pure of the
 *  allowlist — just the discovery half — so the test can assert the real set. */
export function scanRepo(repoRoot) {
  const roots = [join(repoRoot, "apps/api/src"), join(repoRoot, "apps/worker/src")];
  const sites = [];
  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      const rel = relative(repoRoot, file).split("\\").join("/");
      sites.push(...scanSource(readFileSync(file, "utf8"), rel));
    }
  }
  return sites.sort((a, b) => (a.file + a.fn).localeCompare(b.file + b.fn));
}

export function loadAllowlist(repoRoot) {
  const raw = readFileSync(join(repoRoot, "scripts/plan-write-allow.json"), "utf8");
  return JSON.parse(raw).sites;
}
