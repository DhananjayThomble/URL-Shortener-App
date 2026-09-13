# Rollback

How to put production back on an earlier commit, and — more importantly — what
that does **not** undo.

## Read this part first

**Rolling back code does not roll back the database.** Migrations are applied
forward-only by Drizzle's migrator. If the release you are backing out added a
migration, redeploying the previous commit leaves the *new* schema in place while
running the *old* code. Whether that is safe depends entirely on whether the
migration was backwards-compatible:

| The migration… | Rolling back code is… |
| --- | --- |
| added a nullable column or a new table | safe — old code ignores it |
| added a column the old code does not read | safe |
| dropped or renamed a column the old code reads | **broken** — old code queries a column that no longer exists |
| tightened a constraint the old code violates | **broken** — writes start failing |

For the unsafe rows, a code rollback makes things *worse*, not better. Roll
forward with a fix instead. This is the main reason migrations must be written
expand/contract (add nullable → backfill → tighten in a *later* release), so that
any single release remains reversible.

**CloudFormation's own rollback is a different thing.** It reverts a *failed*
stack update automatically. It does nothing about a deploy that **succeeds** and
is functionally broken — which is the case that actually hurt here: production
returned 403 for every short link while CloudFormation reported success, health
checks were 200, Lambda error counts were zero and the DLQ was empty. That is the
scenario this document is for.

## 1. Find out what is running

```bash
aws cloudformation describe-stacks --profile snapurl-ro --region ap-south-1 \
  --stack-name SnapUrl \
  --query 'Stacks[0].Outputs[?OutputKey==`DeployedGitSha`].OutputValue' --output text
```

If that returns nothing, the stack predates the `DeployedGitSha` output. Fall
back to correlating `Stacks[0].LastUpdatedTime` against the deploy workflow's run
history, and accept that you are inferring rather than reading.

## 2. Choose the target commit

The last commit known to have passed the post-deploy smoke gate — check the
**Deploy (AWS)** workflow history for the most recent run whose `smoke` job was
green. "The previous commit on main" is a worse choice: it may never have been
deployed at all.

```bash
git log --oneline -15 origin/main
```

## 3. Roll back

Actions → **Deploy (AWS)** → Run workflow:

- `stack`: `SnapUrl`
- `git_ref`: the target commit SHA
- `skip_smoke`: leave unchecked

The `plan` job runs first. **Read its diff.** A rollback diff should be the exact
inverse of the deploy that caused the problem; anything else means the target
commit is not what you thought. The plan job's preflight also tells you whether
the target's container images are still in ECR (fast) or need rebuilding (several
minutes) — useful for setting expectations while an incident is open.

Then approve the `production` environment prompt. Approve twice: once for
`deploy`, once for `migrate` (environment protection is evaluated per job).

`migrate` runs on a rollback too and is a no-op when nothing is pending — it will
not attempt to reverse anything. Re-read the warning at the top: that no-op is
also why the schema stays forward of the code.

## 4. Confirm it worked

The `smoke` job is the real verdict: it creates a link through the live API and
follows it, asserting the redirect. If it passes, the core journey works. Do not
substitute a health check — `/health` returned 200 throughout the 403 outage.

Spot-check by hand as well:

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
curl -s -o /dev/null -m 25 -A "$UA" -w 'status=%{http_code}\nlocation=%header{location}\n' \
  'https://snapurl.in/<known-slug>?utm_source=probe'
```

Use a realistic User-Agent for anything touching analytics: the rollup counts
only `is_bot = false`, so curl's default UA is correctly classified a bot and
will read as zero clicks forever.

## If the rollback itself fails

A deploy that fails during the image build or ECR push has applied **nothing** —
the change set runs only after every image builds and pushes. Confirm with
`LastUpdatedTime` and retry.

If CloudFormation itself fails mid-update it will roll back to the pre-update
state on its own, which for a rollback attempt means you are back on the broken
release. At that point stop escalating automation and inspect the stack events:

```bash
aws cloudformation describe-stack-events --profile snapurl-ro --region ap-south-1 \
  --stack-name SnapUrl --max-items 40 \
  --query 'StackEvents[?ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
  --output table
```

## Known gap

There is no canary or staged rollout. New code takes 100% of traffic the moment
the deploy completes, and the smoke gate runs *after* that. So this procedure
shortens the time to recovery; it does not prevent users from seeing the problem.
Closing that properly means a Lambda alias with CodeDeploy weighted shifting and
an alarm-triggered automatic rollback — not yet built.
