# SnapURL — Session hygiene: backgrounding long-lived processes (steering)

This exists because five agent sessions on 2026-09-18 hand-started a server —
`node apps/api/dist/main.js &`, `nohup ... &`, and (on the fifth attempt)
`setsid ... > file 2>&1 < /dev/null &` — and every one hung silently until the
timeout killed it, costing roughly 4.5+ agent-hours total (issue #484).

## The mechanism is unresolved — do not trust a fix for it

The leading hypothesis was that a backgrounded child inherits a descriptor
(most likely stdin) or stays in the tool's process group, keeping the
harness's read from reaching EOF. **That hypothesis is disproven.** The fifth
hang used the exact detachment the earlier hypothesis called sufficient —
`setsid`, stdout and stderr redirected to files, and stdin redirected from
`/dev/null` — and the call still sat for ~40 minutes until the timeout killed
it. `setsid` had put the child in its own session (`PGID == SID == PID`) with
no descriptor belonging to the tool, and it still hung.

So there is currently **no known command form that reliably avoids the hang**
when a long-lived server is started directly from the agent's own shell. Do
not add `setsid`, further fd redirection, or any other variant to this list on
the theory that it fixes the hang — that has already been tried and failed.
The remaining suspects are inside the CLI/harness boundary itself (e.g. a
`waitpid`-on-any-descendant loop, or the shell call returning normally and the
CLI stalling on the following model round-trip), not in the shell command's
form. If you are investigating this, start there, not with another
detachment flag.

## The workaround: don't hand-start it

Every hang so far shares one trait: the long-lived process was started
directly from the agent's own shell. No session that used the Docker-managed
lifecycle has hung.

1. **Use `pnpm staging:up` / `pnpm staging:down`** (and `pnpm db:up` for just
   the database) instead of hand-starting `node dist/main.js` or
   `apps/redirect/dist/main.js`. These hand the process to the Docker daemon,
   so nothing long-lived is ever a descendant of the agent's shell — there is
   nothing for the harness to wait on, and nothing left running if the session
   is killed. This is adopted **because of that correlation**, not because the
   mechanism above is understood or fixed.
2. **If the scripted path genuinely does not cover what you need**, hand-starting
   remains possible but has hung real sessions — including with full
   detachment (`setsid ... < /dev/null &`). Expect it to hang, budget for it,
   and prefer to restructure the task to avoid needing a hand-started
   long-lived process at all.
3. **Verify readiness without an open-ended wait** regardless of which path you
   use. A bounded poll loop (fixed iteration count, each iteration sleeping)
   is fine. Do not pipe a long-lived process's output into something that
   blocks for more input, e.g. `| tail -f`, `| less`, or an unbounded `wait`
   on its PID.
4. **Always stop what you start before the session ends** — `kill` every PID
   you background by hand. This matters even more given the mechanism above:
   a session killed at the timeout leaves a hand-started server as an orphan
   (`PPID 1`), still holding its port for whoever runs next, whereas
   `pnpm staging:down` / Docker teardown does not leave that behind.
5. **Stop by recorded PID only — never `pkill -f` / `killall` with a pattern
   that also appears in your own prompt or command line.** Record the PID when
   you start the process (e.g. write it to `web.pid`) and `kill` exactly that
   PID. `pkill -f PATTERN` matches the full command line of *every* process on
   the box, including the harness process running your own session — if
   `PATTERN` is a substring of the command you were invoked with (it will be,
   whenever the pattern is the same server-start command your prompt told you
   to run), you SIGTERM yourself. This happened for real: a QA-lab session ran
   `pkill -f "next start --port 3000"` as cleanup, matched its own `kiro-cli`
   invocation (the prompt text embeds that exact command), and exit-143'd a
   session whose report had already been written (issue #532). Verify a server
   is down with `curl` against its port (as the QA-lab role prompts already do
   elsewhere) instead of pattern-killing. If a pattern-based kill is ever truly
   unavoidable, `pgrep -f PATTERN` first, inspect the matched PIDs, and exclude
   your own PID/PPID chain before sending any signal.
6. If you hit a hang after backgrounding a process — with or without extra
   detachment — do not silently retry a different flag combination on the
   same call. Note the exact command and outcome in your final report so the
   tally in issue #484 stays current; that data point is worth more than
   another guess at a fix.
