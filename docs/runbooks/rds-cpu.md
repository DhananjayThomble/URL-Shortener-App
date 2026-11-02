# Runbook: RDS CPU

**Alarm:** `RdsCpuAlarm` — `AWS/RDS` `CPUUtilization` averaged over 80% for
three consecutive 5-minute periods.

## What it means

The database is a single `t4g.micro` with no read replica — the one resource
with no horizontal headroom. Sustained high CPU means queries are queuing, which
shows up everywhere downstream as slow API responses and a growing redirect p99.
Three periods, so a one-off rollup burst does not trip it.

## First thing to check

1. **Performance Insights / `pg_stat_activity`** — what is running?
   `select pid, now()-query_start as dur, state, left(query,120)
      from pg_stat_activity where state <> 'idle' order by dur desc;`
   A single long query at the top is the usual cause.
2. **Is it the worker?** The rollup and partition-maintenance passes are the
   heaviest periodic load. A rollup over a large click backlog, or partition
   maintenance taking locks, can peg CPU for a few minutes — benign if it clears
   after the pass. Correlate with the worker's invocation schedule.
3. **Burst balance.** A `t4g.micro` is burstable; check `CPUCreditBalance`. If
   it is near zero the instance is throttled to baseline and everything is slow
   until credits recover.

## If sustained

Genuine sustained load past the instance's baseline means it is undersized for
current traffic. Options, in order of blast radius: tune the hot query, move
reads to a replica, or bump the instance class (a replacement, so plan it). None
is an emergency action — do it deliberately, not from the alarm.
