# `routing.reference.ts` — the assumptions this oracle encodes

This file documents every semantic decision made by
`packages/domain/src/routing.reference.ts`, and **where that decision came from**.

`routing.reference.ts` was written **without reading `routing.ts`,
`routing.test.ts`, or anything under `apps/redirect/`** (see the commit that
introduces it — it is the first commit on `qa/l2-domain-oracle` that touches
`packages/domain`, and it touches no other file in that package). That blindness
is the entire point: an oracle derived from the implementation cannot disagree
with the implementation, and therefore cannot find a bug that the implementation's
author and its test's author both got wrong.

## Sources used (and only these)

| Source | What it settled |
| --- | --- |
| `packages/contract/src/link.ts` | `RoutingRule` shape, `DeviceType` enum, nullability/optionality of every field, the comment **"One rule in a link's routing chain. First match wins."**, and the `activatesAt` / `scheduledTo` / `expiresAt` / `expiresTo` doc comments |
| `scripts/smoke-redirect.sh` | An executable HTTP-level spec: the `$RUN-geo` fixture (`country: IN` → `example.in/store`, then `device: ios` → `apps.apple.com/app`, destination `example.com/rest`) and the `== routing chain ==` / `== gates ==` assertion blocks |
| `docs/DECISIONS.md` | §7 of the numbered list: country comes from `CloudFront-Viewer-Country`, **ISO 3166-1 alpha-2**. The Profile-3 edge section: "a **blocking gate** the edge cannot evaluate: a password, routing rules, a click limit, an expiry, an activation time, archived, or a non-`clean` Safe-Browsing status" |
| `README.md`, `docs/BACKEND.md` | "exactly one implementation of where a visitor lands" — the invariant that makes an api/redirect divergence a bug by construction |
| RFC 4647 §3.3.1 (Basic Filtering), RFC 9110 §12.5.4 (`Accept-Language`) | Language-tag matching and `Accept-Language` precedence. Used deliberately as an *external* oracle, because the contract says nothing at all about language matching |
| `.kiro/steering/architecture.md` | "`packages/domain` is pure shared logic … Keep it side-effect-free and framework-agnostic" — the basis for the determinism invariant |

## What the contract actually determines

Only three things, and only one of them unambiguously:

1. **First match wins.** Stated verbatim in `link.ts:21`.
2. **Fall-through goes to `Link.destination`.** Asserted by the smoke script
   (`everyone else gets the default` → `example.com/rest`).
3. **`when` may be entirely empty**, because all three of `country`, `device` and
   `language` are `.nullable().optional()`, so `{}` is a *valid* `when` per the
   declared truth.

Everything else below is an assumption. **Each one of them is recorded as a
finding in `.qa-runs/l2-domain/findings.jsonl` with layer `contract`**, because an
ambiguity that had to be resolved by guessing is itself a defect in the
specification of behaviour that real traffic rides on.

---

## A1 — Multiple conditions in one `when` are **AND**

`when: { country: "IN", device: "ios" }` matches only a visitor who is *both* in
India *and* on iOS.

**Why.** `when` is a single object whose keys are constraints, not a list of
alternatives. If the intent were OR, the natural schema is
`when: z.array(Condition)` or `anyOf: [...]`; a flat object of independently
nullable narrowing fields reads as a conjunction in every rules engine
convention. The English also reads that way: "when country is IN and device is
iOS".

**The contract does not say so.** Under the OR reading, the `$RUN-geo` fixture
would still pass the smoke script (each of its rules sets exactly one field), so
the executable spec does not discriminate either. This is a guess.

## A2 — Device categories **overlap**: an iOS visitor also satisfies a `mobile` rule

`DeviceType` is `ios | android | desktop | mobile`. The reference treats the
visitor as belonging to a *set* of categories and a rule as satisfied if its
`device` is in that set:

| Resolved visitor device | Satisfies rule `device` |
| --- | --- |
| `ios` | `ios`, `mobile` |
| `android` | `android`, `mobile` |
| `mobile` | `mobile` |
| `desktop` | `desktop` |

**Why.** Under the alternative (strict equality) reading, a `mobile` rule matches
only a mobile device that is *neither* iOS *nor* Android — a rounding error of
real traffic, which would make `mobile` a near-useless thing to offer next to
`ios` and `android`. The reading in which `mobile` means "any phone" is the one a
person building a link expects when they pick it out of a dropdown.

