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

/* One component, serialised the way URLSearchParams does. This runtime has no
   URL and no URLSearchParams (JS 2.0 provides only Buffer/querystring/crypto),
   so this is the hand-rolled equivalent — and it MUST match byte-for-byte, or the
   same link would redirect differently depending on whether the edge or the
   Lambda answered it.

   encodeURIComponent already leaves ASCII alphanumerics and !'()*-._~ literal.
   The application/x-www-form-urlencoded set differs in exactly two ways: space is
   "+" not "%20", and !'()~ ARE escaped ("*", "-", "." and "_" stay literal in
   both). Those six substitutions are the entire difference, and the property test
   in redirect-viewer-request.test.ts asserts this against Node's real
   URLSearchParams over generated input rather than trusting the reasoning.

   ONE divergence remains and is deliberately left alone: encodeURIComponent THROWS
   URIError on a lone surrogate, where URLSearchParams substitutes U+FFFD. decide()
   calls this inside its try/catch, so the throw becomes a fall-through to the
   Lambda — a correct answer, just a slower one — and a real query cannot carry a
   lone surrogate anyway (malformed UTF-8 is replaced before it is a JS string). */
function formEncode(s) {
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/~/g, "%7E");
}

function serialiseParams(pairs) {
  var out = "";
  for (var i = 0; i < pairs.length; i++) {
    if (i > 0) out += "&";
    out += formEncode(pairs[i][0]) + "=" + formEncode(pairs[i][1]);
  }
  return out;
}

/* URLSearchParams.set semantics, which is what buildDestination applies: replace
   the FIRST occurrence of the key IN PLACE — so a key the destination already has
   keeps the destination's position, not the incoming query's — and drop any later
   duplicates; append when the key is absent. */
function setParam(pairs, key, value) {
  var at = -1;
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === key) {
      at = i;
      break;
    }
  }
  if (at === -1) {
    pairs.push([key, value]);
    return pairs;
  }
  var out = [];
  for (var j = 0; j < pairs.length; j++) {
    if (j === at) out.push([key, value]);
    else if (pairs[j][0] !== key) out.push(pairs[j]);
  }
  return out;
}

/* CloudFront's already-parsed querystring -> ordered [key, value] pairs, taking
   the LAST value of a repeated key. That is exactly what iterating a
   URLSearchParams and calling set() for each pair leaves behind: the key sits at
   its first-appearance position carrying its last-seen value.

   Returns null when the order cannot be trusted. This runtime, like V8,
   enumerates INTEGER-LIKE object keys FIRST in ascending numeric order and only
   then string keys in insertion order — so for "?a=1&0=2" the object
   `{ a: .., 0: .. }` enumerates 0 before a and the original left-to-right order is
   genuinely unrecoverable, because CloudFront gives us an object and no raw query
   string. Since order decides the serialised query, emitting a differently-ordered
   Location would be WRONG; falling through to the Lambda (which does still have
   the raw query) is correct. A numeric query key is rare, so this costs almost
   nothing. Found by the differential property test, not by reading the code. */
function isIndexLike(name) {
  return /^(0|[1-9][0-9]*)$/.test(name);
}

function incomingPairs(qs) {
  var pairs = [];
  for (var name in qs) {
    if (!Object.prototype.hasOwnProperty.call(qs, name)) continue;
    if (isIndexLike(name)) return null;
    var entry = qs[name];
    if (!entry) continue;
    var value = typeof entry.value === "string" ? entry.value : "";
    if (entry.multiValue && entry.multiValue.length) {
      value = entry.multiValue[entry.multiValue.length - 1].value;
    }
    pairs.push([name, value]);
  }
  return pairs;
}

/* The Location for a KVS hit, or null meaning "fall through to the Lambda".
 *
 * Mirrors buildDestination for the edge-eligible subset: isEdgeEligible requires
 * utm == null, so the forwarded query is the ONLY transform left to reproduce.
 * Neither side parses a URL here — the writer stored the destination already
 * decomposed into base/params/hash, and both sides serialise the same pairs with
 * the same algorithm, which is what makes the bytes agree. */
function edgeLocation(parsed, querystring) {
  if (!parsed.forwardQuery) return parsed.destination;

  var incoming = incomingPairs(querystring || {});
  if (incoming === null) return null; // key order not recoverable — use the Lambda
  if (incoming.length === 0) return parsed.destination;

  // A destination the writer could not decompose carries no base — cannot merge.
  if (typeof parsed.base !== "string") return null;

  var merged = [];
  var base = parsed.params || [];
  for (var i = 0; i < base.length; i++) merged.push([base[i][0], base[i][1]]);
  for (var j = 0; j < incoming.length; j++) {
    // The unlock token is ours, not the destination's (buildDestination skips it).
    if (incoming[j][0] === "k") continue;
    merged = setParam(merged, incoming[j][0], incoming[j][1]);
  }

  var query = serialiseParams(merged);
  return parsed.base + (query.length ? "?" + query : "") + (parsed.hash || "");
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

    var location = edgeLocation(parsed, request.querystring);
    if (location === null) return request;

    var statusCode = parsed.redirectType === "301" ? 301 : 302;
    return {
      statusCode: statusCode,
      statusDescription: statusCode === 301 ? "Moved Permanently" : "Found",
      headers: {
        location: { value: location },
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

export { decide, edgeKey, edgeLocation, formEncode, serialiseParams };
