// #1043 — regression test for the migration-chain guard. Drizzle migrations are
// a linear append-only chain; a gap, a renumber, an orphan file or a missing
// down-file corrupts it in ways only a migrate/rollback surfaces. Run by
// `node --test`.
//
// The decision core (evaluateMigrationChain) is PURE, so the first cases drive
// it inline: a sound chain passes, and a gap, a reorder, a missing up-file, an
// orphan file and a missing down-file each red. The last case reads the REAL
// packages/database/drizzle directory, so a future rebase that corrupts the
// chain reds this test too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  evaluateMigrationChain,
  readChain,
  DOWN_CONVENTION_FROM,
} from "./migration-chain-guard.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// A minimal sound chain. The journal idx is a sequential position counter
// (0,1,2,…), and here it happens to equal the migration number because the
// chain has no holes. Three entries: two grandfathered (pre-0022, no down-file
// needed) and the convention-start 0022 with its down-file.
const SOUND = {
  journal: [
    { idx: 0, tag: "0020_link_counters_reserved" },
    { idx: 1, tag: "0021_link_delete_outbox_guard" },
    { idx: 2, tag: "0022_admin_audit_log" },
  ],
  upFiles: [
    "0020_link_counters_reserved.sql",
    "0021_link_delete_outbox_guard.sql",
    "0022_admin_audit_log.sql",
  ],
  downFiles: ["0022_admin_audit_log.down.sql"],
};

test("a sound chain has no problems", () => {
  assert.deepEqual(evaluateMigrationChain(SOUND), []);
});

test("a journal idx gap reds", () => {
  const broken = { ...SOUND, journal: [
    { idx: 0, tag: "0020_link_counters_reserved" },
    { idx: 2, tag: "0021_link_delete_outbox_guard" }, // idx jumps 0 -> 2
    { idx: 3, tag: "0022_admin_audit_log" },
  ] };
  const problems = evaluateMigrationChain(broken);
  assert.ok(problems.some((p) => p.includes("out of sequence")), problems.join("\n"));
});

test("a reordered (non-ascending) tag reds", () => {
  const broken = {
    journal: [
      { idx: 0, tag: "0002_rollup_marker" }, // 0002 before 0001
      { idx: 1, tag: "0001_system_domains" },
    ],
    upFiles: ["0001_system_domains.sql", "0002_rollup_marker.sql"],
    downFiles: [],
  };
  const problems = evaluateMigrationChain(broken);
  assert.ok(problems.some((p) => p.includes("does not ascend")), problems.join("\n"));
});

test("a journal entry with no up-file reds", () => {
  const broken = { ...SOUND, upFiles: SOUND.upFiles.filter((f) => !f.startsWith("0022")) };
  const problems = evaluateMigrationChain(broken);
  assert.ok(problems.some((p) => p.includes("no matching 0022_admin_audit_log.sql")), problems.join("\n"));
});

test("an orphan up-file not in the journal reds", () => {
  const broken = { ...SOUND, upFiles: [...SOUND.upFiles, "0099_rogue.sql"] };
  const problems = evaluateMigrationChain(broken);
  assert.ok(problems.some((p) => p.includes("0099_rogue.sql") && p.includes("not in _journal.json")), problems.join("\n"));
});

test("a post-convention migration with no down-file reds; a grandfathered one does not", () => {
  // Add a post-convention up-file (0023) with NO down-file -> reds. idx stays
  // sequential (the next position after 0022 is 3).
  const broken = {
    journal: [...SOUND.journal, { idx: 3, tag: "0023_user_suspended_at" }],
    upFiles: [...SOUND.upFiles, "0023_user_suspended_at.sql"],
    downFiles: SOUND.downFiles, // no 0023 down-file
  };
  const problems = evaluateMigrationChain(broken);
  assert.ok(
    problems.some((p) => p.includes("0023_user_suspended_at.sql") && p.includes("down.sql")),
    problems.join("\n"),
  );
  // Removing the 0022 down-file is grandfathered? No — 0022 IS the convention
  // start, so it must have a down-file. But a pre-convention file (0001) never
  // needs one: assert the sound chain (0000/0001 with no down) already passed.
  assert.ok(DOWN_CONVENTION_FROM === 22);
});

test("the REAL drizzle chain under packages/database is sound", () => {
  const chain = readChain(repoRoot);
  const problems = evaluateMigrationChain(chain);
  assert.deepEqual(
    problems,
    [],
    "The committed drizzle migration chain is broken:\n" + problems.join("\n"),
  );
  // Guard against a vacuous pass if readChain ever returns nothing.
  assert.ok(chain.journal.length >= 30, `expected a populated journal, got ${chain.journal.length} entries`);
  assert.ok(chain.upFiles.length === chain.journal.length,
    `up-file count (${chain.upFiles.length}) must equal journal length (${chain.journal.length})`);
});
