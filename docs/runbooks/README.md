# Alarm runbooks

One file per CloudWatch alarm the stack creates (#996). Each says, in a few
lines, **what the alarm means** and **the first thing to check** — enough to
start, not a full incident playbook.

All alarms notify the shared budget-alert SNS topic (the same email the
`$25/$50/$75` spend alarms use), and all treat missing data as *not breaching*,
so a quiet healthy system never pages — an alarm firing means a real datapoint
crossed the line.

| Alarm | Runbook |
| --- | --- |
| Lambda errors (api / redirect / worker) | [lambda-errors.md](lambda-errors.md) |
| Lambda throttles (api / redirect / worker) | [lambda-throttles.md](lambda-throttles.md) |
| API 5xx rate | [api-5xx.md](api-5xx.md) |
| Redirect p99 latency | [redirect-latency.md](redirect-latency.md) |
| Projection-outbox backlog | [outbox-backlog.md](outbox-backlog.md) |
| Webhook backlog | [webhook-backlog.md](webhook-backlog.md) |
| SES bounce / complaint rate | [ses-reputation.md](ses-reputation.md) |
| RDS CPU | [rds-cpu.md](rds-cpu.md) |
| RDS connections | [rds-connections.md](rds-connections.md) |
| Uptime canary | [uptime-canary.md](uptime-canary.md) |

The alarm definitions and thresholds live in `infra/lib/snapurl-stack.ts` (the
`#996` block) and are asserted by `infra/lib/snapurl-stack.alarms.test.ts`.
