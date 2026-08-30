/* eslint-disable */
/*
 * RedirectViewerRequest — CloudFront viewer-request function (runtime JS_2_0).
 *
 * Two jobs, in order:
 *
 *   1. x-forwarded-host (#274). The origin is a Lambda Function URL, which
 *      rejects any request whose Host is not its own, so CloudFront pins Host
 *      to the origin and this function copies the viewer's Host into
 *      x-forwarded-host for the redirect app to read. This MUST happen on every
 *      path, including the fall-through, or the Lambda cannot resolve the
 *      viewer's domain.
 *
 *   2. The KeyValueStore edge fast path (#289). For a plain, unconditional
 *      link, the worker writes a KVS entry `{ destination, redirectType }` keyed
 *      by `<host>/<slug>` (see kvsKey in @snapurl/database/link-projection). If
 *      this is a bare GET of a single slug and the KVS has a matching entry, the
 *      function returns the redirect itself — no Lambda invocation, no DynamoDB,
 *      no VPC. Anything it cannot answer (any failed guard, a KVS miss, or any
 *      error) returns the request unchanged so CloudFront forwards it to the
 *      Lambda origin, which stays authoritative.
 *
 * Testability: CloudFront's global `cloudfront` module is runtime-only and
 * cannot be imported by vitest. The decision logic therefore lives in a pure
 * `decide(event, kvsGet)` that takes an injectable KVS getter; `handler`
 * supplies the real `cf.kvs().get`. Because the `import cf from "cloudfront"`
 * above cannot be resolved by vitest, the test imports an identical twin of
 * `decide`/`edgeKey` from redirect-viewer-request.logic.mjs and asserts the two
 * are byte-for-byte identical (the DRIFT-GUARDED REGION below), so the tested
 * logic is provably the deployed logic.
 *
 * NOTE: keep this file small and dependency-free — CloudFront Functions have
 * tight CPU and size limits, and only a subset of JS is available.
 */

import cf from "cloudfront";

/*
 * The KVS key for a viewer host + slug MUST match kvsKey() in
 * @snapurl/database/src/link-projection.ts byte-for-byte: `<host>/<slug>`, host
 * lowercased (normaliseHost also trims, but a Host header carries no
 * surrounding whitespace), slug lowercased.
 *
 * `decide` is the pure decision logic: returns either a redirect response
 * object (KVS hit) or the (mutated: x-forwarded-host set) request to forward to
 * the origin. `kvsGet` is async (key) => string, throwing on miss or error.
 */
// --- DRIFT-GUARDED REGION START (must match redirect-viewer-request.logic.mjs) ---
function edgeKey(host, slug) {
  return host.toLowerCase() + "/" + slug.toLowerCase();
}

async function decide(event, kvsGet) {
  var request = event.request;

  /* (1) x-forwarded-host on EVERY path, before any short-circuit. */
  if (request.headers.host && request.headers.host.value) {
    request.headers["x-forwarded-host"] = { value: request.headers.host.value };
  }

  /* (2) Guards — mirror apps/redirect/src/main.ts conservatively. Only a bare
     GET of a single slug is eligible; anything else falls through. */

  // Method: GET only (OPTIONS/HEAD/POST fall through).
  if (request.method !== "GET") return request;

  // The unlock token rides ?k=. Its presence means a password flow — fall
  // through so the Lambda can validate it.
  if (request.querystring && Object.prototype.hasOwnProperty.call(request.querystring, "k")) {
    return request;
  }

  // Path must be exactly one non-empty segment: "/slug". Reject the root "/",
  // and reject multi-segment paths ("/a/b").
  var uri = request.uri || "";
  if (uri.charAt(0) !== "/") return request;
  var rest = uri.slice(1);
  if (rest.length === 0) return request; // root
  if (rest.indexOf("/") !== -1) return request; // multi-segment

  var slug = rest;

  // The "+" trust-preview convention (WEB_ORIGIN/p/...) is a Lambda concern.
  if (slug.charAt(slug.length - 1) === "+") return request;

  // Host is required to build the key.
  if (!request.headers.host || !request.headers.host.value) return request;
  var host = request.headers.host.value;

  var key = edgeKey(host, slug);

  /* (3) KVS lookup. Any miss or error falls through to the origin. */
  try {
    var raw = await kvsGet(key);
    if (!raw) return request;
    var parsed = JSON.parse(raw);
    if (!parsed || !parsed.destination) return request;

    var statusCode = parsed.redirectType === "301" ? 301 : 302;
    return {
      statusCode: statusCode,
      statusDescription: statusCode === 301 ? "Moved Permanently" : "Found",
      headers: {
        location: { value: parsed.destination },
        // Match the app's cacheHeadersFor(): never let a browser cache a
        // redirect, so "change where it points forever" holds.
        "cache-control": { value: "no-store, no-cache, must-revalidate" },
      },
    };
  } catch (e) {
    return request;
  }
}
// --- DRIFT-GUARDED REGION END ---

async function handler(event) {
  return decide(event, function (key) {
    return cf.kvs().get(key);
  });
}

export { handler, decide, edgeKey };
