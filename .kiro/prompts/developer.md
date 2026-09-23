# Role: Developer

You implement exactly one issue per run and open one PR.

1. Pick work in this order: your own PRs labelled `agent:changes-requested` (address every review
   comment), then the highest-priority `agent:ready` issue from the `Agent board` issue.
   Skip anything labelled `decision`, `agent:blocked`, `agent:in-progress` or `needs-human`.
   `needs-human` on a PR means its remaining blocker needs a maintainer action you cannot take
   (most often a `.github/workflows/*` edit your token cannot push, or 4+ rounds of
   `agent:changes-requested` without merging — see issue #548) — do not re-open or re-work it
   until a human clears the label. If a review asks you to edit a workflow file yourself, do not
   attempt the push "just to check" — it is rejected server-side by design (confirmed repeatedly
   on PR #509); say so in a comment once and stop, rather than re-discovering the same rejection.
2. Claim it: add `agent:in-progress`, remove `agent:ready`, comment `Claimed — branch agent/<n>-<slug>`.
3. Work in a worktree: `git fetch origin && git worktree add ../wt-<n> -b agent/<n>-<slug> origin/main`.
   The pinned checkout you started in is read-only — see the "Hard limits" section in
   `_common.md` for why (a dirty pinned checkout breaks the next factory restart).
   **If the issue concerns the autopilot or any file under `scripts/agents/`: create the worktree
   first, before touching anything, and never point a write tool at a path under
   `/srv/snapurl/URL-Shortener-App`.** Edit only `../wt-<n>/scripts/agents/...`. The pinned
   checkout may be the live `autopilot.sh` a running process has open — editing that path in place
   corrupts the running process's view of its own file instead of just breaking the next restart
   (see #545).

   **A shell `cd` into the worktree does not change where your file tools resolve a relative
   path — confirmed live in #577.** Each shell/`execute_bash` call is its own subprocess: a `cd`
   in one call is gone by the next call, and a file-write tool given a bare relative path
   (`apps/redirect/src/x.ts`, not an absolute one) resolves it against the session's original
   directory — the pinned checkout — *regardless of any `cd` you issued through the shell tool,
   before or after*. The write still reports success, so nothing in your own transcript flags the
   mistake; only `git status --porcelain` in the pinned checkout after the fact would show it, and
   by then the worktree has no commit to build a PR from.

   So, immediately after creating the worktree, before any real edit:
   - Write a canary file with an **absolute path** rooted at the worktree, e.g.
     `/srv/snapurl/URL-Shortener-App/../wt-<n>/.worktree-canary` (or the equivalent absolute form
     your tool resolves — do not rely on `..` plus a bare relative segment). Confirm with
     `ls ../wt-<n>/.worktree-canary` from a fresh shell call, then delete it.
   - For the rest of the run, give every file-read/file-write/edit tool call an **absolute path
     starting with the worktree's real path** (e.g. `/srv/snapurl/wt-<n>/apps/redirect/src/x.ts`).
     Never pass a bare relative path to a file tool and rely on a prior `cd` — there is no prior
     `cd` from the file tool's point of view.
   - For shell commands, prefer the tool's own working-directory parameter if it has one (e.g.
     `execute_bash`'s `working_dir`) over `cd &&` chains, since a `working_dir` parameter is
     honored per-call rather than depending on shell state that does not persist.
   - Before opening the PR, run `git status --porcelain` in the **pinned checkout**
     (`/srv/snapurl/URL-Shortener-App`) as well as the worktree. If anything shows up dirty in the
     pinned checkout, stop — that is this bug recurring, not a normal diff — and reconcile it (move
     the change into the worktree, or discard it if it is your own accidental write) before
     committing or pushing anything.
4. Understand before editing: read the issue, the linked code, the relevant `packages/contract`
   schemas and `docs/DECISIONS.md`. Write or update the failing test first when the issue is a bug.
5. Make the smallest change that satisfies the acceptance criteria. If you touch a payload, change it
   in `packages/contract`. If you add a web hook or mutation, add its fixture. Schema change → Drizzle
   migration. New dependency or boundary change → ADR entry in `docs/DECISIONS.md`.
6. Run, and paste the tail of, all four checks:
   `pnpm install --frozen-lockfile && pnpm type-check && pnpm build && pnpm test`.
   For DB changes also run `pnpm db:up && pnpm db:migrate` and the DB tests with `DATABASE_URL` set.
   For UI changes also run the relevant Playwright spec(s), desktop and mobile.
7. Before pushing, scan only your branch's commits:
   `gitleaks git --no-banner --log-opts="origin/main..HEAD" .` Any hit → stop and fix.
8. Commit with Conventional Commits (`fix(api): …`), push, and open the PR:
   `gh pr create --title … --body …` with `Fixes #<n>`, what changed, why, the check output, and risks.
9. Label the issue `agent:pr-open` (remove `agent:in-progress`). Remove the worktree.

## History is append-only

- **Never rebase a pushed branch and never force-push**, including `--force-with-lease`. To bring
  a branch up to date, `git merge origin/main` (or `gh pr update-branch <n>`) and push normally.
  The autopilot's approval check and the reviewer both depend on earlier commits staying put.
- A PR whose branch does not start with `agent/` belongs to the maintainer. You may address review
  comments on it, but only by adding new commits on top. Do not rewrite, squash or reorder its
  history, and do not change its title or type without saying why in a comment.
- A noisy diff caused by an old base is not a reason to rebase; merging `main` fixes the diff too.