**Consequence, and it is the sharp end of this whole exercise.** Combined with
"first match wins", ordering becomes load-bearing and **specificity does not
rescue you**: a chain of `[{mobile → A}, {ios → B}]` sends *every* iPhone to `A`
and `B` is dead code, whereas `[{ios → B}, {mobile → A}]` sends iPhones to `B`.
The contract offers no warning that one of those two orderings silently discards
a rule.

**Both readings are live.** If the implementation uses strict equality, that is
either (a) the implementation ignoring the only sensible meaning of `mobile`, or
(b) this reference over-reading it. The differential test reports the divergence
under *both* readings and quantifies how much of the divergence set is
attributable to this single question (`deviceReading` parameter, default
`"overlapping"`); it does not pick.

## A3 — `weight` does **not** participate in choosing a rule

The reference ignores `weight` entirely: first rule whose `when` is satisfied
wins, weight `0` and weight `100` behave identically.

**Why this, of three candidate readings.**

- *(i) Probabilistic fall-through* — "weight 40 means 40% of matching traffic
  takes it, 60% falls through". This **cannot be implemented by a pure
  function**, and `.kiro/steering/architecture.md` requires `packages/domain` to
  be "side-effect-free". Nothing in `RoutingRule`, `Link`, or any header
  documented in `DECISIONS.md` supplies a seed, a bucket key, or a visitor id
  that a deterministic split could key off. A `Math.random()` inside the shared
  evaluator would also break the invariant `README.md` sells — that the API's
  *validation* and the redirect's *execution* are one implementation — because
  the two would compute different answers for the same link.
- *(ii) Proportional split across all weighted rules* — same objection, plus the
  contract puts no constraint on the weights summing to 100, so the reading has
  no defined behaviour for a chain summing to 37 or to 420.
- *(iii) Stored but not evaluated* — consistent with purity, consistent with the
  one documented semantic ("first match wins"), and the only reading under which
  the field is harmless.

The reference takes (iii) **and the differential test separately asserts
determinism** (same rules + same visitor + same clock, evaluated 25 times, must
give one answer). That determinism assertion is oracle-backed independently of
which weight reading is right, so it is the more trustworthy of the two checks
here.

**A weight range of 0–100 that means nothing is itself worth reporting**: either
the evaluator drops a feature the schema advertises, or the schema advertises a
feature that does not exist. Filed as an ambiguity finding.

## A4 — `language` uses RFC 4647 Basic Filtering, case-insensitively

Rule `en` matches visitor `en-US`, `en-us`, `EN`, `en`. Rule `en-US` matches
visitor `en-US` and `en-us-posix`, but **not** bare `en` and **not** `en-GB`.
Formally: lowercase both, then match if `visitor === rule` or
`visitor.startsWith(rule + "-")`.

**Why.** The contract types `language` as a bare `z.string()` and says nothing
else — no format, no case rule, no mention of `Accept-Language`. Under exact
case-sensitive equality the feature is close to inert: browsers send `en-US`,
`en-GB`, `pt-BR`, so a rule written `en` would never fire and the author would
see no error anywhere. RFC 4647 §3.3.1 is the standard answer to exactly this
question and language tags are explicitly case-insensitive (RFC 5646 §2.1.1), so
it is the reading a careful implementer reaches for.

**`Accept-Language` precedence.** Because the reference cannot know whether the
real evaluator receives a resolved tag or a raw header, it also provides
`referencePreferredLanguages(header)`, implementing RFC 9110 §12.5.4 naively:
parse `tag;q=<n>` items, drop `q=0` (explicitly *not acceptable*), sort by `q`
descending, default `q=1`, and keep the original document order for ties. `*` is
kept as a wildcard token that satisfies any rule tag. The chain is then evaluated
against the visitor's most-preferred tag first.

## A5 — An empty `when` is an unconditional catch-all

`when: {}`, and equally `when: { country: null, device: null, language: null }`,
matches every visitor. Every rule after such a rule is unreachable.

**Why.** All three fields are `.nullable().optional()`, so the contract *declares*
`{}` valid — it is not an error state the schema is trying to prevent. An empty
conjunction is vacuously true. The alternative (treat it as invalid, or as
matching nobody) would mean the contract accepts a payload whose behaviour is
undefined, which is worse.

**Related, and a separate guess: the empty *string*.** A rule with
`country: ""` or `language: ""` is treated as **no constraint on that field**,
identical to `null`. Justification: `""` is what an untouched form field submits,
and `CreateLinkInput.slug` in the same contract file spells `.or(z.literal(""))`
explicitly — empty-string-as-absent is idiomatic here. The competing reading is
"a constraint that matches only a visitor whose country is unknown", which is a
thing nobody has ever deliberately asked for from a UI.

