# Runbook: Uptime canary

**Alarm:** `UptimeCanaryAlarm` — the Synthetics canary's `SuccessPercent`
dropped below 100 (`CloudWatchSynthetics` `SuccessPercent`, `LessThanThreshold`
100).

## What it means

Every 5 minutes the `snapurl-uptime` canary
(`infra/functions/canary/nodejs/node_modules/uptime-canary.js`) does two checks
and fails if either is wrong:

1. **Redirect:** `GET https://<domain>/__uptime` must return **exactly 302** with
   **exactly** the expected `Location`. It does not follow the redirect — it
   inspects the 302 itself.
2. **API health:** `GET <api>/api/v1/health` must return 200.

A failing canary means a real user clicking a link right now is getting the
wrong thing. This is the closest alarm to "the product is broken for users".

## First thing to check

1. **Which step failed?** Open the canary in the CloudWatch Synthetics console →
   the latest failed run → its logs/screenshot. The step name
   (`redirect-302-and-location` or `api-health`) and the thrown message (e.g.
   `redirect returned 404, expected 302`) point straight at it.
2. **Redirect step failed:**
   - `404` → the canary link is gone. Re-create it:
     `bash scripts/create-canary-link.sh` (idempotent). Confirm nobody deleted
     the `__uptime` link.
   - `302 to the wrong Location` → the link's destination was changed, or the
     edge is serving a stale projection ([outbox-backlog.md](outbox-backlog.md)).
   - `200`/`5xx`/timeout → the redirect path itself is down; see
     [redirect-latency.md](redirect-latency.md) and the `RedirectFn` error alarm.
3. **API health step failed:** the API or its database is down — go to
   [api-5xx.md](api-5xx.md) and [rds-connections.md](rds-connections.md).

## The canary link

- Slug `__uptime` on the short domain, destination a stable in-domain path.
- Created by `scripts/create-canary-link.sh`, not by CloudFormation.
- Excluded from user analytics by its bot `User-Agent` (the redirect flags
  `isBot`; the rollup and analytics reader drop bot clicks) — so the canary's
  288 hits/day never land in any workspace's numbers. Do not "fix" that by
  changing its User-Agent.
