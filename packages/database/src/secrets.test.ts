import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Mock the AWS SDK so no real network call is ever made. `send` is a shared
   mock we assert call counts against; GetSecretValueCommand is a passthrough
   that records the SecretId it was constructed with so we can build the
   response accordingly. */
const send = vi.fn();

const { SecretsManagerClient } = vi.hoisted(() => ({
  SecretsManagerClient: vi.fn().mockImplementation(() => ({ send })),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient,
  GetSecretValueCommand: vi.fn().mockImplementation((input: { SecretId: string }) => ({ input })),
}));

import {
  __resetSecretCacheForTests,
  resolveDatabaseUrl,
  resolveJwtSecret,
  resolveSafeBrowsingApiKey,
  resolveSecrets,
} from "./secrets.js";

/** Build a send() implementation that returns a SecretString per ARN. */
function respondWith(byArn: Record<string, string>) {
  send.mockImplementation((command: { input: { SecretId: string } }) => {
    const secretString = byArn[command.input.SecretId];
    return Promise.resolve({ SecretString: secretString });
  });
}

const DB_ARN = "arn:aws:secretsmanager:us-east-1:111122223333:secret:db-abc";
const JWT_ARN = "arn:aws:secretsmanager:us-east-1:111122223333:secret:jwt-abc";

const RDS_SECRET = JSON.stringify({
  username: "snapurl",
  password: "s3cr3t",
  host: "db.internal.example",
  port: 5432,
  dbname: "snapurl",
  engine: "postgres",
});

