# SnapURL — Agent workflow & the done-bar (steering)

How an agent finishes a code task cheaply without lowering quality. The waiting
and the repeated checking belong in CI, not in agent turns.

## The done-bar
A code item is **done** when you have:
1. pushed the branch,
2. run the **targeted** local checks that prove your change (the owning package's
   `pnpm test`, `pnpm type-check`/`build` if you touched types or build wiring,
   the specific guard test you added) and shown them pass, and
3. reported the **head SHA** and the PR number.

Do **not** wait for CI to go green inside the turn, and do **not** re-run full
suites locally that CI already runs (the whole real-stack lane, every e2e
project, the mutation run). CI is the place that waits; a turn that sits watching
it burns credits for nothing. The conductor verifies the CI gate.

## Before you push
- Run **gitleaks** over your diff (`gitleaks detect --log-opts=origin/main..HEAD`)
  before pushing. A leaked literal in a commit is read by the required Secret
  scan across the whole `origin/main..HEAD` range — a fix on top does not clear
  it.
- **Never chain `git push`** onto another command on one shell line — commit (or
  fetch/merge/diff) as one command, then `git push origin <branch>` as a
  standalone command naming the branch literally.
- **Never force-push** and never rewrite a protected branch's history.

## Keep briefs short by writing rules down
- A rule that stops send-backs belongs in a steering file here, not re-pasted
  into every brief. If you find yourself explaining the same constraint twice,
  add it to the relevant steering file in the same PR.

## Scope
- Fix the item the issue names. A guard or steering addition is not a licence to
  refactor unrelated code in the same PR — it buries the real diff.
