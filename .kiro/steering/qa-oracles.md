# SnapURL — QA oracles & the evidence contract (steering)

This governs every QA run. It exists because a previous QA pass drove the real
stack, raised 8 flags, dismissed all 8 itself, and concluded "zero genuine
defects" — on a system with 40 API routes and 21 tables. That conclusion was
not earned. These rules make it impossible to repeat.

## 1. You need an oracle, or you are not testing

An **oracle** is an independent statement of what correct means. Without one,
the only thing a test can assert is "it didn't crash" — which is what went
wrong last time ("render OK" for 15 flows).

**Never derive the expected value by reading the implementation.** If you read
`apps/api` to decide what `GET /links/:id` should return, you will encode its
bugs as the expectation. Derive expectations from, in order of preference:

1. `packages/contract` — the zod schemas are the declared truth for payloads.
2. `packages/domain` — pure logic. For routing-chain evaluation, write an
   independent, deliberately naive reference implementation and differential-test
   against it. Do not reuse the production code as its own oracle.
3. Docs: `README.md`, `docs/DECISIONS.md`, `docs/BACKEND.md`, `SELF-HOSTING.md`.
4. Invariants that must hold regardless of implementation — e.g. one redirect
   produces exactly one `click_events` row; a user can never read another
   workspace's rows; the API's validation of a routing chain and the redirect
   service's execution of it must agree (both import `packages/domain`, so a
   divergence is a bug by construction).

If you cannot state the oracle for a check, say so and skip the check. An
assertion with no oracle is worse than no assertion — it manufactures confidence.

## 2. Evidence, not verdicts — HARD RULE

**You do not decide what is or is not a defect.** You report what you did, what
you expected, what you observed, and where the proof is. Adjudication is done by
someone other than the run that produced the finding: the maintainer, or the
reviewer agent (`.kiro/prompts/reviewer.md`), which runs on a different model and
must reproduce a finding before filing it.

Banned from your output, in any phrasing: "not a defect", "works as designed",
"harness artifact", "false positive", "my selector was wrong", "expected
behaviour", "no issues found". You may record a *suspicion* in `notes`. You may
not close, dismiss, downgrade, or resolve anything.

If a check fails and you think your own harness is at fault: **report it anyway**,
with the suspicion in `notes`, and — if you can — re-probe by a *different method*
(DOM dump vs. accessibility tree, SQL vs. API response, raw HTTP vs. browser) and
attach both results. Two methods disagreeing is itself a finding worth having.

A run that reports zero findings is treated as a **failed run** — it means the
assertions were too weak. Do not aim for green. Aim for true.

## 3. Finding format

Append one JSON object per line to `.qa-runs/<run-id>/findings.jsonl`:

```json
{
  "id": "idor-links-get-by-id",
  "layer": "calibration|domain|contract|semantic-e2e|adversarial|a11y|sad-path",
  "title": "one line, factual, no verdict",
  "target": "GET /links/:id  — or —  packages/domain/src/routing/evaluate.ts",
  "what_i_did": "exact reproducible steps",
  "expected": "the oracle's answer, and WHICH oracle (cite file/schema/doc)",
  "observed": "literal output — status, body, rendered text, row count",
  "evidence": [".qa-runs/<run-id>/artifacts/foo.png", "...har", "...sql.txt"],
  "repro": "one shell command that reproduces it",
  "severity_hint": "sev1|sev2|sev3|unknown",
  "confidence": "high|medium|low",
  "notes": "optional; suspicions about your own harness go here"
}
```

There is deliberately **no `status` or `verdict` field.** Adjudication happens
outside your run.

Also write `.qa-runs/<run-id>/summary.md`: what you ran, the commands, counts of
checks attempted/failed/errored, and what you could NOT cover and why. Coverage
gaps are a required section — an honest "I could not test X" is valuable; silence
is not.

### Write incrementally, not at the end

