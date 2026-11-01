# Runbook: Lambda errors

**Alarm:** `{Api,Redirect,Worker}FnErrorsAlarm` — the function reported at least
one faulted invocation in a 5-minute window (`AWS/Lambda` `Errors`, threshold 1).

## What it means

The named Lambda threw, timed out, or ran out of memory on an invocation. The
bar is one error on purpose: the api and redirect functions should not be
faulting at all, so even one is worth a look.

## First thing to check

1. Open the function's CloudWatch Logs (`/aws/lambda/<function>`), filter to the
   alarm window, and read the stack trace or `Task timed out` / `Runtime exited`
   line. That one line usually names the cause.
2. If it is the **redirect** function, confirm the redirect is still serving:
   follow a known-good short link and a canary link. A redirect error can mean
   the edge is falling back to the origin (slower) or 503-ing (down).
3. If it is the **worker**, check whether the maintenance/frequent pass is
   failing wholesale (every job) — that points at the database being
   unreachable (see [rds-connections.md](rds-connections.md)) rather than a code
   bug in one job.
4. If the trace is a cold-start timeout, check whether a deploy just happened
   (new image, empty connection pool) — a single post-deploy spike that clears
   is not an incident.

## If it keeps firing

A sustained error stream is a regression in the last deploy. Check
`DeployedGitSha` (stack output) against `main`, and roll forward with a fix or
back per [../ROLLBACK.md](../ROLLBACK.md).
