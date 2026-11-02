# Runbook: RDS connections

**Alarm:** `RdsConnectionsAlarm` — `AWS/RDS` `DatabaseConnections` (max) over 80
for three consecutive 5-minute periods.

## What it means

A `t4g.micro` Postgres allows roughly 112 connections. At 80 the instance is
running out of connection slots; once it is full, new connections are refused
and every path that needs the database — API writes, `GET /health`, the worker —
starts failing. This alarm is the early warning before that happens.

## First thing to check

1. **Who holds the connections?**
   `select usename, application_name, state, count(*)
      from pg_stat_activity group by 1,2,3 order by 4 desc;`
   A pile of `idle` (not `idle in transaction`) connections is a pool sized too
   large; `idle in transaction` is a leak — a transaction opened and never
   committed.
2. **Pool sizing.** Each Lambda execution environment opens its own pool
   (`DATABASE_POOL_MAX`). The scheduled worker sets it to 1; the API/redirect
   default higher. A surge in concurrent Lambda environments (see
   [lambda-throttles.md](lambda-throttles.md)) multiplies pools × `POOL_MAX` and
   can exhaust slots even at modest request rates.
3. **A stuck `idle in transaction`** is the most dangerous: it holds a slot and
   can hold locks. Find its `pid` and age; if it is clearly orphaned, terminate
   it with `select pg_terminate_backend(<pid>)`.

## If it is pool math, not a leak

Lower `DATABASE_POOL_MAX` on the offending function, or cap its
`reservedConcurrentExecutions`, so `concurrency × POOL_MAX` stays under the
instance limit. Redeploy to apply.
