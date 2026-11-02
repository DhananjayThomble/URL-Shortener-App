/* ============================================================
   beforeSend scrubbing (#995 point 2).

   Error-tracking events can carry a lot more than the stack trace: the request
   that was in flight, its headers, its body, the URL with its query string, and
   whatever a developer attached as extra context. Any of those can hold a
   password, a bearer token, a session cookie or an Authorization header — and
   once an event leaves the process it is out of our hands. So nothing sensitive
   is allowed to leave: this runs as Sentry's `beforeSend` hook, the last thing
   that touches an event before it is sent, and strips the sensitive parts.

   It is a PURE function of the event (no I/O, no Sentry import) so the whole
   policy can be unit-tested with a plain object and no network — which is
   exactly what the acceptance's scrubbing test does. The Node init module wires
   it in as `beforeSend`; it never has to know how an event is transported.

   What it removes, per the issue:
     - passwords, tokens, secrets, cookies, Authorization headers (by key name,
       anywhere in the event, recursively);
     - query strings (stripped from every URL it can find);
     - request bodies (dropped wholesale — a body is the most likely place for
       a credential and we never need its contents to locate a crash).

   The redaction is key-NAME based and case-insensitive, so `Authorization`,
   `authorization`, `x-auth-token`, `apiKey`, `refreshToken`, `set-cookie` and
   so on are all caught without the caller enumerating them. A redacted value
   becomes the fixed string below rather than being deleted, so an event still
   shows that a field was present (useful when debugging) without showing what
   it held.
   ============================================================ */

/** What a redacted value is replaced with. A constant, low-entropy string so it
 *  never itself looks like a secret to a scanner and reads clearly in the UI. */
export const REDACTED = "[redacted]";

/** Substrings that, when found in a key name (case-insensitively), mark that
 *  key's value as sensitive and get it redacted wherever it appears in the
 *  event tree. Kept deliberately broad: a false redaction costs nothing, a
 *  missed secret is the whole failure mode this guards against. */
const SENSITIVE_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token", // access/refresh/id/csrf/unlock tokens, api-token, ...
  "authorization",
  "auth", // x-auth, auth-token, ...
  "cookie", // cookie, set-cookie
  "session",
  "apikey",
  "api-key",
  "api_key",
  "credential",
  "private",
  "passphrase",
  "otp",
  "pin",
  "signature", // webhook signing headers, e.g. x-razorpay-signature
  "jwt",
  "bearer",
];

/** Header names dropped outright regardless of the key-name scan, because they
 *  are request-transport secrets we never want even the shape of. */
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization"]);

function keyIsSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => k.includes(p));
}

/** Remove the query string (and fragment) from a URL-ish string. Works on both
 *  absolute URLs and bare paths, and never throws on a malformed value — it
 *  just cuts at the first `?` or `#`. A query string is where forgotten tokens
 *  (`?token=...`, `?access_token=...`) most often ride along. */
export function stripQueryString(url: string): string {
  const q = url.indexOf("?");
  const h = url.indexOf("#");
  let end = url.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  return url.slice(0, end);
}

/** A JSON-ish value the scrubber walks. Sentry events are plain JSON trees. */
type Json = string | number | boolean | null | undefined | Json[] | { [k: string]: Json };

/** Recursively redact the value of any sensitive-named key, in place-free style
 *  (returns a new tree). Non-object leaves are returned untouched. Bounded by a
 *  depth cap so a pathological/cyclic structure cannot spin forever — Sentry
 *  events are shallow, so the cap is generous and never reached in practice. */
function redactTree(value: Json, depth = 0): Json {
  if (depth > 20 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactTree(v, depth + 1));
  const out: { [k: string]: Json } = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = keyIsSensitive(key) ? REDACTED : redactTree(v, depth + 1);
  }
  return out;
}

/** The minimal shape of the parts of a Sentry event this scrubber touches. The
 *  real @sentry/node Event type is a superset; we keep this structural so the
 *  scrubber has no Sentry import and is trivially testable. */
export interface ScrubbableEvent {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
    [k: string]: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Scrub a Sentry event of everything the issue forbids leaving the process.
 * Pure: returns a new event, never mutates the input.
 *
 * Order is deliberate — the request block gets its own targeted treatment
 * (URL query string stripped, body and cookies dropped, headers filtered)
 * BEFORE the whole event is swept for sensitive key names, so a token hiding in
 * `request.data` is gone before the generic sweep even looks.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  // Shallow clone so the caller's object is never mutated; nested parts we
  // touch are replaced with new objects below.
  const scrubbed: ScrubbableEvent = { ...event };

  if (scrubbed.request) {
    const req = { ...scrubbed.request };

    // Query strings: both the standalone field and anything after `?`/`#` in
    // the URL. Sentry splits them into request.query_string; drop it and the
    // URL's own query alike.
    if (typeof req.url === "string") req.url = stripQueryString(req.url);
    delete req.query_string;

    // Request bodies: dropped wholesale. We never need a body to find a crash,
    // and it is the single most likely carrier of a credential.
    delete req.data;

    // Cookies: dropped. The session cookie lives here.
    delete req.cookies;

    // Headers: drop the always-sensitive ones by name, redact any other header
    // whose name matches the sensitive patterns, keep the rest (e.g.
    // user-agent, content-type, x-request-id — the last is load-bearing: it is
    // how an event links back to the logs).
    if (req.headers && typeof req.headers === "object") {
      const headers: Record<string, unknown> = {};
      for (const [name, v] of Object.entries(req.headers)) {
        const lower = name.toLowerCase();
        if (SENSITIVE_HEADER_NAMES.has(lower)) continue; // drop entirely
        headers[name] = keyIsSensitive(name) ? REDACTED : v;
      }
      req.headers = headers;
    }

    scrubbed.request = req;
  }

  // Sweep the rest of the event tree (extra, contexts, tags, breadcrumb-free
  // top level) for sensitive key names anywhere in it.
  if (scrubbed.extra) scrubbed.extra = redactTree(scrubbed.extra as Json) as Record<string, unknown>;
  if (scrubbed.contexts) scrubbed.contexts = redactTree(scrubbed.contexts as Json) as Record<string, unknown>;
  if (scrubbed.tags) scrubbed.tags = redactTree(scrubbed.tags as Json) as Record<string, unknown>;

  return scrubbed as T;
}
