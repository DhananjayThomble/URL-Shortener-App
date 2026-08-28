# Deploying SnapURL

The frontend and the backend deploy separately and have almost nothing in
common operationally. That is deliberate — see [ARCHITECTURE](./ARCHITECTURE.md)
for why the redirect path and the dashboard are treated as different systems.

This document covers the **frontend on Vercel**. The backend on AWS is tracked
separately and is not yet implemented.

---

## Frontend → Vercel

### What Vercel needs to know

SnapURL is a pnpm workspace, and `web/` depends on two local packages that must
be built before it. `vercel.json` at the repository root handles this:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter @snapurl/contract build && pnpm --filter @snapurl/domain build && pnpm --filter snapurl-web build",
  "outputDirectory": "web/.next"
}
```

Leave Vercel's **Root Directory** at the repository root, not `web/`. Setting it
to `web/` hides the workspace from pnpm and the contract package will not
resolve.

The `ignoreCommand` skips a rebuild when a commit touched only backend files,
so a change to `apps/worker` does not redeploy the dashboard.

### Required environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Yes** | Absolute URL of the API, including `/api/v1`. Must not be localhost. |
| `NEXT_PUBLIC_USE_FIXTURES` | No | Leave unset. Setting it to `true` is rejected in a production build. |

Both are `NEXT_PUBLIC_*`, which means Next.js **inlines them into the browser
bundle at build time**. They are not runtime configuration: changing
`NEXT_PUBLIC_API_URL` requires a redeploy, not a restart. Nothing secret may
ever be given a `NEXT_PUBLIC_` prefix — it ships to every visitor.

### The build refuses to ship a broken deploy

`web/next.config.ts` fails the build if a production build has no
`NEXT_PUBLIC_API_URL`, or has one pointing at localhost.

This exists because the failure it prevents is invisible. `next.config.ts` used
to carry a `?? "http://localhost:3001/api/v1"` fallback, so a deploy missing
the variable would compile happily and bake localhost into the bundle. Every
visitor's browser would then call *their own machine*, the dashboard would
render empty, and nothing in the logs would explain it.

The same guard rejects `NEXT_PUBLIC_USE_FIXTURES=true`. Fixtures are ~480 lines
of invented workspaces and analytics; a site serving them looks entirely
functional, which is precisely what makes shipping them worse than crashing.

**CI compiles the frontend on every pull request without an API to point at.**
That build sets `SNAPURL_ALLOW_UNCONFIGURED_BUILD=true`, which means "this
output will never be served to anyone." Never set it on a real deploy — it
disables the only thing standing between a missing variable and a silently
broken production site.

### CORS

The API allows `WEB_ORIGIN` only (`apps/api/src/config/env.ts`). After the
first Vercel deploy, set `WEB_ORIGIN` on the API to the deployed frontend URL
or every request will be blocked by the browser.

Vercel preview deployments get their own generated URLs, so previews will not
be able to reach a production API unless those origins are allowed too. The
simplest honest answer is to point previews at a staging API.

### First deploy checklist

1. Import the repository into Vercel; leave Root Directory at the repo root.
2. Set `NEXT_PUBLIC_API_URL` to the deployed API's base URL.
3. Deploy. If it fails, read the error — the guard names the exact variable.
4. Set `WEB_ORIGIN` on the API to the Vercel URL, and restart the API.
5. Sign in. If the dashboard renders but every panel is empty, it is CORS.

---

## Backend → AWS

Not yet implemented. There is no CDK stack, no container image and no deploy
pipeline.

The shape it should take, and the cost constraints that dictate it, are
recorded in [DECISIONS.md](./DECISIONS.md). The single most important one:

> Lambda, DynamoDB, CloudFront, SQS and SSM Parameter Store all sit inside
> AWS's always-free tiers at this workload. **Postgres is roughly 92% of the
> bill.** A NAT Gateway costs about $32/month before a byte moves — more than
> everything else combined — and the standard "put RDS in a private subnet"
> tutorial creates one.

Until that work lands, the apps run anywhere Node 22 runs. They read all
configuration from the environment, expose health endpoints
(`/api/v1/health` and `/health`), and shut down their database pools cleanly on
`SIGTERM`.
