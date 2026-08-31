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

  /** Where the dashboard lives. Used for CORS and for links in emails. */
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
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

  THROTTLE_TTL_SECONDS: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(120),

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

export const ENV = Symbol("ENV");
