import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

/**
 * Runtime resolution of the database and JWT secrets from AWS Secrets Manager.
 *
 * WHY this exists (see infra/lib/config.ts for the full history): the AWS
 * profile used to unwrap the generated RDS password and the JWT signing keys at
 * synth time, which placed those plaintext values into the Lambda environment
 * AND into the synthesized CloudFormation template. With NAT egress now in
 * place the functions can reach Secrets Manager at cold start, so the values
 * are resolved here at runtime instead of being baked into the template.
 *
 * ESCAPE HATCH FIRST: if the relevant *_SECRET_ARN env var is absent this
 * module makes ZERO SDK calls and returns the plain env value unchanged. That
 * keeps local dev, CI, docker-compose, the single-node profile and the
 * Kubernetes profile byte-identical to today — none of them have Secrets
 * Manager and must not be forced through it.
 *
 * CACHING: each resolved secret is cached at module scope keyed by ARN, so a
 * warm invocation (a reused execution environment) never re-fetches. Only the
 * first cold start of a given execution environment pays the lookup.
 */

/** Shape of an RDS-generated secret. `host`/`port`/`dbname` are present on the
 *  full connection secret but can be absent on a password-only rotation secret,
 *  in which case the DATABASE_HOST/PORT/NAME env vars fill the gap. */
interface RdsSecret {
  username: string;
  password: string;
  host?: string;
  port?: number | string;
  dbname?: string;
  engine?: string;
}

/** Module-level cache: resolved SecretString keyed by ARN. Persists for the
 *  lifetime of the execution environment (the whole point of the cache). */
const secretCache = new Map<string, string>();

/** Created lazily on first real fetch and reused thereafter. */
let client: SecretsManagerClient | undefined;

/** Bounded so an unreachable endpoint fails the cold start with an error in
 *  the logs, instead of hanging silently until the Lambda times out. The SDK
 *  default sets no socket timeout, and the API's bootstrap awaits this before
 *  the logger exists, so a blackholed NAT once produced 30s timeouts with no
 *  log line at all. Two attempts of at most ~5s each stay well inside the
 *  API's 30s timeout. */
export const SECRETS_CLIENT_CONFIG = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 2_000, requestTimeout: 5_000 },
} as const;

function getClient(): SecretsManagerClient {
  if (!client) client = new SecretsManagerClient(SECRETS_CLIENT_CONFIG);
  return client;
}

/** Fetch a secret's SecretString, caching it at module scope keyed by ARN so a
 *  second call for the same ARN never hits the network. */
async function fetchSecretString(arn: string): Promise<string> {
  const cached = secretCache.get(arn);
  if (cached !== undefined) return cached;

  const response = await getClient().send(new GetSecretValueCommand({ SecretId: arn }));
  const value = response.SecretString;
  if (value === undefined) {
    throw new Error(`Secret ${arn} has no SecretString (binary secrets are not supported).`);
  }
  secretCache.set(arn, value);
  return value;
}

/**
 * Resolve the database connection string.
 *
 * Escape hatch: with no DATABASE_SECRET_ARN set, returns env.DATABASE_URL as-is
 * and makes no SDK call.
 *
 * With DATABASE_SECRET_ARN set, fetches the RDS secret once, parses its JSON and
 * assembles `postgres://<username>:<password>@<host>:<port>/<dbname>`. When the
 * secret JSON omits host/port/dbname (a password-only rotation secret) the
 * DATABASE_HOST / DATABASE_PORT / DATABASE_NAME env vars supply them.
 */
export async function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const arn = env.DATABASE_SECRET_ARN;
  if (!arn) return env.DATABASE_URL;

  const raw = await fetchSecretString(arn);
  const secret = JSON.parse(raw) as RdsSecret;

  const username = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);
  const host = secret.host ?? env.DATABASE_HOST;
  const port = secret.port ?? env.DATABASE_PORT;
  const dbname = secret.dbname ?? env.DATABASE_NAME;

  if (!host || port === undefined || port === "" || !dbname) {
    throw new Error(
      "Database secret is missing host/port/dbname and DATABASE_HOST / DATABASE_PORT / DATABASE_NAME were not supplied to fill the gap.",
    );
  }

  return `postgres://${username}:${password}@${host}:${port}/${dbname}`;
}

/**
 * Resolve a JWT signing key.
 *
 * Escape hatch: when `arnEnvVar` is not set, returns the plain `plainEnvVar`
 * value unchanged and makes no SDK call. When it is set, fetches that secret's
 * SecretString (used verbatim as the signing key) and caches it.
 */
export async function resolveJwtSecret(
  arnEnvVar: string,
  plainEnvVar: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const arn = env[arnEnvVar];
  if (!arn) return env[plainEnvVar];
  return fetchSecretString(arn);
}

export interface ResolvedSecrets {
  databaseUrl: string | undefined;
  jwtAccessSecret: string | undefined;
  jwtRefreshSecret: string | undefined;
}

/**
 * Resolve all three secrets in one call. Each field independently honours its
 * escape hatch, so a deployment that provides only some ARNs still works.
 */
export async function resolveSecrets(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedSecrets> {
  const [databaseUrl, jwtAccessSecret, jwtRefreshSecret] = await Promise.all([
    resolveDatabaseUrl(env),
    resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", env),
    resolveJwtSecret("JWT_REFRESH_SECRET_ARN", "JWT_REFRESH_SECRET", env),
  ]);
  return { databaseUrl, jwtAccessSecret, jwtRefreshSecret };
}

/**
 * Resolve the Google Safe Browsing API key, never throwing.
 *
 * Unlike the DB and JWT secrets, this one is optional: without it the API runs
 * with Safe Browsing off. So a missing or unreadable secret must not fail the
 * cold start. The error is returned for the caller to log once a logger
 * exists, and the key is left unset.
 *
 * Escape hatch as above: with no GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN set,
 * returns the plain GOOGLE_SAFE_BROWSING_API_KEY (possibly undefined) and makes
 * no SDK call.
 */
export async function resolveSafeBrowsingApiKey(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ apiKey: string | undefined; error?: Error }> {
  try {
    const apiKey = await resolveJwtSecret(
      "GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN",
      "GOOGLE_SAFE_BROWSING_API_KEY",
      env,
    );
    return { apiKey: apiKey?.trim() || undefined };
  } catch (err) {
    return { apiKey: undefined, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/** Test-only: clears the module-level cache and lazily-created client so each
 *  unit test starts from a clean slate. Not part of the runtime contract. */
export function __resetSecretCacheForTests(): void {
  secretCache.clear();
  client = undefined;
}
