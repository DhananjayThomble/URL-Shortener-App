/*
 * Testable twin of the RedirectViewerRequest CloudFront Function's decision
 * logic (#289). See redirect-viewer-request.js for the full contract.
 *
 * WHY A SEPARATE FILE: the runtime function does `import cf from "cloudfront"`,
 * a module that only exists inside the CloudFront Functions runtime and cannot
 * be resolved by vitest. This file carries the SAME `edgeKey` and `decide`
 * (byte-for-byte, minus the `cf.kvs()` wiring which lives only in the runtime
 * `handler`) so the pure decision logic is unit-testable with an injectable
 * `kvsGet`. redirect-viewer-request.test.ts imports `decide`/`edgeKey` from
 * here AND asserts these two functions are identical to the ones in the runtime
 * file — that test is the guard against the twins drifting apart.
 *
 * The `edgeKey` format MUST match kvsKey() in
 * @snapurl/database/src/link-projection.ts: `<host>/<slug>`, both lowercased.
 */

// --- DRIFT-GUARDED REGION START (must match redirect-viewer-request.js) ---
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

export { decide, edgeKey };