## A6 — No rule matches ⇒ the link's `destination`

Not a guess. `scripts/smoke-redirect.sh`: `everyone else gets the default` asserts
`example.com/rest`, the `$RUN-geo` link's `destination`, for a `FR` visitor
against a chain of `IN` and `ios` rules.

Corollary the reference also encodes: a visitor whose `country` is unknown
(`null`/absent) **cannot satisfy** a rule that constrains `country`. The smoke
script relies on this — `iOS goes to the App Store` sends no
`CloudFront-Viewer-Country` header at all and still expects the *second* rule
(`device: ios`) to win, which requires the first rule (`country: IN`) to fail
against an unknown country rather than to match permissively.

## A7 — The schedule outranks the routing chain, and the live window is `[activatesAt, expiresAt)`

Evaluation order in the reference:

1. `archived` ⇒ nothing is served (`unavailable`). Assumption: `DECISIONS.md`
   lists `archived` among the blocking gates the edge may not answer, and
   `LinkStatus` has no `archived → somewhere` fallback field the way `scheduled`
   and `expired` do.
2. `now < activatesAt` ⇒ status `scheduled` ⇒ `scheduledTo` if set, else
   `not-live` (the smoke script asserts **404**, and comments "404 rather than
   410: nothing is gone, it has not started", and explicitly that no fallback
   "must not fall through to the destination").
3. `now >= expiresAt` ⇒ status `expired` ⇒ `expiresTo` if set, else `gone`.
4. Otherwise the link is live: evaluate the routing chain, first match wins.
5. Otherwise `destination`.

**Boundary instants.** `activatesAt` is documented as "When the link starts
working", so at exactly `activatesAt` the link **is** live ⇒ `now >= activatesAt`.
`expiresAt` is the moment it expires, so at exactly `expiresAt` it **is** expired
⇒ `now >= expiresAt`. The live window is therefore half-open:
`[activatesAt, expiresAt)`. The contract states neither boundary; the smoke
script only ever uses dates decades away (`2020-01-01`, `2099-01-01`), so it does
not discriminate. Guess. The competing readings (`>` on either end) differ from
this one by exactly one millisecond of behaviour, which is precisely the kind of
thing that is never noticed and never tested.

**A link that is both not-yet-live and has a matching country rule** goes to
`scheduledTo`, not to the rule. Guess: `scheduledTo` is documented as "Where a
click lands *before* `activatesAt`" — unconditionally, with no carve-out for
rules. `DECISIONS.md` lists routing rules and activation times side by side as
blocking gates without ordering them.

**Contradictory schedule** (`activatesAt` in the future *and* `expiresAt` in the
past) resolves as `scheduled`, because step 2 runs first. Pure guess; the
contract does not forbid the combination and does not order it. The competing
reading (`expired` wins, because an expired link is more "final") is equally
defensible, and the two send the visitor to *different URLs*.

## A8 — Country matching is case-insensitive on a trimmed ISO 3166-1 alpha-2 code

Rule `in` matches visitor `IN`. **Why.** `DECISIONS.md` §7 fixes the value space
as ISO 3166-1 alpha-2, where case carries no meaning, and the header comes from
CloudFront (upper-case) while the rule comes from a form field (whatever was
typed). A case-sensitive comparison makes a lower-cased rule permanently dead
with no error surfaced anywhere. Guess — the contract's `z.string()` imposes no
case, no length, and no membership check, so `"Narnia"`, `"usa"` and `"🇮🇳"` are
all accepted rule values.

## What the reference deliberately does NOT model

These are gates, not routing, and they are out of scope for this oracle. They are
listed in `summary.md` under Coverage gaps:

- password / unlock tokens (`?k=`), `clickLimit`, Safe-Browsing status
- `deepLink` rewriting, `forwardQuery` merging, `utm` injection, `hideReferrer`
  — all applied *after* a destination is chosen, per `DECISIONS.md`
- the `expiring` status: `LinkStatus` includes it but **nothing in the contract or
  the docs states its window** (7 days? 24 hours?). The reference reports live
  links as `active` and this under-specification is filed as an ambiguity finding
  rather than guessed at, because a guessed threshold is not an oracle.
- the HTTP status code that accompanies `gone` (410 vs 404). The smoke script
  pins the *scheduled-with-no-fallback* case at 404 and its comment implies 410
  would be right for a genuinely expired link, but nothing asserts the expired-
  with-no-`expiresTo` case at all. The reference emits a distinct `gone` outcome
  and the differential test compares the chosen **URL**, not the status.
