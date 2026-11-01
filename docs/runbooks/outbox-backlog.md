# Runbook: Projection-outbox backlog

**Alarm:** `OutboxBacklogAlarm` — at least one `projection_outbox` row has
exhausted its retries (`SnapURL/Backlog` `OutboxStuck`, threshold 1, 15-min
period).

## What it means

A link write (create / edit / disable / delete) is enqueued in
`projection_outbox` and drained by the worker into the DynamoDB projection and
the edge KVS that the redirect reads. A **stuck** row is one the drain tried
`MAX_ATTEMPTS` (8) times and gave up on — so the edge may be serving the *old*
destination for that link while the dashboard shows the new one. This is a
correctness problem, not just a delay.

## Where the metric comes from

The worker emits these counts to CloudWatch as an EMF line each maintenance
pass (`apps/worker/src/jobs/backlog-metrics.ts`), gated on
`BACKLOG_METRICS_NAMESPACE`. The same counts are visible in the admin panel's
system-health backlogs (`AdminHealthService.backlogs()`).

## First thing to check

1. Read the stuck rows' `last_error`:
   `select id, link_id, attempts, last_error from projection_outbox
    where processed_at is null and attempts >= 8;`
   The error names the cause — a DynamoDB `ValidationException`, a KVS write
   failure, a malformed payload.
2. Check the worker is running at all: its `Errors`/`Throttles` alarms, and the
   admin health "worker" status (a job lease renewed within the hour).
3. If the cause was transient (a DynamoDB blip now passed), re-queue them from
   the admin panel's **retry projection outbox** action, which resets
   `attempts` to 0 so the next drain picks them up.

## Do not

Do not hand-edit `projection_outbox` to mark rows processed — that leaves the
edge permanently stale for those links. Fix the cause, then retry.
