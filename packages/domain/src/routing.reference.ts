/**
 * A REFERENCE implementation of SnapURL's routing chain. Never shipped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This file exists to DISAGREE with `routing.ts`. It was written without reading
 * `routing.ts`, `routing.test.ts`, or anything under `apps/redirect/` — see
 * `routing.reference.md` for the sources it was derived from instead, and for the
 * rationale behind every assumption marked `[A1]`..`[A8]` below.
 *
 * It is deliberately naive: nested loops, no short-circuiting cleverness, no
 * memoisation, no early exits that are not semantically required. Optimised for
 * being obviously right when read aloud, not for speed. If you find yourself
 * making this faster, you are damaging the only thing it is for.
 *
 * Nothing here imports from `./routing.js`. Do not add such an import — an oracle
 * that consults the implementation is not an oracle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DeviceType, RoutingRule } from "@snapurl/contract";

/* ============================================================================
   Inputs
   ========================================================================= */

/**
 * The visitor, already resolved to the three dimensions `RoutingRule.when`
 * names. Header parsing (User-Agent sniffing, `CloudFront-Viewer-Country`) is a
 * separate concern and is not modelled here.
 *
 * `null`/`undefined` means "we do not know this about the visitor", which is a
 * real and common state: `scripts/smoke-redirect.sh` drives a request with a
 * User-Agent but no `CloudFront-Viewer-Country` at all.
 */
export interface ReferenceVisitor {
  /** ISO 3166-1 alpha-2 per docs/DECISIONS.md §7, in whatever case it arrived. */
  country?: string | null;
  /** A single resolved category. See [A2] for what a rule's `mobile` matches. */
  device?: DeviceType | null;
  /** One BCP-47 tag, most-preferred. For a raw header see `referencePreferredLanguages`. */
  language?: string | null;
  /**
   * The visitor's full ordered language preference, most-preferred first, when
   * known. Overrides `language` when present and non-empty. `"*"` is honoured as
   * a wildcard (RFC 9110 §12.5.4).
   */
  languages?: readonly string[] | null;
}

/** The subset of `Link` that decides where a click lands. */
export interface ReferenceLink {
  /** Where a click goes when no rule matches. Asserted by smoke-redirect.sh. */
  destination: string;
  rules?: readonly RoutingRule[] | null;
  /** ISO 8601. Null ⇒ already live. */
  activatesAt?: string | null;
  /** Where a click lands before `activatesAt`. Null ⇒ a "not live yet" page. */
  scheduledTo?: string | null;
  /** ISO 8601. Null ⇒ never expires. */
  expiresAt?: string | null;
  /** Where a click lands from `expiresAt` onwards. Null ⇒ a "gone" page. */
  expiresTo?: string | null;
  archived?: boolean | null;
}

/**
 * Which reading of the overlapping device categories to evaluate under.
 *
 * This switch exists ONLY so the differential test can quantify how much of the
 * divergence set is attributable to the single ambiguity in [A2]. The reference's
 * position is `"overlapping"`; `"strict"` is not an endorsement, it is a
 * measuring instrument. See `routing.reference.md` [A2].
 */
export type DeviceReading = "overlapping" | "strict";

export interface ReferenceOptions {
  /** ISO 8601 or epoch ms. Defaults to "no clock" ⇒ schedule gates are skipped. */
  now?: string | number | Date | null;
  deviceReading?: DeviceReading;
}

/* ============================================================================
   Outcome
   ========================================================================= */

export type ReferenceOutcome =
  /** A rule in the chain matched. `ruleId` is the winner's `id`. */
  | { kind: "rule"; url: string; ruleId: string; ruleIndex: number }
  /** Live, chain exhausted (or empty). */
  | { kind: "destination"; url: string }
  /** Before `activatesAt`, `scheduledTo` set. */
  | { kind: "scheduled"; url: string }
  /** At/after `expiresAt`, `expiresTo` set. */
  | { kind: "expired"; url: string }
  /** Before `activatesAt`, no `scheduledTo`. smoke-redirect.sh pins this at 404. */
  | { kind: "not-live"; url: null }
  /** At/after `expiresAt`, no `expiresTo`. Status code is unspecified — see the .md. */
  | { kind: "gone"; url: null }
  /** Archived. */
  | { kind: "unavailable"; url: null };

