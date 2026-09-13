/* eslint-disable */
/*
 * RedirectViewerRequest — CloudFront viewer-request function (runtime JS_2_0).
 *
 * Sets x-forwarded-host on EVERY path (#274), then serves the KeyValueStore edge
 * fast path (#289/#395) when it can, falling through to the Lambda origin — which
 * stays authoritative — on any failed guard, KVS miss or error.
 *
 * SIZE BUDGET: CloudFront caps a function at 10 KB and exceeding it fails ONLY at
 * deploy time (CFN UPDATE_FAILED, "Status Code: 413"), after tests and cdk diff
 * have all passed. That is not hypothetical: this file reached 11336 bytes and
 * broke a production deploy, of which 7499 bytes were comments. So the full
 * rationale — why the encoder must match URLSearchParams byte-for-byte, why an
 * integer-like query key declines, the lone-surrogate divergence, and why there
 * is no `export` — now lives in infra/functions/README.md. Keep this file terse
 * and read that before changing anything here. A test enforces the budget.
 */

import cf from "cloudfront";

// --- DRIFT-GUARDED REGION START (must match redirect-viewer-request.logic.mjs) ---
// Must equal kvsKey() in @snapurl/database/src/link-projection.ts byte-for-byte.
function edgeKey(host, slug) {
  return host.toLowerCase() + "/" + slug.toLowerCase();
}

/* URLSearchParams-compatible encoding, hand-rolled: JS 2.0 has no URL and no
   URLSearchParams. These six substitutions ARE the whole difference from
   encodeURIComponent; a property test asserts it against Node's real
   URLSearchParams. Throws URIError on a lone surrogate — decide()'s try/catch
   turns that into a fall-through. See README. */
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

/* URLSearchParams.set semantics, as buildDestination applies: replace the FIRST
   occurrence IN PLACE (keeping the destination's position), drop later
   duplicates, append when absent. */
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

/* Parsed querystring -> ordered pairs, last value of a repeated key. Returns
   null when order is unrecoverable: an integer-like key enumerates FIRST, so
   "?a=1&0=2" cannot be reordered back and a wrongly-ordered Location would be
   incorrect — the Lambda still has the raw query, so decline. See README. */
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

/* Location for a KVS hit, or null = fall through. Mirrors buildDestination for
   the edge-eligible subset (isEdgeEligible forces utm == null, so the forwarded
   query is the only transform left). Neither side parses a URL: the writer
   stored base/params/hash decomposed, and both serialise the same pairs. */
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

async function handler(event) {
  return decide(event, function (key) {
    return cf.kvs().get(key);
  });
}

/* NO `export` STATEMENT, and no second `import`: CloudFront rejects either
   ("SyntaxError: Illegal export statement") and an invalid function answers
   EVERY request with 503 rather than falling through — one line takes the whole
   redirect path down. The runtime finds `handler` as a global. `decide` is
   tested via the byte-identical twin in redirect-viewer-request.logic.mjs.
   Full reasoning in infra/functions/README.md. */
