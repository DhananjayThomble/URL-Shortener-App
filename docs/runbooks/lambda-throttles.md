# Runbook: Lambda throttles

**Alarm:** `{Api,Redirect,Worker}FnThrottlesAlarm` — the function was throttled
at least once in a 5-minute window (`AWS/Lambda` `Throttles`, threshold 1).

## What it means

Lambda rejected an invocation because the function hit its concurrency ceiling.
Each of these functions runs with `reservedConcurrentExecutions` set, so a burst
beyond that reservation is throttled rather than queued. On the **redirect**
path a throttle is a dropped visitor, which is why the bar is one.

## First thing to check

1. Look at the function's `ConcurrentExecutions` metric over the alarm window
   against its reserved limit (see `*_RESERVED_CONCURRENCY` in
   `infra/lib/snapurl-stack.ts`). Pegged at the limit means real traffic
   outgrew the reservation.
2. Distinguish a genuine traffic spike from a runaway: is `Invocations` up
   across the board, or is one caller looping? For the worker, a flood of
   `{"task":"projection"}` nudges from the API (`ProjectionNudgeService`) can
   drive its concurrency.
3. Check the account-level concurrency headroom — a throttle can also come from
   the account's unreserved pool being exhausted by another function.

## What to do

- Real sustained growth: raise that function's `reservedConcurrentExecutions`
  and redeploy. The redirect path is the one to protect first.
- A runaway caller: fix the caller; do not just raise the ceiling.