/* ============================================================================
   Field matchers — one per dimension of `RoutingRule.when`
   ========================================================================= */

/**
 * `""` and whitespace-only are treated as "no constraint", identical to null.
 * See [A5], second half: an untouched form field submits `""`.
 */
function isUnconstrained(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/**
 * [A8] Country: case-insensitive equality on the trimmed value.
 *
 * An unknown visitor country cannot satisfy a country constraint — the smoke
 * script depends on this ([A6] corollary): its iOS assertion sends no
 * `CloudFront-Viewer-Country` and still expects the `country: "IN"` rule to be
 * skipped in favour of the later `device: "ios"` rule.
 */
export function referenceCountryMatches(
  ruleCountry: string | null | undefined,
  visitorCountry: string | null | undefined,
): boolean {
  if (isUnconstrained(ruleCountry)) return true;
  if (isUnconstrained(visitorCountry)) return false;
  return ruleCountry!.trim().toLowerCase() === visitorCountry!.trim().toLowerCase();
}

/**
 * [A2] The set of rule `device` values a resolved visitor device satisfies.
 *
 * Written as an explicit table rather than a clever predicate so the claim is
 * legible: an iPhone is an `ios` device AND a `mobile` device.
 */
export function referenceDeviceCategories(
  visitorDevice: DeviceType,
  reading: DeviceReading = "overlapping",
): readonly DeviceType[] {
  if (reading === "strict") return [visitorDevice];
  switch (visitorDevice) {
    case "ios":
      return ["ios", "mobile"];
    case "android":
      return ["android", "mobile"];
    case "mobile":
      return ["mobile"];
    case "desktop":
      return ["desktop"];
  }
}

export function referenceDeviceMatches(
  ruleDevice: DeviceType | null | undefined,
  visitorDevice: DeviceType | null | undefined,
  reading: DeviceReading = "overlapping",
): boolean {
  if (ruleDevice === null || ruleDevice === undefined) return true;
  if (visitorDevice === null || visitorDevice === undefined) return false;
  return referenceDeviceCategories(visitorDevice, reading).includes(ruleDevice);
}

/**
 * [A4] Language: RFC 4647 §3.3.1 Basic Filtering, case-insensitive.
 *
 * Rule `en` matches visitor `en`, `en-US`, `en-us-posix`.
 * Rule `en-US` matches visitor `en-US`, `en-us-posix`; NOT `en`, NOT `en-GB`.
 *
 * Written as the literal two-clause definition from the RFC, not as a regex.
 */
export function referenceLanguageTagMatches(ruleLanguage: string, visitorLanguage: string): boolean {
  const rule = ruleLanguage.trim().toLowerCase();
  const visitor = visitorLanguage.trim().toLowerCase();
  if (visitor === "*") return true; // an Accept-Language wildcard accepts anything
  if (visitor === rule) return true;
  return visitor.startsWith(rule + "-");
}

/**
 * The visitor's language preference as an ordered list, most-preferred first.
 * `languages` wins over the single `language` when supplied.
 */
function visitorLanguageList(visitor: ReferenceVisitor): readonly string[] {
  const many = (visitor.languages ?? []).filter((tag) => !isUnconstrained(tag));
  if (many.length > 0) return many;
  if (!isUnconstrained(visitor.language)) return [visitor.language!];
  return [];
}

export function referenceLanguageMatches(
  ruleLanguage: string | null | undefined,
  visitor: ReferenceVisitor,
): boolean {
  if (isUnconstrained(ruleLanguage)) return true;
  const preferences = visitorLanguageList(visitor);
  // Naive on purpose: any of the visitor's accepted tags satisfying the rule is a
  // match. Preference ORDER is a tie-break between competing RULES, not a filter,
  // and the chain's own order already decides between rules ("first match wins").
  for (const tag of preferences) {
    if (referenceLanguageTagMatches(ruleLanguage!, tag)) return true;
  }
  return false;
}

/**
 * [A4] RFC 9110 §12.5.4 `Accept-Language`, naively: split on commas, read an
 * optional `;q=`, DROP `q=0` (explicitly not acceptable), sort by q descending,
 * preserve document order within a q value.
 *
 * Provided so the differential test can drive a raw header if the real evaluator
 * accepts one. Independent of any parser in this repository.
 */
export function referencePreferredLanguages(header: string | null | undefined): string[] {
  if (isUnconstrained(header)) return [];
  const items: { tag: string; q: number; order: number }[] = [];
  const parts = header!.split(",");
  for (let order = 0; order < parts.length; order += 1) {
    const raw = parts[order]!;
    const segments = raw.split(";").map((s) => s.trim());
    const tag = (segments[0] ?? "").trim();
    if (tag === "") continue;
    let q = 1;
    for (const segment of segments.slice(1)) {
      const [key, value] = segment.split("=").map((s) => s.trim());
      if ((key ?? "").toLowerCase() !== "q") continue;
      const parsed = Number(value);
      q = Number.isFinite(parsed) ? parsed : 1;
    }
    if (q <= 0) continue; // q=0 means "not acceptable"
    items.push({ tag, q, order });
  }
  items.sort((a, b) => (b.q !== a.q ? b.q - a.q : a.order - b.order));
  return items.map((item) => item.tag);
}

/* ============================================================================
   One rule
   ========================================================================= */

/**
 * [A1] AND across the three dimensions. [A3] `weight` is not consulted.
 *
 * Every field of `when` that carries a constraint must be satisfied; a field that
 * carries no constraint (`null`, absent, or `""`) constrains nothing. An entirely
 * empty `when` is therefore an unconditional catch-all — [A5].
 */
export function referenceRuleMatches(
  rule: RoutingRule,
  visitor: ReferenceVisitor,
  reading: DeviceReading = "overlapping",
): boolean {
  const when = rule.when ?? {};
  const countryOk = referenceCountryMatches(when.country, visitor.country);
  const deviceOk = referenceDeviceMatches(when.device, visitor.device, reading);
  const languageOk = referenceLanguageMatches(when.language, visitor);
  return countryOk && deviceOk && languageOk;
}

/* ============================================================================
   The chain
   ========================================================================= */

/**
 * First match wins — `packages/contract/src/link.ts:21`, verbatim.
 *
 * A plain forward scan, returning the first satisfied rule. No specificity
 * ranking, no scoring, no reordering: "first" is positional.
 */
export function referenceEvaluateChain(
  rules: readonly RoutingRule[] | null | undefined,
  visitor: ReferenceVisitor,
  reading: DeviceReading = "overlapping",
): { rule: RoutingRule; index: number } | null {
  const chain = rules ?? [];
  for (let index = 0; index < chain.length; index += 1) {
    const rule = chain[index]!;
    if (referenceRuleMatches(rule, visitor, reading)) {
      return { rule, index };
    }
  }
  return null;
}

/* ============================================================================
   Schedule gates + the chain: the whole decision
   ========================================================================= */

function instant(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Where does a click on this link land?
 *
 * [A7] Order: archived → not-yet-live → expired → routing chain → destination.
 * The live window is half-open: `[activatesAt, expiresAt)`.
 *
 * With no `now` supplied the schedule gates are skipped entirely, so this reduces
 * to "the chain, then the destination".
 */
export function referenceResolve(
  link: ReferenceLink,
  visitor: ReferenceVisitor,
  options: ReferenceOptions = {},
): ReferenceOutcome {
  const reading = options.deviceReading ?? "overlapping";

  if (link.archived === true) {
    return { kind: "unavailable", url: null };
  }

  const now = instant(options.now);
  if (now !== null) {
    const activatesAt = instant(link.activatesAt);
    // "When the link starts working" ⇒ live AT the boundary, so scheduled is
    // strictly before it.
    if (activatesAt !== null && now < activatesAt) {
      return isUnconstrained(link.scheduledTo)
        ? { kind: "not-live", url: null }
        : { kind: "scheduled", url: link.scheduledTo! };
    }

    const expiresAt = instant(link.expiresAt);
    // Expired AT the boundary and after it.
    if (expiresAt !== null && now >= expiresAt) {
      return isUnconstrained(link.expiresTo)
        ? { kind: "gone", url: null }
        : { kind: "expired", url: link.expiresTo! };
    }
  }

  const hit = referenceEvaluateChain(link.rules, visitor, reading);
  if (hit !== null) {
    return { kind: "rule", url: hit.rule.then, ruleId: hit.rule.id, ruleIndex: hit.index };
  }
  return { kind: "destination", url: link.destination };
}
