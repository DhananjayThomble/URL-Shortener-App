import { z } from "zod";

/* Config is validated once at boot and never read from process.env again.
   A missing JWT secret should stop the process on startup, not surface as a
   401 three hours later. */

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  API_PREFIX: z.string().default("api/v1"),

  DATABASE_URL: z.string().min(1),
  /** Optional read-replica connection string. Absent means reads use the
      primary — single-node behaviour is unchanged. */
  DATABASE_REPLICA_URL: z.string().optional(),

  /* Runtime secret resolution (see packages/database/src/secrets.ts). When
     these ARNs are set, main() resolves the values from Secrets Manager at
     cold start and assigns them onto DATABASE_URL / JWT_ACCESS_SECRET /
     JWT_REFRESH_SECRET before this schema runs — so by the time we parse, the
     resolved secrets are already present and validate under the rules below.
     They are optional passthroughs: absent on every non-AWS profile (local
     dev, compose, single-node, Kubernetes), which keeps the escape hatch
     byte-identical. DATABASE_HOST/PORT/NAME fill any fields a password-only
     rotation secret omits when assembling the URL. */
  DATABASE_SECRET_ARN: z.string().optional(),
  JWT_ACCESS_SECRET_ARN: z.string().optional(),
  JWT_REFRESH_SECRET_ARN: z.string().optional(),
  GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN: z.string().optional(),
  DATABASE_HOST: z.string().optional(),
  DATABASE_PORT: z.string().optional(),
  DATABASE_NAME: z.string().optional(),
  DATABASE_SSL: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /** Opt out of TLS certificate verification (VPC/self-signed only; insecure
      across untrusted networks). Defaults to off, i.e. verification is on. */
  DATABASE_SSL_NO_VERIFY: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  /** PEM contents of a CA bundle used to verify the DB server certificate. */
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),

  /* Two separate secrets. If one key signed both, a stolen access token could
     be replayed as a refresh token and never expire. */
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),

  /** Where the dashboard lives. Used for CORS, for links in emails, and (since
      #650) as the destination origin of every published bio page's managed
      link — so it MUST be a valid absolute http(s) URL. The localhost default
      is for local dev / CI; a real deployment sets its own origin. */
  WEB_ORIGIN: z
    .string()
    .url("WEB_ORIGIN must be an absolute URL, e.g. https://app.example.com")
    .refine((v) => /^https?:\/\//i.test(v), "WEB_ORIGIN must use http or https")
    .default("http://localhost:3000"),
  /** OPTIONAL extra CORS origins, comma/space separated (e.g.
      chrome-extension://<id> for the browser extension). Empty by default, so
      production CORS stays exactly [WEB_ORIGIN] and current behaviour is
      byte-identical. Only widens the allowlist when an operator sets it. */
  EXTENSION_ORIGINS: z.string().optional(),
  /** The default short domain new workspaces get. */
  DEFAULT_DOMAIN: z.string().default("localhost:3002"),
  /** Where redirects are served from, for building short URLs in responses. */
  REDIRECT_ORIGIN: z.string().default("http://localhost:3002"),

  /* Off by default because it needs a key I do not have. With it off, links
     are created as "clean" — which means the UI's "scanned on creation" claim
     is not true. Either set this or soften the copy. See docs/DECISIONS.md A10. */
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional(),

  /* #993 — the bot-protection (sign-up challenge) secret key. The PROVIDER
     (turnstile/hcaptcha/none) is chosen at runtime from platform settings; this
     is the matching server-side secret the siteverify call needs. Resolved from
     SSM like the rest of config on AWS (via the _SECRET_ARN below) and from .env
     locally. Kept OUT of platform settings on purpose (#972 keeps secrets out of
     that store). When the provider is on but this is unset, register fails
     closed — a sign-up gate that cannot verify must refuse, not wave everyone
     through. See docs/DECISIONS.md D2. */
  BOT_PROTECTION_SECRET: z.string().optional(),
  BOT_PROTECTION_SECRET_ARN: z.string().optional(),

  /* #968 — the platform-admin allowlist. Comma-separated emails, resolved from
     SSM like the rest of config on AWS and from .env locally. A user is a
     platform admin ONLY if their VERIFIED email is in this list (compared
     case-insensitively) AND they have 2FA enabled — the guard checks all three
     against the live user row, so a stale token or a config typo fails closed.
     Empty/absent means NO platform admins, which is the safe default: the role
     cannot be granted from inside the app, only by an operator editing this. */
  PLATFORM_ADMIN_EMAILS: z.string().optional(),

  /* OAuth sign-in. Each provider is enabled by the presence of its client id
     and switched off by its absence, so a deployment that has not set one up
     simply does not offer it. The client id is public — it ships in the page
     that starts the flow — so neither of these is a secret. */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  APPLE_OAUTH_CLIENT_ID: z.string().optional(),

  /** Local dev writes mail to an outbox dir instead of sending. */
  MAIL_TRANSPORT: z.enum(["outbox", "ses"]).default("outbox"),
  /** Where the outbox transport writes; defaults to os.tmpdir()/snapurl-outbox
      so it works on Lambda's read-only FS (only /tmp is writable) and locally.
      Optional so nothing else changes. */
  MAIL_OUTBOX_DIR: z.string().optional(),
  MAIL_FROM: z.string().default("SnapURL <no-reply@snapurl.local>"),
  /** The AWS region for SES calls (the platform-analytics email figures and,
      implicitly, SendEmail). On Lambda the runtime sets AWS_REGION and the SDK
      reads it by default; this lets the SES reader pin it explicitly (the stack
      is ap-south-1). Optional so the outbox/local profile needs nothing set. */
  AWS_REGION: z.string().optional(),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(120),

  /* #994 point 3 — auto-quarantine. When a single link accumulates this many
     DISTINCT abuse reports (counting dismissed ones out, and deduping repeat
     reports from the same contact), it is automatically disabled pending admin
     review and its owner is notified. Default 3; set to 0 to turn
     auto-quarantine off entirely (reports still queue for manual review). */
  ABUSE_QUARANTINE_THRESHOLD: z.coerce.number().int().min(0).default(3),

  /* #993 — the COMPILED-IN default for the new-account link-cap window, in
     days. The caps (per-day / per-hour link limits for a workspace's first N
     days) are a runtime platform setting; this env var is only the fallback
     the settings store uses when no admin has set newAccountLimits. Production
     leaves it at 7 (the brief's default). The compose/local test environment
     sets it to 0 to turn the caps OFF, so the smoke harness — which creates
     dozens of links through one account — is not throttled, WITHOUT weakening
     the production default. The caps are proven by the API integration tests,
     not the smoke suite. */
  NEW_ACCOUNT_LINK_WINDOW_DAYS: z.coerce.number().int().min(0).max(365).default(7),

  /* Which CacheStore backs the rate-limit counters (and, in the redirect
     service, hot-link caching). 'memory' is the default: a per-instance
     in-memory counter, byte-for-byte the single-node/CI behaviour. 'redis'
     shares one counter across instances so the limit is honoured globally —
     the multi-instance fix; 'dynamodb' is the AWS serverless profile. See
     docs/DECISIONS.md for the per-profile reasoning. */
  CACHE_DRIVER: z.enum(["memory", "redis", "dynamodb"]).default("memory"),
  /** Only used when CACHE_DRIVER=redis: the ioredis connection URL. Absent on
      every other profile, so the default memory driver needs nothing set. */
  REDIS_URL: z.string().optional(),
  /** Only used when CACHE_DRIVER=dynamodb: the cache table name. The DynamoDB
      adapter exists in code; the CDK table itself is a Phase-7 follow-up. */
  CACHE_DYNAMO_TABLE: z.string().optional(),

  /* How many proxies in front of this service APPEND their edge IP to
     X-Forwarded-For. The throttler derives the real client IP as the
     (TRUSTED_PROXY_HOPS+1)th entry from the right of that chain, so a
     client rotating the header cannot reset any limit.
     0 = direct/local dev and compose (no trusted appending proxy).
     Production sets it to the actual count, e.g. CloudFront=1, or
     CloudFront + an appending API Gateway HTTP API v2 = 2. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  /* #986 — billing (epic #991). OFF BY DEFAULT: with BILLING_PROVIDER=none the
     whole billing surface is unreachable (the controller 404s) and a
     self-hosted / open-source build behaves exactly as today. Turn it on with
     BILLING_PROVIDER=razorpay, which also needs the two keys below (plus
     RAZORPAY_WEBHOOK_SECRET) — the provider reports itself disabled, and the
     routes stay 404, until they are present, so a half-configured deploy fails
     closed rather than half-open. */
  BILLING_PROVIDER: z.enum(["none", "razorpay"]).default("none"),
  /* The Razorpay key id is PUBLIC — it ships in the checkout page — so it is
     not a secret and is passed as a plain env var. The key SECRET and the
     webhook secret ARE secrets: locally they live in the gitignored
     apps/api/.env; on AWS they are resolved from Secrets Manager at cold start
     (RAZORPAY_SECRET_ARN), exactly like the DB/JWT/Safe-Browsing keys. All
     three are optional passthroughs so the default none profile needs nothing. */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** HMAC-SHA256 key Razorpay signs each webhook body with. Verified on every
   *  incoming webhook; a request whose X-Razorpay-Signature does not match is
   *  rejected and changes nothing. */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** ARN/name of a Secrets Manager secret (JSON) holding keySecret and
     webhookSecret, resolved at cold start the same way as the other secrets.
     Absent on every non-AWS profile. */
  RAZORPAY_SECRET_ARN: z.string().optional(),
  /* The provider plan ids per (plan key, interval), resolved from config rather
     than hardcoded: a plan's price lives at the provider, and #970/#987 make the
     catalogue editable, so the code only ever names a KEY and looks up the id.
     Format: comma-separated `planKey:interval=providerPlanId` pairs, e.g.
     "pro:monthly=plan_ABC,pro:yearly=plan_DEF". Empty by default. */
  RAZORPAY_PLAN_IDS: z.string().optional(),

  /* #394: on the AWS profile, a newly-created/edited link is invisible to the
     redirect for up to ~60s — the projection_outbox row it lands in is only
     drained on the worker's 1-minute EventBridge schedule. Setting this to the
     deployed WorkerFn's name makes every projectionOutbox enqueue also fire an
     async (fire-and-forget) Lambda Invoke carrying {"task":"projection"}, so
     the drain usually runs within a second instead of waiting out the
     schedule. Absent on every non-AWS profile (local dev, compose,
     single-node, Kubernetes) — there the outbox is drained locally or is a
     no-op (LINK_PROJECTION=none), so nothing to nudge. See ProjectionNudge. */
  WORKER_FUNCTION_NAME: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}\n\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}

/**
 * The platform-admin allowlist as a normalised set of lower-cased emails.
 *
 * Parses PLATFORM_ADMIN_EMAILS: split on commas, trim, drop blanks, lower-case.
 * An absent or all-whitespace value yields an EMPTY set — i.e. no platform
 * admins — which is the deliberate default. Lower-casing here means the guard
 * compares `has(email.toLowerCase())` and never has to think about case again,
 * matching how `users.email` is uniquely indexed on `lower(email)`.
 */
export function platformAdminEmails(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

export const ENV = Symbol("ENV");
