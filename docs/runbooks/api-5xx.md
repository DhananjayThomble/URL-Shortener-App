# Runbook: API 5xx rate

**Alarm:** `Api5xxAlarm` — the HTTP API returned more than 5 responses with a
5xx status in a 5-minute window (`AWS/ApiGatewayV2` `5xx`, threshold 5).

## What it means

The API is failing requests, not just one request being unlucky. A 5xx from the
HTTP API is almost always the backing Lambda (`ApiFn`) erroring or timing out,
or the API being unable to reach it.

## First thing to check

1. Cross-reference [lambda-errors.md](lambda-errors.md) for `ApiFn`: the 5xx and
   a Lambda `Errors` alarm usually fire together, and the Lambda log has the
   actual stack trace. Start there.
2. If `ApiFn` shows no errors but the API still 5xxes, look at API Gateway's own
   `IntegrationLatency` — a Lambda that is timing out at the integration (not
   throwing) shows as a 5xx here and a `Duration` near the timeout there.
3. Check the database: a `select 1` failure makes `GET /api/v1/health` 503 and
   most write paths 5xx. See [rds-connections.md](rds-connections.md) and
   [rds-cpu.md](rds-cpu.md).

## Scope it

Is it every route or one? API Gateway access logs (or the Lambda log grouped by
path) tell you whether this is a total outage or one broken endpoint from the
last deploy.
