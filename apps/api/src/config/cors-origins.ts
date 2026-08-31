/* Resolving the CORS `origin` option is small but load-bearing: getting it
   wrong either locks the dashboard out or opens the API to any site. Keeping it
   a pure function lets us pin every branch in a unit test with no Nest bootstrap
   and no live server. */

export interface ResolveCorsOriginsInput {
  /** The validated NODE_ENV. Development reflects any origin. */
  nodeEnv: "development" | "test" | "production";
  /** Where the dashboard lives; always allowed. */
  webOrigin: string;
  /** OPTIONAL, empty by default. A comma/space-separated list of extra origins
      (e.g. chrome-extension://<id>) an operator opts into. When unset the
      production allowlist is exactly [webOrigin]. */
  extensionOrigins: string | undefined;
}

/** Returns a value @fastify/cors accepts for its `origin` option:
    `true` in development (reflect any origin, matching the previous behaviour),
    or a string[] allowlist in production/test. With no EXTENSION_ORIGINS set the
    array is exactly [webOrigin] — byte-identical to the previous hard-coded
    [env.WEB_ORIGIN]. Any configured extension origins are trimmed, blank
    entries dropped, and duplicates (including a repeat of webOrigin) removed. */
export function resolveCorsOrigins({
  nodeEnv,
  webOrigin,
  extensionOrigins,
}: ResolveCorsOriginsInput): boolean | string[] {
  if (nodeEnv === "development") return true;

  const extras = (extensionOrigins ?? "")
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  /* A Set preserves insertion order while collapsing duplicates, so webOrigin
     stays first and a repeat of it (or of any extension origin) is dropped. */
  return [...new Set([webOrigin, ...extras])];
}
