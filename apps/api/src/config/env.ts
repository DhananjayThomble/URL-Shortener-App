import { z } from "zod";

/* Config is validated once at boot and never read from process.env again.
   A missing JWT secret should stop the process on startup, not surface as a
   401 three hours later. */

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3001),
  API_PREFIX: z.string().default("api/v1"),

  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  DATABASE_POOL_MAX: z.coerce.number().int().default(10),

  /* Two separate secrets. If one key signed both, a stolen access token could
     be replayed as a refresh token and never expire. */
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().default(30),

  /** Where the dashboard lives. Used for CORS and for links in emails. */
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
  /** The default short domain new workspaces get. */
  DEFAULT_DOMAIN: z.string().default("localhost:3002"),
  /** Where redirects are served from, for building short URLs in responses. */
  REDIRECT_ORIGIN: z.string().default("http://localhost:3002"),

  /* Off by default because it needs a key I do not have. With it off, links
     are created as "clean" — which means the UI's "scanned on creation" claim
     is not true. Either set this or soften the copy. See docs/DECISIONS.md A10. */
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().optional(),

  /** Local dev writes mail to logs/outbox instead of sending. */
  MAIL_TRANSPORT: z.enum(["outbox", "ses"]).default("outbox"),
  MAIL_FROM: z.string().default("SnapURL <no-reply@snapurl.local>"),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(120),

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
