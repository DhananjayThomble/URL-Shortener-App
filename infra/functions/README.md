# `redirect-viewer-request` — the CloudFront edge function

This holds the reasoning that used to live as comments inside
`redirect-viewer-request.js`. It moved here because **that file has a 10 KB
budget** and the prose was two-thirds of it. The knowledge is load-bearing —
several points below were found by a failing test or a broken deploy, not by
reading the code — so it is kept, just not somewhere that ships to the edge.

## The 10 KB limit, and how it bit

CloudFront caps a function's code at 10 KB (10240 bytes). Exceeding it fails
**only at deploy time**, as a CloudFormation `UPDATE_FAILED` on the
`AWS::CloudFront::Function` resource with:

```
Internal error reported from downstream service during operation
'(Service: CloudFront, Status Code: 413, ...)'
```

`413` is Payload Too Large. Nothing upstream catches it: the 79 unit tests pass,
`cdk synth` passes, `cdk diff` passes, the CI gate passes. On 2026-09-13 this
file was 11336 bytes — 3837 of code and 7499 of comments — and the production
deploy of the #395 edge query merge failed on it and auto-rolled back. Production
was unaffected, but the fix had been unshippable since the day it merged.

`redirect-viewer-request.test.ts` now asserts the byte size, so CI catches it.
If you add to this function, spend the budget on code.

## Why there are two files

CloudFront's global `cloudfront` module is runtime-only and cannot be imported by
vitest, so the decision logic lives in a pure `decide(event, kvsGet)` with an
injectable KVS getter; `handler` supplies the real `cf.kvs().get`.

Because `import cf from "cloudfront"` cannot be resolved under test, the tests
import an identical twin of the logic from `redirect-viewer-request.logic.mjs`
and assert the two are **byte-for-byte identical** between the
`DRIFT-GUARDED REGION` markers. That is what makes the tested logic provably the
deployed logic. Edit the region in the `.js` and re-splice it into the `.mjs`
(or vice versa) — never hand-edit one side.

Issue #357 extended this: the scaffolding *outside* the region (imports, the
handler declaration, any export) was unchecked yet can break the function
outright, so there are separate assertions pinning it.

## No `export`, and only one `import`

CloudFront rejects an export statement outright:

```
SyntaxError: Illegal export statement
```

and an **invalid function answers every request with 503** — it does *not* fall
through to the origin. One stray line took the whole redirect path down once.
`import cf from "cloudfront"` is a special case the runtime allows; that
exception does not extend to exports, or to a second import. The runtime finds
the entry point by looking for a global function named `handler`.

## Reproducing `URLSearchParams` without `URLSearchParams`

JS 2.0 provides only `Buffer`, `querystring` and `crypto` — there is no `URL` and
no `URLSearchParams`. The edge must nevertheless produce a `Location` **identical
to** what the Lambda's `buildDestination` produces, or the same link would
redirect differently depending on which side answered it.

The approach is deliberately not "two parsers that happen to agree". The writer
(`kvsValue` in `@snapurl/database/link-projection`) decomposes the destination in
Node using the real `URL` into `base` + `params` + `hash`, and **both sides
serialise the same pairs with the same algorithm**. That is what makes the bytes
agree.

`formEncode` is the hand-rolled encoder. `encodeURIComponent` already leaves
ASCII alphanumerics and `!'()*-._~` literal. The
`application/x-www-form-urlencoded` set differs in exactly two ways: space is `+`
not `%20`, and `!'()~` **are** escaped (`*`, `-`, `.` and `_` stay literal in
both). Those six substitutions are the entire difference. A property test asserts
this against Node's real `URLSearchParams` over generated input, plus an
exhaustive sweep of every non-surrogate BMP code point — rather than trusting the
reasoning above.

### The lone-surrogate divergence (deliberate)

One difference is left in place: `encodeURIComponent` **throws** `URIError` on a
lone surrogate, where `URLSearchParams` substitutes U+FFFD. `decide()` calls the
encoder inside its `try/catch`, so the throw becomes a fall-through to the
Lambda — a correct answer, just a slower one. A real query cannot carry a lone
surrogate anyway (malformed UTF-8 is replaced before it is a JS string). The test
pins this behaviour so it cannot change silently.

### Why an integer-like query key declines

`incomingPairs` returns `null` — decline, use the Lambda — when any incoming key
matches `/^(0|[1-9][0-9]*)$/`.

This runtime, like V8, enumerates **integer-like object keys first**, in ascending
numeric order, and only then string keys in insertion order. CloudFront hands the
querystring over as an *object* with no raw string available, so for `?a=1&0=2`
the object `{ a: …, 0: … }` enumerates `0` before `a` and the original
left-to-right order is genuinely unrecoverable. Since order decides the
serialised query, emitting a differently-ordered `Location` would be **wrong**;
falling through to the Lambda (which does still have the raw query) is correct.
Numeric query keys are rare, so this costs almost nothing.

Found by the differential property test, not by reading the code.

### `setParam` and `URLSearchParams.set` semantics

`buildDestination` applies `set()`, which replaces the **first** occurrence of a
key **in place** — so a key the destination already carries keeps the
*destination's* position, not the incoming query's — drops any later duplicates,
and appends when the key is absent. `setParam` reproduces exactly that.

The `k` unlock token is skipped when merging: it is ours, not the destination's,
and `buildDestination` skips it too.

## The KVS key

`edgeKey(host, slug)` must equal `kvsKey()` in
`@snapurl/database/src/link-projection.ts` byte-for-byte: `<host>/<slug>`, host
lowercased, slug lowercased. (`normaliseHost` also trims, but a `Host` header
carries no surrounding whitespace.)

## What the function is for

1. **`x-forwarded-host` (#274).** The origin is a Lambda Function URL, which
   rejects any request whose `Host` is not its own, so CloudFront pins `Host` to
   the origin and this function copies the viewer's `Host` into
   `x-forwarded-host`. This must happen on **every** path, including the
   fall-through, or the Lambda cannot resolve the viewer's domain.

2. **The KeyValueStore fast path (#289, extended by #395).** For an eligible
   link the worker writes a KVS entry keyed by `<host>/<slug>`; on a bare `GET`
   of a single slug with a matching entry, the function returns the redirect
   itself — no Lambda invocation, no DynamoDB, no VPC. Anything it cannot answer
   returns the request unchanged so CloudFront forwards it to the origin.

Guards mirror `apps/redirect/src/main.ts` conservatively: `GET` only, no `?k=`
(password flow), exactly one non-empty path segment, no trailing `+` (the
trust-preview convention), and a `Host` header present.
