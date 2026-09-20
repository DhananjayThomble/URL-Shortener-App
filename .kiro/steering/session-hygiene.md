# SnapURL — Session hygiene: backgrounding long-lived processes (steering)

This exists because three agent sessions on 2026-09-18 hand-started a server with
`node apps/api/dist/main.js &` (or `nohup ... &`), the command's own output showed
it finished successfully, and the session then hung silently until the timeout
killed it — costing ~4.5 agent-hours total (issue #484).

## Investigation status (read before assuming the mechanism)

The leading hypothesis is that the tool harness reads a session's output through a
pipe or PTY until it sees EOF, and EOF only happens once **every** process holding
the write end of that fd has closed it — not just the shell that ran the command.
A backgrounded child that does not fully detach can still hold that fd open after
the parent shell exits, so the harness's read blocks forever even though the shell
itself returned.

This was confirmed experimentally in one shell model (a script whose own stdout is
a pipe, with a backgrounded child that does **not** redirect its own stdout,
inherits the pipe fd, and the reader then blocks past the parent's exit — see
`gh issue view 484` for the reproduction transcript). It was **not** reproduced
against this session's own tool (`execute_bash`): repeated attempts to hang it the
same way — bare `&`, redirected stdout/stderr only, a FIFO standing in for a PTY
slave, and an actual PTY via `pty.fork()` — all returned immediately in this
environment. The three original hangs were on a different runner ("Factory" /
`kiro` engine) than this session, so the harness-level detail (plain pipe vs. PTY,
per-command vs. persistent shell) may differ in a way that changes whether a given
form of detachment is sufficient. Treat the rule below as the safe default
regardless of which harness you are on, not as proof of the exact mechanism on
every harness.

## The rule

1. **Prefer the scripted paths.** `pnpm staging:up` (Docker Compose `-d --wait`)
   and `pnpm db:up` return properly on their own and cannot hang this way. Both
   sessions that hung had bypassed these and run `node dist/main.js` by hand
   against the dev database instead. Use the scripted path unless you have a
   specific reason not to, and say what that reason is.
2. **If you must hand-start a long-lived process**, fully detach it — new
   session, and all three standard fds redirected, stdin included:
   ```bash
   setsid node apps/api/dist/main.js > /tmp/api.log 2>&1 < /dev/null &
   ```
   Redirecting only stdout/stderr (`> file 2>&1`) is what both hung sessions
   already did and is **not sufficient by itself** — always also redirect stdin
   (`< /dev/null`) and start it in its own session (`setsid`) so it cannot be
   left holding a controlling terminal or an inherited fd open after your shell
   command returns.
3. **Verify readiness without an open-ended wait.** A bounded poll loop (fixed
   iteration count, each iteration sleeping) is fine — that is not what hung.
   Do not pipe a long-lived process's output into something that blocks for
   more input, e.g. `| tail -f`, `| less`, or an unbounded `wait` on its PID.
4. **Always stop what you start before the session ends.** `kill` every PID you
   background by hand. A leaked server does not just risk a hang this session —
   it can also squat the port for the next one.
5. If you hit an unexplained hang after backgrounding a process, do not silently
   retry the same form. Note the exact command in your final report so the
   pattern can be added here.

## Cheap way to sanity-check a harness

Background `sleep 300` three ways and confirm each returns immediately:
```bash
sleep 300 &                                    echo bare
sleep 300 > /tmp/a.log 2>&1 &                  echo "redirected out/err only"
setsid sleep 300 > /tmp/a.log 2>&1 < /dev/null & echo "fully detached"
```
If the first or second hangs the session but the third does not, that confirms
the fd-inheritance mechanism above for your specific harness.
