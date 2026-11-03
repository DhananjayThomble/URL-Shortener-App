# SnapURL — Drizzle migrations (steering)

Migrations are a linear, append-only chain in `packages/database/drizzle` with a
`meta/_journal.json` that records their order. The migration-chain guard
(`scripts/migration-chain-guard.mjs`) and `drizzle-kit check` enforce this in CI.

## Numbering
- Take the **next free number after `main`**, never a number another open branch
  already used. Two branches that both mint `00NN_*` collide on merge. If your
  branch's number was taken while it was open, renumber against current `main`
  before merging.
- A schema change is always a generated migration (`pnpm db:generate`). Never
  hand-edit a live table shape or a committed migration's SQL after it has
  shipped.

## Down-files
- Every migration from **0022** on ships a `<tag>.down.sql` for rollback (the
  guard reds a new up-file without one). 0000–0021 predate the convention and are
  grandfathered — do not backfill them.

## Repair the chain on rebase
- A rebase that pulls a sibling's migration in ahead of yours breaks the
  snapshot/journal chain. Repair it: renumber your migration to the next free
  number, regenerate so `meta/<n>_snapshot.json` and `_journal.json` are in step,
  and confirm `drizzle-kit check` is clean.
- During a rebase conflict on a drizzle snapshot/journal, remember `--theirs` is
  YOUR commit and `--ours` is the rebased-onto base: taking `--theirs` for a
  number the sibling owns silently commits your stale snapshot. After resolving,
  verify the committed snapshot contains the sibling's tables, not just that the
  file parses.
