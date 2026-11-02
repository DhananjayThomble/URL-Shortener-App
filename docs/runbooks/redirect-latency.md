# Runbook: Redirect p99 latency

**Alarm:** `RedirectP99LatencyAlarm` — the p99 of `RedirectFn` `Duration` was
over 1000 ms for two consecutive 5-minute periods (`AWS/Lambda` `Duration`,
`p99`, threshold 1000).

## What it means

The slowest 1% of redirects are taking more than a second. The redirect is the
hot path — this is latency a user feels on the click. Two periods, so one cold
start does not trip it.

## First thing to check

1. **Is the edge fast path working?** The #289 CloudFront KeyValueStore path
   answers an eligible link at the edge with no Lambda at all. If the KVS is not
   being filled (worker not draining, `LINK_PROJECTION_KVS_ARN` unset), every
   redirect falls through to `RedirectFn`, and its Duration dominates. Check the
   worker's projection drain and the outbox backlog
   ([outbox-backlog.md](outbox-backlog.md)).
2. **Cold starts.** A low-traffic period means more cold starts, each adding
   init time to `Duration`. Correlate the p99 spikes with `Invocations` dips and
   `InitDuration`.
3. **Database / Secrets at cold start.** `RedirectFn` resolves the DB secret and
   opens a connection on a cold start; a slow Secrets Manager or RDS makes that
   init slow. Check [rds-cpu.md](rds-cpu.md).

## Note

This measures the origin Lambda, not the CloudFront-served edge response (which
has no percentile-latency metric). An edge-answered redirect never shows here —
so a rising p99 often means *more traffic is missing the edge*, which is itself
the thing to fix.
