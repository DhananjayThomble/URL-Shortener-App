#!/usr/bin/env node
/*
 * Migration-chain guard for #1043.
 *
 * Drizzle migrations are a linear, append-only chain: packages/database/drizzle
 * holds `NNNN_tag.sql` up-files and a meta/_journal.json that records their
 * order. A rebase that renumbers a migration, a missing file, or a reverted
 * migration with no `.down.sql` all corrupt the chain in ways that only surface
 * when someone tries to migrate or roll back — long after the PR merged. This
 * guard pins the chain's structure so a broken chain reds a PR here.
 *
 * It checks two properties, offline, with no database:
 *  1. LINEAR JOURNAL — the journal's entries are idx 0,1,2,… with no gap or
 *     repeat, each entry's `tag` has a matching `<tag>.sql` up-file, and every
 *     `<tag>.sql` up-file on disk has a journal entry. (Order is the journal's
 *     order; the numeric prefixes must ascend with it.)
 *  2. DOWN-FILE PARITY — every up-file from the down-file convention onward has
 *     a sibling `<tag>.down.sql`. The convention began at migration 0022
 *     (DOWN_CONVENTION_FROM): migrations 0000–0021 predate it and are
 *     grandfathered, so the guard never reds on them, but a NEW up-file with no
 *     down-file reds.
 *
 * drizzle-kit's own consistency (no schema drift / pending diff) is checked
 * separately by `drizzle-kit check` in the same CI step — this guard adds the
 * two structural properties that `check` does not assert and that a pure
 * parse-and-assert test can hold and red-prove with no toolchain.
 *
 * The decision core `evaluateMigrationChain({ journal, upFiles, downFiles })` is
 * PURE — it takes the parsed journal and the two filename lists — so
 * migration-chain-guard.test.mjs drives it with inline fixtures (a gap, a
 * missing file, a missing down-file all red) and then over the REAL directory.
 *
 * Run by `node --test scripts/migration-chain-guard.test.mjs` in verify.yml.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// The migration number from which a `.down.sql` is required. 0000–0021 predate
// the down-file convention and are grandfathered; 0022 (admin_audit_log) was
// the first to ship one. A new up-file (a higher number) must have a down-file.
export const DOWN_CONVENTION_FROM = 22;

export const DRIZZLE_DIR = "packages/database/drizzle";

/**
 * PURE decision core. Returns a list of problem strings; empty => the chain is
 * sound. Each string is a single, human-legible defect so the test (and CI)
 * name exactly what broke.
 *
 * @param {object} args
 * @param {{idx:number, tag:string}[]} args.journal  parsed _journal.json entries, in file order
 * @param {string[]} args.upFiles    `NNNN_tag.sql` names (no `.down.sql`), any order
 * @param {string[]} args.downFiles  `NNNN_tag.down.sql` names, any order
 * @returns {string[]}  defects (empty = pass)
 */
export function evaluateMigrationChain({ journal, upFiles, downFiles }) {
  const problems = [];
  const upTags = new Set(upFiles.map(tagOf));
  const downTags = new Set(downFiles.map((f) => tagOf(f.replace(/\.down\.sql$/, ".sql"))));

  // 1a. The journal idx sequence is 0,1,2,… with no gap or repeat.
  for (let i = 0; i < journal.length; i++) {
    if (journal[i].idx !== i) {
      problems.push(
        `journal idx out of sequence at position ${i}: expected idx ${i}, got ${journal[i].idx} (tag ${journal[i].tag}) — the chain is not linear (a gap, repeat or renumber).`,
      );
    }
  }

  // 1b. The numeric prefixes ascend with journal order (a rebase that reorders
  //     tags without renumbering is caught here even if idx stayed 0..n).
  let prevNum = -1;
  for (const entry of journal) {
    const num = numOf(entry.tag);
    if (num === null) {
      problems.push(`journal tag '${entry.tag}' has no NNNN numeric prefix.`);
      continue;
    }
    if (num <= prevNum) {
      problems.push(
        `journal tag '${entry.tag}' (${num}) does not ascend past the previous entry (${prevNum}) — entries are out of order.`,
      );
    }
    prevNum = num;
  }

  // 1c. Every journal entry has a matching up-file.
  for (const entry of journal) {
    if (!upTags.has(entry.tag)) {
      problems.push(`journal entry '${entry.tag}' has no matching ${entry.tag}.sql up-file.`);
    }
  }

  // 1d. Every up-file on disk has a journal entry (no orphan migration file).
  const journalTags = new Set(journal.map((e) => e.tag));
  for (const tag of upTags) {
    if (!journalTags.has(tag)) {
      problems.push(`migration file '${tag}.sql' is on disk but not in _journal.json — regenerate the journal or remove the file.`);
    }
  }

  // 2. Down-file parity from the convention start.
  for (const tag of [...upTags].sort()) {
    const num = numOf(tag);
    if (num === null || num < DOWN_CONVENTION_FROM) continue; // grandfathered
    if (!downTags.has(tag)) {
      problems.push(
        `migration '${tag}.sql' has no '${tag}.down.sql'. Every migration from ${pad(DOWN_CONVENTION_FROM)} on must ship a down-file for rollback.`,
      );
    }
  }

  return problems;
}

/** `0022_admin_audit_log.sql` -> `0022_admin_audit_log`. */
function tagOf(fileName) {
  return fileName.replace(/\.sql$/, "");
}

/** The leading NNNN number of a tag, or null. */
function numOf(tag) {
  const m = /^(\d{4})_/.exec(tag);
  return m ? Number(m[1]) : null;
}

function pad(n) {
  return String(n).padStart(4, "0");
}

// ─── CLI / test entry: read the real drizzle directory. ──────────────────────

/** Read and parse the real journal + the up/down file lists under repoRoot. */
export function readChain(repoRoot) {
  const dir = join(repoRoot, DRIZZLE_DIR);
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")).entries.map(
    (e) => ({ idx: e.idx, tag: e.tag }),
  );
  const all = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const downFiles = all.filter((f) => f.endsWith(".down.sql"));
  const upFiles = all.filter((f) => !f.endsWith(".down.sql"));
  return { journal, upFiles, downFiles };
}