describe("resolveDatabaseUrl", () => {
  beforeEach(() => {
    __resetSecretCacheForTests();
    send.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("escape hatch: returns plain DATABASE_URL and makes NO SDK call when DATABASE_SECRET_ARN is unset", async () => {
    const env = { DATABASE_URL: "postgres://local:local@localhost:5432/dev" };
    const result = await resolveDatabaseUrl(env);
    expect(result).toBe("postgres://local:local@localhost:5432/dev");
    expect(send).not.toHaveBeenCalled();
  });

  it("fetches once and assembles the URL from the RDS secret JSON", async () => {
    respondWith({ [DB_ARN]: RDS_SECRET });
    const result = await resolveDatabaseUrl({ DATABASE_SECRET_ARN: DB_ARN });
    expect(result).toBe("postgres://snapurl:s3cr3t@db.internal.example:5432/snapurl");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("caches: two calls for the same ARN call send() exactly once", async () => {
    respondWith({ [DB_ARN]: RDS_SECRET });
    const env = { DATABASE_SECRET_ARN: DB_ARN };
    const first = await resolveDatabaseUrl(env);
    const second = await resolveDatabaseUrl(env);
    expect(first).toBe(second);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("applies DATABASE_HOST/PORT/NAME overrides when the secret omits host/port/dbname", async () => {
    const passwordOnlySecret = JSON.stringify({ username: "snapurl", password: "s3cr3t" });
    respondWith({ [DB_ARN]: passwordOnlySecret });
    const result = await resolveDatabaseUrl({
      DATABASE_SECRET_ARN: DB_ARN,
      DATABASE_HOST: "override.example",
      DATABASE_PORT: "6543",
      DATABASE_NAME: "overridedb",
    });
    expect(result).toBe("postgres://snapurl:s3cr3t@override.example:6543/overridedb");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("throws when neither the secret nor env supply host/port/dbname", async () => {
    const passwordOnlySecret = JSON.stringify({ username: "snapurl", password: "s3cr3t" });
    respondWith({ [DB_ARN]: passwordOnlySecret });
    await expect(resolveDatabaseUrl({ DATABASE_SECRET_ARN: DB_ARN })).rejects.toThrow();
  });
});

describe("resolveJwtSecret", () => {
  beforeEach(() => {
    __resetSecretCacheForTests();
    send.mockReset();
  });

  it("escape hatch: returns the plain env value and makes NO SDK call when the ARN env var is unset", async () => {
    const env = { JWT_ACCESS_SECRET: "plain-access-secret" };
    const result = await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", env);
    expect(result).toBe("plain-access-secret");
    expect(send).not.toHaveBeenCalled();
  });

  it("fetches and returns the SecretString verbatim when the ARN env var is set", async () => {
    respondWith({ [JWT_ARN]: "fetched-jwt-signing-key" });
    const result = await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", {
      JWT_ACCESS_SECRET_ARN: JWT_ARN,
    });
    expect(result).toBe("fetched-jwt-signing-key");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("caches the JWT secret across calls for the same ARN", async () => {
    respondWith({ [JWT_ARN]: "fetched-jwt-signing-key" });
    const env = { JWT_ACCESS_SECRET_ARN: JWT_ARN };
    await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", env);
    await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", env);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("resolveSecrets", () => {
  beforeEach(() => {
    __resetSecretCacheForTests();
    send.mockReset();
  });

  it("full escape hatch: returns all plain env values with NO SDK calls", async () => {
    const env = {
      DATABASE_URL: "postgres://local:local@localhost:5432/dev",
      JWT_ACCESS_SECRET: "plain-access",
      JWT_REFRESH_SECRET: "plain-refresh",
    };
    const result = await resolveSecrets(env);
    expect(result).toEqual({
      databaseUrl: "postgres://local:local@localhost:5432/dev",
      jwtAccessSecret: "plain-access",
      jwtRefreshSecret: "plain-refresh",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("resolves each secret from its ARN when all ARNs are provided", async () => {
    const accessArn = `${JWT_ARN}-access`;
    const refreshArn = `${JWT_ARN}-refresh`;
    respondWith({
      [DB_ARN]: RDS_SECRET,
      [accessArn]: "access-key",
      [refreshArn]: "refresh-key",
    });
    const result = await resolveSecrets({
      DATABASE_SECRET_ARN: DB_ARN,
      JWT_ACCESS_SECRET_ARN: accessArn,
      JWT_REFRESH_SECRET_ARN: refreshArn,
    });
    expect(result).toEqual({
      databaseUrl: "postgres://snapurl:s3cr3t@db.internal.example:5432/snapurl",
      jwtAccessSecret: "access-key",
      jwtRefreshSecret: "refresh-key",
    });
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("Secrets Manager client", () => {
  beforeEach(() => {
    __resetSecretCacheForTests();
    send.mockReset();
    SecretsManagerClient.mockClear();
  });

  /* Regression: the client was built with `{}`, so no socket timeout. With the
     NAT instance blackholing traffic, GetSecretValue hung, the API bootstrap
     never reached its logger, and every request was a silent 30s Lambda
     timeout. A bounded client fails the cold start with a logged error. */
  it("is constructed with bounded connection/request timeouts and retries", async () => {
    respondWith({ [JWT_ARN]: "k" });
    await resolveJwtSecret("JWT_ACCESS_SECRET_ARN", "JWT_ACCESS_SECRET", { JWT_ACCESS_SECRET_ARN: JWT_ARN });

    expect(SecretsManagerClient).toHaveBeenCalledTimes(1);
    const config = SecretsManagerClient.mock.calls[0]![0] as {
      maxAttempts?: number;
      requestHandler?: { connectionTimeout?: number; requestTimeout?: number };
    };
    expect(config.requestHandler?.connectionTimeout).toBeGreaterThan(0);
    expect(config.requestHandler?.requestTimeout).toBeGreaterThan(0);
    const worstCaseMs =
      (config.maxAttempts ?? 3) * (config.requestHandler!.connectionTimeout! + config.requestHandler!.requestTimeout!);
    // Must fail well before the API Gateway / Lambda 30s timeout so the error is logged.
    expect(worstCaseMs).toBeLessThan(20_000);
  });
});

describe("resolveSafeBrowsingApiKey", () => {
  const SB_ARN = "snapurl/test/google-safe-browsing-api-key";

  beforeEach(() => {
    __resetSecretCacheForTests();
    send.mockReset();
  });

  it("escape hatch: returns the plain key and makes NO SDK call when the secret ARN is unset", async () => {
    const result = await resolveSafeBrowsingApiKey({ GOOGLE_SAFE_BROWSING_API_KEY: "plain-key" });
    expect(result).toEqual({ apiKey: "plain-key" });
    expect(send).not.toHaveBeenCalled();
  });

  it("returns no key and no error when neither is set (Safe Browsing off)", async () => {
    expect(await resolveSafeBrowsingApiKey({})).toEqual({ apiKey: undefined });
    expect(send).not.toHaveBeenCalled();
  });

  it("fetches the key from the secret and trims surrounding whitespace", async () => {
    respondWith({ [SB_ARN]: "  sb-key\n" });
    const result = await resolveSafeBrowsingApiKey({ GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN: SB_ARN });
    expect(result).toEqual({ apiKey: "sb-key" });
  });

  it("treats a blank secret as no key rather than sending an empty key to Google", async () => {
    respondWith({ [SB_ARN]: "   " });
    expect(await resolveSafeBrowsingApiKey({ GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN: SB_ARN })).toEqual({
      apiKey: undefined,
    });
  });

  /* The point of this resolver: the key is optional, so a secret that is
     missing, unreadable or denied must leave Safe Browsing off, not reject and
     take the API's cold start down with it. */
  it("never rejects: a failed fetch returns the error and no key", async () => {
    send.mockRejectedValue(new Error("ResourceNotFoundException: Secrets Manager can't find the specified secret."));
    const result = await resolveSafeBrowsingApiKey({ GOOGLE_SAFE_BROWSING_API_KEY_SECRET_ARN: SB_ARN });
    expect(result.apiKey).toBeUndefined();
    expect(result.error?.message).toMatch(/ResourceNotFoundException/);
  });
});
