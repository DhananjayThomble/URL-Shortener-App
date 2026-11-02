# Runbook: Webhook backlog

**Alarm:** `WebhookBacklogAlarm` — more than 20 webhook deliveries are in the
`failed` state for two consecutive 15-minute periods (`SnapURL/Backlog`
`WebhookFailed`, threshold 20).

## What it means

A webhook delivery retries on a backoff ladder (1m, 5m, 25m, 2h, 10h) and is
marked `failed` once it exhausts it. A few failed deliveries is normal — a
customer's endpoint was down briefly. A *backlog* of them (> 20) means either
many endpoints are failing at once or one busy endpoint is down, and those
customers are missing their events.

## Where the metric comes from

Emitted by the worker's maintenance pass as an EMF metric
(`apps/worker/src/jobs/backlog-metrics.ts`, `WebhookFailed`). Also in the admin
panel's system-health backlogs (`webhook_deliveries` → `stuck`).

## First thing to check

1. Is it one endpoint or many?
   `select endpoint, count(*) from webhook_deliveries d
      join webhooks w on w.id = d.webhook_id
    where d.status = 'failed' group by endpoint order by 2 desc;`
   One endpoint dominating = that customer's receiver is down; not our problem
   to fix, but worth noting. Spread across many = look at us next.
2. If it is spread across many endpoints, check egress: the worker delivers
   webhooks over the NAT path (`natStrategy`), so a NAT outage fails *every*
   delivery. Confirm the NAT instance/gateway is healthy.
3. Read a sample `error` / `response_code` to tell a connection failure (egress)
   from an HTTP 4xx/5xx (the endpoint).

## To clear

Once the cause is resolved, re-queue with the admin panel's **retry webhook
deliveries** action (sets them back to `pending`, resets attempts).