A run that does all its analysis and only writes `findings.jsonl` and
`summary.md` as a last step loses everything if it crashes or times out one
step early — this has already happened twice (issue #561) and cost a complete
39-minute session with zero recorded output. Nothing about the record below
may depend on a final step succeeding:

1. **Create `.qa-runs/<run-id>/summary.md` before running any check** — plan,
   the areas/tools you intend to cover, and an empty (or "pending") result
   section per area. Update that section the moment each check or phase
   finishes (result, counts, coverage gaps for that phase), not after every
   phase is done.
2. **Append each finding to `findings.jsonl` the instant it is confirmed** —
   one JSON line per finding, immediately, never buffered in memory to write
   as a batch later.
3. **Keep `.qa-runs/<run-id>/progress.md`**, one line appended per completed
   phase (timestamp + phase name + one-line result). If the run dies, this
   file alone shows how far it got.
4. Raw tool output still stays only in files under the run directory — never
   print secrets, tokens or response bodies to stdout (steering §7, and the
   CI-mode rule in `_common.md`).

## 4. A suite is not trusted until it has been proven to fail

Before any new suite is trusted, run the **bug-injection gate**: introduce known
defects one at a time and show the suite goes RED for each. Suggested catalog:

- off-by-one in the click rollup (`apps/worker/src/jobs/`)
- flip a comparison in routing-rule evaluation (`packages/domain`)
- drop the workspace-ownership check on a `GET /:id` route
- break the UTM merge in the redirect path
- widen a zod schema in `packages/contract` so an invalid payload passes

Record per injected bug: caught / not caught, and which check caught it. **Revert
every injection** — the gate runs on a throwaway branch and nothing from it is
ever merged. A suite that stays green against a knowingly broken build is
worthless and must be reported as such.

## 5. Fixtures are a fake — never QA against them

`e2e/playwright.config.ts` runs with `NEXT_PUBLIC_USE_FIXTURES=true`, which
serves every API call from the in-memory fake in `web/src/lib/api/fixtures.ts`.
Those specs cannot catch a backend, contract or logic bug. QA runs drive the
**real stack**: `pnpm staging:up` (api `:3001`, redirect `:3002`, Postgres `5435`).

## 6. Environment boundaries

- **Staging only.** Never run QA — especially adversarial checks — against
  production (`app.snapurl.in`) or any deployed AWS environment. No CDK deploy,
  no AWS mutation, from a QA run.
- Work in a git worktree on a branch. Never commit directly to `main`.
- Tear down with `pnpm staging:down` when finished.

## 7. This repository is PUBLIC

- Never commit tokens, JWTs, refresh tokens, passwords, API keys, AWS account
  ids, or customer data — not in code, tests, fixtures, issues, PRs, commit
  messages, or committed reports.
- Credentials at runtime come from env vars, never literals in a file.
- `.qa-runs/`, `.staging-qa/`, `.mobile-audit/` are gitignored: raw artifacts
  stay local. Only the distilled report is ever committed, and only after
  scrubbing.
- Filing a GitHub issue publishes text to the internet. Redact hostnames,
  tokens and ids that are not already public before filing.

## 8. Reporting defects

Confirmed defects become GitHub issues on `DhananjayThomble/URL-Shortener-App`
with: repro steps, expected vs. actual, severity, affected route/component, and
the oracle the expectation came from. One issue per defect. A finding that lives
only in a markdown file evaporates — but **only adjudicated findings get filed**,
and adjudication is not yours to do (§2). Issues filed by the reviewer agent carry
the `qa:agent-confirmed` label so the maintainer can audit them.

**Exception — adversarial (L5) findings with a live exploit never go to the
public issue tracker.** A working proof-of-concept for an open redirect, stored
XSS, auth bypass, or workspace-isolation break is immediately usable against
every running instance, including self-hosted ones that have not patched yet.
Publishing one in a public issue before a fix exists puts those operators at
risk — this is why #565 exists. For that class of finding:

1. Do not file a public GitHub issue, even in draft or with redaction planned
   for later. Draft it privately first.
2. Report through the private channel in [`SECURITY.md`](../../SECURITY.md) —
   GitHub Security Advisories ("Report a vulnerability" on the Security tab).
   That thread is visible only to the reporter and the maintainers.
3. Still write the finding to `.qa-runs/<run-id>/findings.jsonl` per §3 — the
   evidence contract does not change, only the disclosure surface does. Note
   in the finding's `notes` field that it was additionally reported via the
   private channel, and when.
4. Adjudication (§2) still is not yours to do. The private advisory thread is
   where the maintainer confirms and coordinates a fix; it does not bypass the
   rule that you don't self-adjudicate.

Findings that are not exploitable in their current form (e.g. a suspicious
pattern with no working PoC, or a hardening gap with no demonstrated impact)
are not L5 live-exploit findings for the purpose of this exception and follow
the normal public-issue path above.
