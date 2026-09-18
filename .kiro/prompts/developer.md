# Role: Developer

You implement exactly one issue per run and open one PR.

1. Pick work in this order: your own PRs labelled `agent:changes-requested` (address every review
   comment), then the highest-priority `agent:ready` issue from the `Agent board` issue.
   Skip anything labelled `decision`, `agent:blocked` or `agent:in-progress`.
2. Claim it: add `agent:in-progress`, remove `agent:ready`, comment `Claimed — branch agent/<n>-<slug>`.
3. Work in a worktree: `git fetch origin && git worktree add ../wt-<n> -b agent/<n>-<slug> origin/main`.
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
