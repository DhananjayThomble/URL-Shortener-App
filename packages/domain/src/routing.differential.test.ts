import { afterAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DeviceType, RoutingRule } from "@snapurl/contract";
import { evaluateRouting, validateRoutingChain, type VisitorContext } from "./routing.js";
import { deriveStatus } from "./destination.js";
import { parseLanguage } from "./visitor.js";
import {
  referenceDeviceMatches,
  referenceLanguageTagMatches,
  referencePreferredLanguages,
  referenceResolve,
  referenceRuleMatches,
  type DeviceReading,
  type ReferenceLink,
  type ReferenceOutcome,
  type ReferenceVisitor,
} from "./routing.reference.js";

/* ═══════════════════════════════════════════════════════════════════════════
   DIFFERENTIAL FUZZING: routing.reference.ts  vs  routing.ts

   Phase B of the L2 routing-oracle task. Phase A produced an
   implementation-blind reference (`routing.reference.ts`) plus a written
   register of every assumption it encodes (`routing.reference.md`, A1–A8).
   This file generates routing chains and visitor contexts, runs both
   evaluators, and reports every input on which they disagree.

   WHAT A FAILURE HERE MEANS — read this before "fixing" anything.

   A divergence is AMBIGUOUS by construction. Either the implementation is
   wrong, or the reference's assumption is wrong. This file does not decide;
   per `.kiro/steering/qa-oracles.md` §2 adjudication happens outside the run.
   Every assertion message therefore states BOTH readings. Nothing here is
   labelled a defect and nothing here is dismissed as a harness artifact.

   A RED result is the expected shape of output, not a broken test.

   ───────────────────────────────────────────────────────────────────────────
   THE IMPLEMENTATION SIDE OF THE COMPARISON

   `routing.ts` exports `evaluateRouting`, which covers the chain only — it
   has no clock and no schedule gates. The schedule half of the decision lives
   in two places:

     - `deriveStatus` in `packages/domain/src/destination.ts` (imported here), and
     - `gateFor` in `apps/redirect/src/main.ts`, which is module-private and in
       another app — `packages/domain` may not import `apps/*`
       (`.kiro/steering/architecture.md`), and importing `main.ts` would start a
       Fastify server.

   `implResolve` below therefore RECONSTRUCTS the redirect's composite decision
   from the domain exports, following `gateFor`'s own stated contract: its
   comment says "The order after 'flagged' is the same one `deriveStatus` uses",
   and its branches are `expired → link.expiresTo`, `scheduled → link.scheduledTo`,
   `scheduled` with no fallback → 404, `expired` with no fallback → 410. That
   reconstruction is a fidelity caveat, recorded in the run's Coverage gaps.
   Password, click-limit and Safe-Browsing gates are out of scope for the
   reference and are not modelled on either side.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Printed on every run and pinned in summary.md so any failure is replayable. */
const SEED = 20260914;

/** Census breadth. Deterministic given SEED. */
const CENSUS_RUNS = 20_000;
/** Per-hypothesis breadth. Deterministic given SEED. */
const TARGETED_RUNS = 3_000;

const READINGS: readonly DeviceReading[] = ["overlapping", "strict"];

/* ============================================================================
   Comparable outcome
   ========================================================================= */

interface Outcome {
  kind: ReferenceOutcome["kind"];
  url: string | null;
  /** The winning rule's id, or null when no rule won. */
  ruleId: string | null;
}

function sameOutcome(a: Outcome, b: Outcome): boolean {
  return a.kind === b.kind && a.url === b.url && a.ruleId === b.ruleId;
}

function show(o: Outcome): string {
  return `${o.kind}(${o.url ?? "—"}${o.ruleId === null ? "" : ` via ${o.ruleId}`})`;
}

/* ============================================================================
   A generated case
   ========================================================================= */

interface RawVisitor {
  country: string | null;
  device: DeviceType | null;
  /** A single resolved tag, fed to BOTH sides verbatim. */
  language: string | null;
  visitorHash: string;
}

interface Case {
  rules: RoutingRule[];
  destination: string;
  activatesAtMs: number | null;
  expiresAtMs: number | null;
  scheduledTo: string | null;
  expiresTo: string | null;
  archived: boolean;
  visitor: RawVisitor;
  nowMs: number;
  /** Set only by the Accept-Language section; overrides `visitor.language`. */
  acceptLanguage?: string | null;
}

const DEFAULT_DESTINATION = "https://default.example.com/";
const SCHEDULED_TO = "https://scheduled.example.com/";
const EXPIRES_TO = "https://expired.example.com/";
/** Never returned by a rule, so it cannot be confused with one. */
const PROBE_FALLBACK = "https://probe-fallback.invalid/";

/** The clock every generated case is evaluated against. */
const T = Date.parse("2026-06-15T12:00:00.000Z");

function ctxOf(c: Case): VisitorContext {
  return {
    country: c.visitor.country,
    device: c.visitor.device,
    language:
      c.acceptLanguage === undefined
        ? c.visitor.language
        : // The implementation's only header→context path.
          parseLanguage(c.acceptLanguage),
    visitorHash: c.visitor.visitorHash,
  };
}

function refVisitorOf(c: Case): ReferenceVisitor {
  if (c.acceptLanguage === undefined) {
    return { country: c.visitor.country, device: c.visitor.device, language: c.visitor.language };
  }
  return {
    country: c.visitor.country,
    device: c.visitor.device,
    // The reference's own header parser, RFC 9110 §12.5.4.
    languages: referencePreferredLanguages(c.acceptLanguage),
  };
}

function refLinkOf(c: Case): ReferenceLink {
  return {
    destination: c.destination,
    rules: c.rules,
    activatesAt: c.activatesAtMs === null ? null : new Date(c.activatesAtMs).toISOString(),
    scheduledTo: c.scheduledTo,
    expiresAt: c.expiresAtMs === null ? null : new Date(c.expiresAtMs).toISOString(),
    expiresTo: c.expiresTo,
    archived: c.archived,
  };
}

function refResolve(c: Case, reading: DeviceReading): Outcome {
  const out = referenceResolve(refLinkOf(c), refVisitorOf(c), { now: c.nowMs, deviceReading: reading });
  return { kind: out.kind, url: out.url, ruleId: out.kind === "rule" ? out.ruleId : null };
}

/**
 * The redirect service's composite decision, rebuilt from domain exports only.
 * See the header note for why it cannot simply import `gateFor`.
 */
function implResolve(c: Case): Outcome {
  const now = new Date(c.nowMs);
  const status = deriveStatus(
    {
      archivedAt: c.archived ? new Date(0) : null,
      expiresAt: c.expiresAtMs === null ? null : new Date(c.expiresAtMs),
      activatesAt: c.activatesAtMs === null ? null : new Date(c.activatesAtMs),
      clickLimit: null,
      clicks: 0,
    },
    now,
  );

  if (status === "archived") return { kind: "unavailable", url: null, ruleId: null };
  if (status === "expired") {
    return c.expiresTo
      ? { kind: "expired", url: c.expiresTo, ruleId: null }
      : { kind: "gone", url: null, ruleId: null };
  }
  if (status === "scheduled") {
    return c.scheduledTo
      ? { kind: "scheduled", url: c.scheduledTo, ruleId: null }
      : { kind: "not-live", url: null, ruleId: null };
  }

  // "active" and "expiring" are both live: the chain runs.
  const decision = evaluateRouting(c.rules, c.destination, ctxOf(c));
  return decision.matchedRuleId === null
    ? { kind: "destination", url: decision.destination, ruleId: null }
    : { kind: "rule", url: decision.destination, ruleId: decision.matchedRuleId };
}

/* ============================================================================
   Generators — adversarial, not merely random
   ========================================================================= */

/** Wrong case, unknown codes, blank, untrimmed, non-ISO junk. */
const COUNTRY_POOL = [
  "IN",
  "in",
  "In",
  "US",
  "us",
  "FR",
  "GB",
  "ZZ",
  "XX",
  "usa",
  "IND",
  "Narnia",
  "i",
  "",
  " ",
  "  ",
  " IN ",
  "IN ",
] as const;

/** Bare, regional, wrong case, three-level, blank, wildcard, junk. */
const LANGUAGE_POOL = [
  "en",
  "en-US",
  "EN",
  "en-us",
  "en-GB",
  "en-us-posix",
  "zh-Hant-TW",
  "zh",
  "fr",
  "pt-BR",
  "",
  " ",
  "*",
  "en_US",
  "EN-US",
  "e",
] as const;

const DEVICES: readonly DeviceType[] = ["ios", "android", "desktop", "mobile"];

/** 0 and 100 at the ends, a fractional value, plus both flavours of absent. */
const WEIGHT_POOL: Array<number | null | undefined> = [0, 1, 50, 99, 100, 33.33, null, undefined];

const ruleCountryArb = fc.constantFrom(...([...COUNTRY_POOL, null, undefined] as Array<string | null | undefined>));
const ruleLanguageArb = fc.constantFrom(...([...LANGUAGE_POOL, null, undefined] as Array<string | null | undefined>));
const ruleDeviceArb = fc.constantFrom(...([...DEVICES, null, undefined] as Array<DeviceType | null | undefined>));
const weightArb = fc.constantFrom(...WEIGHT_POOL);

interface RuleBody {
  country: string | null | undefined;
  device: DeviceType | null | undefined;
  language: string | null | undefined;
  weight: number | null | undefined;
}

const generalBodyArb: fc.Arbitrary<RuleBody> = fc.record({
  country: ruleCountryArb,
  device: ruleDeviceArb,
  language: ruleLanguageArb,
  weight: weightArb,
});

/**
 * An explicitly empty / all-null `when`, which the contract declares valid
 * (every field is `.nullable().optional()`) and reference A5 reads as an
 * unconditional catch-all.
 *
 * Generated as its own arbitrary rather than left to chance: drawing three
 * independent fields from the pools produces a catch-all under 1% of the time,
 * which starves every traversal-order hypothesis of inputs.
 */
const catchAllBodyArb: fc.Arbitrary<RuleBody> = fc.record({
  country: fc.constantFrom(...([null, undefined, ""] as Array<string | null | undefined>)),
  device: fc.constantFrom(...([null, undefined] as Array<DeviceType | null | undefined>)),
  language: fc.constantFrom(...([null, undefined, ""] as Array<string | null | undefined>)),
  weight: weightArb,
});

/** Roughly one rule in three is a catch-all. */
const ruleBodyArb: fc.Arbitrary<RuleBody> = fc.oneof(generalBodyArb, generalBodyArb, catchAllBodyArb);

/** `then` is derived from the position so the winning URL names the winning rule. */
function toRule(body: RuleBody, index: number): RoutingRule {
  return {
    id: `r${index}`,
    when: { country: body.country, device: body.device, language: body.language },
    then: `https://r${index}.example.com/`,
    weight: body.weight,
  };
}

/**
 * Chain lengths 0, 1, 2 and many, with deliberate duplicate-rule injection —
 * a duplicated rule is the case `validateRoutingChain` claims to reject, so it
 * is exactly where executor and validator can be caught disagreeing.
 */
const chainArb: fc.Arbitrary<RoutingRule[]> = fc
  .tuple(
    fc.array(ruleBodyArb, { minLength: 0, maxLength: 5 }),
    fc.nat({ max: 5 }),
    fc.nat({ max: 6 }),
    fc.boolean(),
  )
  .map(([bodies, which, where, duplicate]) => {
    const out = bodies.slice();
    if (duplicate && out.length > 0) {
      out.splice(Math.min(where, out.length), 0, { ...out[which % out.length]! });
    }
    return out.map((body, index) => toRule(body, index));
  });

const visitorHashArb = fc
  .array(
    fc.constantFrom(..."0123456789abcdef".split("")),
    { minLength: 8, maxLength: 32 },
  )
  .map((chars) => chars.join(""));

const rawVisitorArb: fc.Arbitrary<RawVisitor> = fc.record({
  country: fc.constantFrom(...([...COUNTRY_POOL, null] as Array<string | null>)),
  device: fc.constantFrom(...([...DEVICES, null] as Array<DeviceType | null>)),
  language: fc.constantFrom(...([...LANGUAGE_POOL, null] as Array<string | null>)),
  visitorHash: visitorHashArb,
});

/**
 * Exactly at, 1 ms before, and 1 ms after each schedule boundary, plus a day
 * either side so the contradictory window (activates ahead, expired behind) is
 * reachable.
 */
const OFFSET_POOL: Array<number | null> = [null, 0, 1, -1, 1_000, -1_000, 86_400_000, -86_400_000];
const offsetArb = fc.constantFrom(...OFFSET_POOL);

const caseArb: fc.Arbitrary<Case> = fc
  .record({
    rules: chainArb,
    activates: offsetArb,
    expires: offsetArb,
    scheduledTo: fc.constantFrom(...([SCHEDULED_TO, null] as Array<string | null>)),
    expiresTo: fc.constantFrom(...([EXPIRES_TO, null] as Array<string | null>)),
    // Biased away from archived: it short-circuits everything and would waste runs.
    archived: fc.constantFrom(false, false, false, false, true),
    visitor: rawVisitorArb,
  })
  .map((r) => ({
    rules: r.rules,
    destination: DEFAULT_DESTINATION,
    activatesAtMs: r.activates === null ? null : T + r.activates,
    expiresAtMs: r.expires === null ? null : T + r.expires,
    scheduledTo: r.scheduledTo,
    expiresTo: r.expiresTo,
    archived: r.archived,
    visitor: r.visitor,
    nowMs: T,
  }));

/**
 * A device-only condition, and a visitor whose device is always known.
 *
 * Used by the traversal and weight hypotheses so that a divergence there cannot
 * be caused by a per-rule matcher disagreement instead. Under
 * `deviceReading="overlapping"` the two per-rule device matchers are shown to
 * agree by `D6-device-single-rule-overlapping`, so this substrate isolates
 * traversal order and weight from field-matching semantics.
 */
const knownDeviceArb = fc.constantFrom(...DEVICES);
const deviceOnlyBodyArb: fc.Arbitrary<RuleBody> = knownDeviceArb.map((device) => ({
  country: null,
  device,
  language: null,
  weight: null,
}));
const knownDeviceVisitorArb: fc.Arbitrary<RawVisitor> = fc.record({
  country: fc.constant(null),
  device: knownDeviceArb,
  language: fc.constant(null),
  visitorHash: visitorHashArb,
});
/** Weights that actually enter the implementation's split group (`weight > 0`). */
const positiveWeightArb = fc.constantFrom(1, 33.33, 50, 99, 100);

/** A chain-only case: no schedule, not archived. Isolates the chain. */
function chainCase(rules: RoutingRule[], visitor: RawVisitor): Case {
  return {
    rules,
    destination: DEFAULT_DESTINATION,
    activatesAtMs: null,
    expiresAtMs: null,
    scheduledTo: null,
    expiresTo: null,
    archived: false,
    visitor,
    nowMs: T,
  };
}

/* ============================================================================
   Classification of a divergence
   ========================================================================= */

type CauseId =
  | "A7-schedule-order-contradiction"
  | "A7-schedule-boundary-or-fallback"
  | "A5/A8-blank-or-untrimmed-constraint"
  | "A4-language-exact-vs-basic-filtering"
  | "A2-device-family-under-strict-reading"
  | "traversal-conditional-hoisted-above-catchall"
  | "traversal-weighted-catchall-hoisted-above-plain"
  | "A3-weight-selects-among-catchalls"
  | "unclassified";

const blank = (v: string | null | undefined): boolean => typeof v === "string" && v !== "" && v.trim() === "";
const untrimmed = (v: string | null | undefined): boolean => typeof v === "string" && v !== v.trim();

/**
 * The implementation's own notion of a catch-all (`!country && !device && !language`).
 * Used ONLY to label a divergence for the census. It is never used to compute an
 * expected value — that would make the implementation its own oracle.
 */
function implIsCatchAll(rule: RoutingRule): boolean {
  const { country, device, language } = rule.when;
  return !country && !device && !language;
}

/** Single-rule probe of the implementation's per-rule matcher, for labelling only. */
function implRuleMatches(rule: RoutingRule, ctx: VisitorContext): boolean {
  return evaluateRouting([rule], PROBE_FALLBACK, ctx).matchedRuleId !== null;
}

function languageExplains(rule: RoutingRule, ctx: VisitorContext): boolean {
  const ruleLanguage = rule.when.language;
  const visitorLanguage = ctx.language;
  if (typeof ruleLanguage !== "string" || ruleLanguage.trim() === "") return false;
  if (typeof visitorLanguage !== "string" || visitorLanguage.trim() === "") return false;
  const byBasicFiltering = referenceLanguageTagMatches(ruleLanguage, visitorLanguage);
  const byExactEquality = ruleLanguage.toLowerCase() === visitorLanguage.toLowerCase();
  return byBasicFiltering !== byExactEquality;
}

function deviceExplains(rule: RoutingRule, ctx: VisitorContext, reading: DeviceReading): boolean {
  const ruleDevice = rule.when.device;
  const visitorDevice = ctx.device;
  if (!ruleDevice || !visitorDevice) return false;
  const byReference = referenceDeviceMatches(ruleDevice, visitorDevice, reading);
  const byImplementation =
    ruleDevice === "mobile"
      ? visitorDevice === "mobile" || visitorDevice === "ios" || visitorDevice === "android"
      : ruleDevice === visitorDevice;
  return byReference !== byImplementation;
}

function classify(c: Case, reading: DeviceReading, ref: Outcome, impl: Outcome): CauseId {
  const scheduled = c.activatesAtMs !== null && c.nowMs < c.activatesAtMs;
  const expired = c.expiresAtMs !== null && c.nowMs >= c.expiresAtMs;
  if (!c.archived && scheduled && expired) return "A7-schedule-order-contradiction";
  if (!c.archived && (scheduled || expired)) return "A7-schedule-boundary-or-fallback";

  const ctx = ctxOf(c);
  const rv = refVisitorOf(c);

  const indexOf = (o: Outcome): number =>
    o.kind === "rule" ? c.rules.findIndex((r) => r.id === o.ruleId) : c.rules.length - 1;
  const limit = Math.max(indexOf(ref), indexOf(impl));

  for (let i = 0; i <= limit; i += 1) {
    const rule = c.rules[i]!;
    if (referenceRuleMatches(rule, rv, reading) === implRuleMatches(rule, ctx)) continue;
    if (
      blank(rule.when.country) ||
      blank(rule.when.language) ||
      untrimmed(rule.when.country) ||
      untrimmed(rule.when.language) ||
      blank(ctx.country) ||
      blank(ctx.language) ||
      untrimmed(ctx.country) ||
      untrimmed(ctx.language)
    ) {
      return "A5/A8-blank-or-untrimmed-constraint";
    }
    if (languageExplains(rule, ctx)) return "A4-language-exact-vs-basic-filtering";
    if (deviceExplains(rule, ctx, reading)) return "A2-device-family-under-strict-reading";
    return "unclassified";
  }

  // Per-rule matchers agree on every rule that could have decided it ⇒ traversal.
  if (ref.kind === "rule" && impl.kind === "rule") {
    const refRule = c.rules[indexOf(ref)]!;
    const implRule = c.rules[indexOf(impl)]!;
    if (implIsCatchAll(refRule) && !implIsCatchAll(implRule)) {
      return "traversal-conditional-hoisted-above-catchall";
    }
    if (implIsCatchAll(refRule) && implIsCatchAll(implRule)) {
      const implWeight = implRule.weight;
      if (typeof implWeight === "number" && implWeight > 0 && !refRule.weight) {
        return "traversal-weighted-catchall-hoisted-above-plain";
      }
      return "A3-weight-selects-among-catchalls";
    }
  }
  return "unclassified";
}

/* ============================================================================
   Run report — written to .qa-runs/l2-domain/artifacts/ (gitignored)
   ========================================================================= */

interface CensusReading {
  reading: DeviceReading;
  cases: number;
  divergent: number;
  /** The contradictory-schedule class swamps the raw count; this is the rest. */
  divergentExcludingScheduleContradiction: number;
  byCause: Record<string, number>;
  firstExample: Record<string, unknown>;
}

interface TargetedRecord {
  id: string;
  reading: DeviceReading;
  numRuns: number;
  failed: boolean;
  numShrinks: number | null;
  minimalCase: unknown;
  referenceSays: string | null;
  implementationSays: string | null;
}

const report: {
  seed: number;
  censusRuns: number;
  targetedRuns: number;
  census: CensusReading[];
  targeted: TargetedRecord[];
  notes: string[];
} = { seed: SEED, censusRuns: CENSUS_RUNS, targetedRuns: TARGETED_RUNS, census: [], targeted: [], notes: [] };

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

afterAll(() => {
  const out = resolve(repoRoot(), ".qa-runs/l2-domain/artifacts/differential-census.json");
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  } catch {
    // The suite's result does not depend on being able to write evidence; the
    // console still carries the seed and every counterexample.
  }
});

/** Compact, human-readable rendering of a case for a failure message. */
function describeCase(c: Case): string {
  const rules = c.rules
    .map((r) => {
      const when = [
        r.when.country === null || r.when.country === undefined ? null : `country=${JSON.stringify(r.when.country)}`,
        r.when.device ? `device=${r.when.device}` : null,
        r.when.language === null || r.when.language === undefined
          ? null
          : `language=${JSON.stringify(r.when.language)}`,
      ]
        .filter(Boolean)
        .join(" & ");
      const weight = r.weight === null || r.weight === undefined ? "" : ` w=${r.weight}`;
      return `${r.id}{${when || "∅"}}${weight}→${r.then}`;
    })
    .join(", ");
  const visitor = [
    `country=${JSON.stringify(c.visitor.country)}`,
    `device=${c.visitor.device}`,
    c.acceptLanguage === undefined
      ? `language=${JSON.stringify(c.visitor.language)}`
      : `accept-language=${JSON.stringify(c.acceptLanguage)}`,
    `visitorHash=${c.visitor.visitorHash}`,
  ].join(" ");
  const schedule =
    c.activatesAtMs === null && c.expiresAtMs === null && !c.archived
      ? "no schedule"
      : `activatesAt=${c.activatesAtMs === null ? "null" : `T${c.activatesAtMs - T >= 0 ? "+" : ""}${c.activatesAtMs - T}ms`}` +
        ` expiresAt=${c.expiresAtMs === null ? "null" : `T${c.expiresAtMs - T >= 0 ? "+" : ""}${c.expiresAtMs - T}ms`}` +
        ` scheduledTo=${c.scheduledTo ?? "null"} expiresTo=${c.expiresTo ?? "null"} archived=${c.archived}`;
  return `chain [${rules}] | visitor ${visitor} | ${schedule}`;
}

/**
 * Run one hypothesis. Records the shrunk minimal counterexample and returns a
 * message that states BOTH readings of the divergence — never a verdict.
 */
function differential(
  id: string,
  arb: fc.Arbitrary<Case>,
  reading: DeviceReading,
  readings: { ifImplementationIsRight: string; ifReferenceIsRight: string },
  numRuns = TARGETED_RUNS,
): { failed: boolean; message: string } {
  const details = fc.check(
    fc.property(arb, (c) => sameOutcome(refResolve(c, reading), implResolve(c))),
    { numRuns, seed: SEED },
  );

  const record: TargetedRecord = {
    id,
    reading,
    numRuns,
    failed: details.failed,
    numShrinks: details.failed ? details.numShrinks : null,
    minimalCase: null,
    referenceSays: null,
    implementationSays: null,
  };

  if (!details.failed) {
    report.targeted.push(record);
    return { failed: false, message: `${id} [${reading}]: no divergence in ${numRuns} runs (seed ${SEED}).` };
  }

  const minimal = (details.counterexample as [Case])[0];
  const ref = refResolve(minimal, reading);
  const impl = implResolve(minimal);
  record.minimalCase = { ...minimal, described: describeCase(minimal) };
  record.referenceSays = show(ref);
  record.implementationSays = show(impl);
  report.targeted.push(record);

  const message = [
    ``,
    `DIVERGENCE ${id}  (deviceReading=${reading}, seed=${SEED}, shrinks=${details.numShrinks})`,
    `  minimal input   : ${describeCase(minimal)}`,
    `  reference says  : ${show(ref)}`,
    `  implementation  : ${show(impl)}`,
    `  reading 1 — if the implementation is right: ${readings.ifImplementationIsRight}`,
    `  reading 2 — if the reference is right     : ${readings.ifReferenceIsRight}`,
    `  This test does not choose between them (qa-oracles §2).`,
    ``,
  ].join("\n");
  return { failed: true, message };
}

/* ============================================================================
   0. Seed announcement
   ========================================================================= */

describe("differential harness", () => {
  it("pins and reports the fast-check seed", () => {
    report.notes.push(
      `fast-check seed ${SEED}; census ${CENSUS_RUNS} cases per reading; targeted ${TARGETED_RUNS} runs per hypothesis.`,
    );
    expect(SEED).toBe(20260914);
  });
});

/* ============================================================================
   1. Census — total divergence, and how much of it is A2 alone
   ========================================================================= */

const census: Record<DeviceReading, CensusReading> = {
  overlapping: {
    reading: "overlapping",
    cases: 0,
    divergent: 0,
    divergentExcludingScheduleContradiction: 0,
    byCause: {},
    firstExample: {},
  },
  strict: {
    reading: "strict",
    cases: 0,
    divergent: 0,
    divergentExcludingScheduleContradiction: 0,
    byCause: {},
    firstExample: {},
  },
};

const censusCases = fc.sample(caseArb, { numRuns: CENSUS_RUNS, seed: SEED });
let mutatedInputs = 0;

for (const reading of READINGS) {
  const bucket = census[reading];
  for (const c of censusCases) {
    bucket.cases += 1;
    const before = JSON.stringify(c.rules);
    const ref = refResolve(c, reading);
    const impl = implResolve(c);
    if (JSON.stringify(c.rules) !== before) mutatedInputs += 1;
    if (sameOutcome(ref, impl)) continue;
    bucket.divergent += 1;
    const cause = classify(c, reading, ref, impl);
    if (cause !== "A7-schedule-order-contradiction") bucket.divergentExcludingScheduleContradiction += 1;
    bucket.byCause[cause] = (bucket.byCause[cause] ?? 0) + 1;
    if (!(cause in bucket.firstExample)) {
      bucket.firstExample[cause] = {
        described: describeCase(c),
        reference: show(ref),
        implementation: show(impl),
      };
    }
  }
  report.census.push(bucket);
}

describe("census over the full generated space", () => {
  it("reports the divergence count under each device reading", () => {
    const lines = READINGS.map((reading) => {
      const b = census[reading];
      const causes = Object.entries(b.byCause)
        .sort((a, z) => z[1] - a[1])
        .map(([cause, n]) => `      ${cause}: ${n}`)
        .join("\n");
      return (
        `  ${reading}: ${b.divergent}/${b.cases} cases divergent` +
        ` (${b.divergentExcludingScheduleContradiction} excluding the contradictory-schedule class)\n${causes}`
      );
    }).join("\n");
    report.notes.push(`census:\n${lines}`);

    // A census that finds nothing means the generators are too weak to be
    // trusted (qa-oracles §2: a zero-finding run is a failed run).
    expect(
      census.overlapping.divergent + census.strict.divergent,
      `The generators produced no divergence at all, which means they are too weak to be evidence of anything.\n${lines}`,
    ).toBeGreaterThan(0);

    // Not an oracle question: this is a census, and it is RED so the numbers
    // are read rather than buried in a passing run.
    expect(
      census.overlapping.divergent,
      `Reference and implementation disagree on ${census.overlapping.divergent} of ${census.overlapping.cases} generated cases under deviceReading=overlapping, and ${census.strict.divergent} of ${census.strict.cases} under deviceReading=strict.\n${lines}\nEach class is isolated and minimised by the targeted tests below. Adjudication is not this suite's to do.`,
    ).toBe(0);
  });

  it("never observes evaluateRouting mutating the chain it was handed", () => {
    // Oracle: architecture.md — packages/domain is "side-effect-free".
    expect(mutatedInputs, `evaluateRouting mutated its input rules array in ${mutatedInputs} cases.`).toBe(0);
  });
});

/* ============================================================================
   2. Traversal order — is "first match wins" positional?
   ========================================================================= */

describe("chain traversal order", () => {
  it("A catch-all at index 0 is not overtaken by a later conditional rule", () => {
    const arb = fc
      .tuple(deviceOnlyBodyArb, knownDeviceVisitorArb)
      .map(([conditional, visitor]) =>
        chainCase(
          [
            toRule({ country: null, device: null, language: null, weight: null }, 0),
            toRule(conditional, 1),
          ],
          visitor,
        ),
      );

    const r = differential("D1-conditional-hoisted-above-earlier-catchall", arb, "overlapping", {
      ifImplementationIsRight:
        "specificity beats position, so `packages/contract/src/link.ts:21` (\"First match wins\") and validateRoutingChain's own message (\"rules after 'everything else' can never match\") both describe behaviour the executor does not have.",
      ifReferenceIsRight:
        "the executor reorders the author's chain: `evaluateRouting` partitions into `conditional` then `catchAll` before scanning, so a rule the author placed second runs first.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("A plain catch-all at index 0 is not overtaken by a later weighted catch-all", () => {
    const arb = fc
      .tuple(weightArb, rawVisitorArb)
      .map(([weight, visitor]) =>
        chainCase(
          [
            toRule({ country: null, device: null, language: null, weight: null }, 0),
            toRule({ country: null, device: null, language: null, weight }, 1),
          ],
          visitor,
        ),
      );

    const r = differential("D2-weighted-catchall-hoisted-above-earlier-plain-catchall", arb, "overlapping", {
      ifImplementationIsRight:
        "a weighted catch-all outranks an earlier unweighted one by design, which is a third traversal tier the contract does not mention.",
      ifReferenceIsRight:
        "the first catch-all in the chain should win, and a weight on a later rule silently strands it.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("the executor never matches a rule validateRoutingChain reports as unreachable", () => {
    /* Oracle: NOT the reference. This is an internal-consistency invariant —
       `validateRoutingChain` and `evaluateRouting` are the same module's
       validate-on-save and execute-on-click halves, and README.md/docs/BACKEND.md
       sell "exactly one implementation of where a visitor lands". A chain the
       validator describes as having stranded rules must not then route to one.

       The chain is built to GUARANTEE a non-final plain catch-all — the exact
       shape the validator's message is about. Left to the broad generator that
       shape appears in a small fraction of chains and this check could pass by
       starvation rather than by agreement. */
    const arb = fc
      .tuple(
        fc.constantFrom(...([null, undefined, 0] as Array<null | undefined | number>)),
        fc.array(deviceOnlyBodyArb, { minLength: 1, maxLength: 3 }),
        knownDeviceVisitorArb,
      )
      .map(([catchAllWeight, tail, visitor]) =>
        chainCase(
          [
            toRule({ country: null, device: null, language: null, weight: catchAllWeight }, 0),
            ...tail.map((body, i) => toRule(body, i + 1)),
          ],
          visitor,
        ),
      );

    const details = fc.check(
      fc.property(arb, (c) => {
        // Only the "stranded after everything else" message, not the duplicate-
        // conditions one — they are different claims about different rules.
        const stranded = validateRoutingChain(c.rules).some((p) =>
          p.includes('after "everything else" can never match'),
        );
        if (!stranded) return true;
        const firstPlainCatchAll = c.rules.findIndex((r) => implIsCatchAll(r) && !r.weight);
        if (firstPlainCatchAll < 0) return true;
        const decision = evaluateRouting(c.rules, c.destination, ctxOf(c));
        if (decision.matchedRuleId === null) return true;
        const winner = c.rules.findIndex((r) => r.id === decision.matchedRuleId);
        return !(winner > firstPlainCatchAll);
      }),
      { numRuns: TARGETED_RUNS, seed: SEED },
    );

    let message = "D3: no divergence.";
    if (details.failed) {
      const c = (details.counterexample as [Case])[0];
      const decision = evaluateRouting(c.rules, c.destination, ctxOf(c));
      message = [
        ``,
        `DIVERGENCE D3-validator-contradicts-executor (seed ${SEED}, shrinks=${details.numShrinks})`,
        `  minimal input   : ${describeCase(c)}`,
        `  validator says  : ${JSON.stringify(validateRoutingChain(c.rules))}`,
        `  executor routes : ${decision.matchedRuleId} → ${decision.destination}`,
        `  reading 1 — if the executor is right: validateRoutingChain raises a save-time error about a rule that does in fact run, so the drawer refuses or warns about a working chain.`,
        `  reading 2 — if the validator is right: the executor runs a rule the same module declares unreachable.`,
        `  Either way the two halves of one module disagree. This test does not choose (qa-oracles §2).`,
        ``,
      ].join("\n");
      report.targeted.push({
        id: "D3-validator-contradicts-executor",
        reading: "overlapping",
        numRuns: TARGETED_RUNS,
        failed: true,
        numShrinks: details.numShrinks,
        minimalCase: { ...c, described: describeCase(c) },
        referenceSays: JSON.stringify(validateRoutingChain(c.rules)),
        implementationSays: `${decision.matchedRuleId} → ${decision.destination}`,
      });
    }
    expect(details.failed, message).toBe(false);
  });
});

/* ============================================================================
   3. weight  (A3)
   ========================================================================= */

describe("weight", () => {
  it("two weighted catch-alls resolve to the same rule for every visitor", () => {
    // Both weights strictly positive, so this is a genuine two-arm split rather
    // than the "weighted hoisted above plain" case D2 already isolates.
    const arb = fc
      .tuple(positiveWeightArb, positiveWeightArb, rawVisitorArb)
      .map(([w0, w1, visitor]) =>
        chainCase(
          [
            toRule({ country: null, device: null, language: null, weight: w0 }, 0),
            toRule({ country: null, device: null, language: null, weight: w1 }, 1),
          ],
          visitor,
        ),
      );

    const r = differential("D4-weight-selects-among-catchalls", arb, "overlapping", {
      ifImplementationIsRight:
        "`weight` is a live A/B split keyed on visitorHash, so A3 reading (iii) in routing.reference.md is wrong and `evaluateRouting` is a function of the visitor's identity, not only of the three `when` dimensions.",
      ifReferenceIsRight:
        "`weight` should not select a rule at all, and the same link now sends two visitors in the same country, on the same device, in the same language to different URLs.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("weight on a conditional rule does not change which rule wins", () => {
    const arb = fc
      .tuple(deviceOnlyBodyArb, deviceOnlyBodyArb, weightArb, weightArb, knownDeviceVisitorArb)
      .map(([a, b, w0, w1, visitor]) =>
        chainCase([toRule({ ...a, weight: w0 }, 0), toRule({ ...b, weight: w1 }, 1)], visitor),
      );

    const r = differential("D5-weight-on-conditional-rules", arb, "overlapping", {
      ifImplementationIsRight: "weight is deliberately inert outside a catch-all group.",
      ifReferenceIsRight: "weight is inert here too, and the agreement is the finding: the schema advertises 0–100 on every rule while only catch-alls consult it.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("chains whose weights sum below, at and above 100 all evaluate", () => {
    // Oracle: the contract puts NO sum constraint on weight (z.number().min(0).max(100)
    // per rule, nothing across rules), so none of these may throw.
    const arb = fc.tuple(
      fc.array(weightArb, { minLength: 2, maxLength: 4 }),
      rawVisitorArb,
    );
    const details = fc.check(
      fc.property(arb, ([weights, visitor]) => {
        const c = chainCase(
          weights.map((weight, i) => toRule({ country: null, device: null, language: null, weight }, i)),
          visitor,
        );
        const impl = implResolve(c);
        return impl.kind === "rule" || impl.kind === "destination";
      }),
      { numRuns: TARGETED_RUNS, seed: SEED },
    );
    expect(details.failed, `Weight-sum chain produced no routable outcome: ${JSON.stringify(details.counterexample)}`).toBe(false);
  });
});

/* ============================================================================
   4. device  (A2) — run under BOTH readings
   ========================================================================= */

describe("device", () => {
  for (const reading of READINGS) {
    it(`single-device rules agree under deviceReading=${reading}`, () => {
      const arb = fc
        .tuple(ruleDeviceArb, rawVisitorArb)
        .map(([device, visitor]) =>
          chainCase([toRule({ country: null, device, language: null, weight: null }, 0)], visitor),
        );

      const r = differential(`D6-device-single-rule-${reading}`, arb, reading, {
        ifImplementationIsRight:
          "`mobile` is a family that iOS and Android visitors belong to, i.e. the `overlapping` reading of A2 is the right one.",
        ifReferenceIsRight:
          "`mobile` names a distinct category and an iOS visitor should not satisfy it, i.e. the `strict` reading of A2.",
      });
      expect(r.failed, r.message).toBe(false);
    });

    it(`both orderings of [mobile, ios] agree under deviceReading=${reading}`, () => {
      // The ordering case routing.reference.md A2 calls "the sharp end".
      const arb = fc
        .tuple(fc.boolean(), fc.constantFrom(...DEVICES), visitorHashArb)
        .map(([mobileFirst, device, visitorHash]) => {
          const mobileRule = toRule({ country: null, device: "mobile", language: null, weight: null }, 0);
          const iosRule = toRule({ country: null, device: "ios", language: null, weight: null }, 1);
          return chainCase(mobileFirst ? [mobileRule, iosRule] : [iosRule, mobileRule], {
            country: null,
            device,
            language: null,
            visitorHash,
          });
        });

      const r = differential(`D7-device-both-orderings-${reading}`, arb, reading, {
        ifImplementationIsRight:
          "ordering is load-bearing for overlapping device categories and nothing warns the author: `[mobile→A, ios→B]` makes B dead code while `[ios→B, mobile→A]` does not, and validateRoutingChain reports no problem with either.",
        ifReferenceIsRight:
          "under the strict reading the two orderings are equivalent and the ordering trap does not exist.",
      });
      expect(r.failed, r.message).toBe(false);
    });
  }

  it("every rule in a chain validateRoutingChain accepts is reachable by some visitor", () => {
    /* Oracle: validateRoutingChain's own stated purpose — "Reject chains that
       cannot behave as the author expects … so the error surfaces in the drawer
       rather than in a visitor's browser". A device-only chain it passes with
       zero problems should not contain a rule no visitor can reach. */
    const arb = fc.array(ruleDeviceArb, { minLength: 2, maxLength: 4 });
    const details = fc.check(
      fc.property(arb, (devices) => {
        const rules = devices.map((device, i) =>
          toRule({ country: null, device, language: null, weight: null }, i),
        );
        if (validateRoutingChain(rules).length > 0) return true;
        const reachable = new Set<string>();
        for (const device of DEVICES) {
          const decision = evaluateRouting(rules, DEFAULT_DESTINATION, {
            country: null,
            device,
            language: null,
            visitorHash: "0123456789abcdef",
          });
          if (decision.matchedRuleId) reachable.add(decision.matchedRuleId);
        }
        return rules.every((r) => reachable.has(r.id));
      }),
      { numRuns: TARGETED_RUNS, seed: SEED },
    );

    let message = "D8: no divergence.";
    if (details.failed) {
      const devices = details.counterexample as [Array<DeviceType | null | undefined>];
      const rules = devices[0].map((device, i) => toRule({ country: null, device, language: null, weight: null }, i));
      const reachable = new Set<string>();
      for (const device of DEVICES) {
        const d = evaluateRouting(rules, DEFAULT_DESTINATION, {
          country: null,
          device,
          language: null,
          visitorHash: "0123456789abcdef",
        });
        if (d.matchedRuleId) reachable.add(d.matchedRuleId);
      }
      const dead = rules.filter((r) => !reachable.has(r.id)).map((r) => `${r.id}{device=${r.when.device}}`);
      message = [
        ``,
        `DIVERGENCE D8-validator-accepts-unreachable-rule (seed ${SEED}, shrinks=${details.numShrinks})`,
        `  minimal input   : chain [${rules.map((r) => `${r.id}{device=${r.when.device ?? "∅"}}`).join(", ")}]`,
        `  validator says  : [] (no problems)`,
        `  unreachable     : ${dead.join(", ")} — no value of DeviceType routes to it`,
        `  reading 1 — if the implementation is right: the chain is fine and the validator has no duty to catch device-family shadowing.`,
        `  reading 2 — if the validator's stated purpose is right: it misses a whole class of "cannot behave as the author expects", which is what it exists to catch.`,
        `  This test does not choose (qa-oracles §2).`,
        ``,
      ].join("\n");
      report.targeted.push({
        id: "D8-validator-accepts-unreachable-rule",
        reading: "overlapping",
        numRuns: TARGETED_RUNS,
        failed: true,
        numShrinks: details.numShrinks,
        minimalCase: { chain: rules },
        referenceSays: "every accepted rule reachable",
        implementationSays: `unreachable: ${dead.join(", ")}`,
      });
    }
    expect(details.failed, message).toBe(false);
  });
});

/* ============================================================================
   5. country  (A8, A5)
   ========================================================================= */

describe("country", () => {
  it("country constraints agree across case, blanks, untrimmed values and junk", () => {
    const arb = fc
      .tuple(ruleCountryArb, rawVisitorArb)
      .map(([country, visitor]) =>
        chainCase([toRule({ country, device: null, language: null, weight: null }, 0)], visitor),
      );

    const r = differential("D9-country-matching", arb, "overlapping", {
      ifImplementationIsRight:
        "only the empty string means \"no constraint\", and a country value is compared byte-for-byte after upper-casing — so a rule saved as \" IN \" or \" \" is a constraint that upper-casing cannot rescue.",
      ifReferenceIsRight:
        "a whitespace-only value is as absent as `\"\"` (A5) and both sides should be trimmed before comparison (A8), so untrimmed input silently produces a rule that never fires with no error anywhere.",
    });
    expect(r.failed, r.message).toBe(false);
  });
});

/* ============================================================================
   6. language  (A4)
   ========================================================================= */

describe("language", () => {
  it("resolved language tags agree", () => {
    const arb = fc
      .tuple(ruleLanguageArb, rawVisitorArb)
      .map(([language, visitor]) =>
        chainCase([toRule({ country: null, device: null, language, weight: null }, 0)], visitor),
      );

    const r = differential("D10-language-tag-matching", arb, "overlapping", {
      ifImplementationIsRight:
        "language matching is exact case-insensitive equality on the whole tag, so a rule written `en-US` can only fire against a visitor tag that is literally `en-us`.",
      ifReferenceIsRight:
        "RFC 4647 §3.3.1 Basic Filtering is the intended semantic (A4), so a rule written `en` must also match `en-US` — and the contract types `language` as a bare `z.string()`, giving an author no way to discover which of the two they got.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("Accept-Language headers agree, including q-values, q=0 and *", () => {
    const HEADERS: Array<string | null> = [
      "en",
      "en-US",
      "EN-us",
      "en-GB,en;q=0.9,fr;q=0.8",
      "fr;q=0.1,en;q=0.9",
      "fr;q=0,en",
      "de;q=0",
      "*",
      "*;q=0.5,de",
      "zh-Hant-TW,zh;q=0.9",
      "en-US,en;q=0.5",
      "",
      " ",
      "en;q=x,fr",
      null,
    ];
    const arb = fc
      .tuple(ruleLanguageArb, fc.constantFrom(...HEADERS), rawVisitorArb)
      .map(([language, header, visitor]) => ({
        ...chainCase([toRule({ country: null, device: null, language, weight: null }, 0)], visitor),
        acceptLanguage: header,
      }));

    const r = differential("D11-accept-language-header", arb, "overlapping", {
      ifImplementationIsRight:
        "`parseLanguage` is the declared contract — first header item only, primary subtag only, q-values ignored — and a rule may therefore only ever be written as a bare two/three-letter primary subtag.",
      ifReferenceIsRight:
        "RFC 9110 §12.5.4 precedence is intended, so `q=0` (\"not acceptable\") is being honoured as a preference, a lower-q tag can outrank a higher-q one by document position, `*` is discarded, and every regional tag collapses to its primary subtag before a rule ever sees it.",
    });
    expect(r.failed, r.message).toBe(false);
  });
});

/* ============================================================================
   7. Schedule gates  (A7)
   ========================================================================= */

describe("schedule gates", () => {
  it("boundary instants agree at, 1 ms before and 1 ms after activatesAt and expiresAt", () => {
    const BOUNDARY: Array<number | null> = [null, -1, 0, 1];
    const arb = fc
      .record({
        activates: fc.constantFrom(...BOUNDARY),
        expires: fc.constantFrom(...BOUNDARY),
        scheduledTo: fc.constantFrom(...([SCHEDULED_TO, null] as Array<string | null>)),
        expiresTo: fc.constantFrom(...([EXPIRES_TO, null] as Array<string | null>)),
        visitor: rawVisitorArb,
      })
      // Exclude the contradictory window; it is its own test below.
      .filter((r) => !(r.activates !== null && r.activates > 0 && r.expires !== null && r.expires <= 0))
      .map((r) => ({
        rules: [],
        destination: DEFAULT_DESTINATION,
        activatesAtMs: r.activates === null ? null : T + r.activates,
        expiresAtMs: r.expires === null ? null : T + r.expires,
        scheduledTo: r.scheduledTo,
        expiresTo: r.expiresTo,
        archived: false,
        visitor: r.visitor,
        nowMs: T,
      }));

    const r = differential("D12-schedule-boundary-instants", arb, "overlapping", {
      ifImplementationIsRight: "the live window boundaries are as A7 guesses them.",
      ifReferenceIsRight: "the live window boundaries are as A7 guesses them.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("a contradictory window (activates ahead, expires behind) agrees", () => {
    const arb = fc
      .record({
        activates: fc.constantFrom(1, 1_000, 86_400_000),
        expires: fc.constantFrom(0, -1, -1_000, -86_400_000),
        scheduledTo: fc.constantFrom(...([SCHEDULED_TO, null] as Array<string | null>)),
        expiresTo: fc.constantFrom(...([EXPIRES_TO, null] as Array<string | null>)),
        visitor: rawVisitorArb,
      })
      .map((r) => ({
        rules: [],
        destination: DEFAULT_DESTINATION,
        activatesAtMs: T + r.activates,
        expiresAtMs: T + r.expires,
        scheduledTo: r.scheduledTo,
        expiresTo: r.expiresTo,
        archived: false,
        visitor: r.visitor,
        nowMs: T,
      }));

    const r = differential("D13-contradictory-schedule-window", arb, "overlapping", {
      ifImplementationIsRight:
        "expired outranks scheduled — `deriveStatus`'s comment argues \"will never work\" is more useful than \"does not work yet\", and `validateSchedule` rejects the combination on write so only an edited row reaches it.",
      ifReferenceIsRight:
        "`scheduledTo` is documented as where a click lands *before* `activatesAt`, unconditionally (A7), so the visitor is sent to the wrong one of two configured URLs.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("the schedule outranks a matching routing rule", () => {
    /* A device-only chain (per-rule matchers shown to agree under the
       overlapping reading) so any divergence here is about gate-vs-chain
       precedence, not field matching. Exactly one gate is ever active. */
    const arb = fc
      .record({
        rules: fc.array(deviceOnlyBodyArb, { minLength: 1, maxLength: 3 }),
        activates: fc.constantFrom(...([null, 86_400_000, -86_400_000] as Array<number | null>)),
        expires: fc.constantFrom(...([null, 86_400_000, -86_400_000] as Array<number | null>)),
        scheduledTo: fc.constantFrom(...([SCHEDULED_TO, null] as Array<string | null>)),
        expiresTo: fc.constantFrom(...([EXPIRES_TO, null] as Array<string | null>)),
        visitor: knownDeviceVisitorArb,
      })
      // Only one gate at a time; the contradiction is D13's job.
      .filter((r) => !(r.activates === 86_400_000 && r.expires === -86_400_000))
      .map((r) => ({
        rules: r.rules.map((body, i) => toRule(body, i)),
        destination: DEFAULT_DESTINATION,
        activatesAtMs: r.activates === null ? null : T + r.activates,
        expiresAtMs: r.expires === null ? null : T + r.expires,
        scheduledTo: r.scheduledTo,
        expiresTo: r.expiresTo,
        archived: false,
        visitor: r.visitor,
        nowMs: T,
      }));

    const r = differential("D14-schedule-vs-chain-precedence", arb, "overlapping", {
      ifImplementationIsRight: "gate precedence over the chain is as A7 guesses it.",
      ifReferenceIsRight: "gate precedence over the chain is as A7 guesses it.",
    });
    expect(r.failed, r.message).toBe(false);
  });

  it("archived outranks everything", () => {
    const arb = fc
      .record({ rules: chainArb, visitor: rawVisitorArb, activates: offsetArb, expires: offsetArb })
      .map((r) => ({
        rules: r.rules,
        destination: DEFAULT_DESTINATION,
        activatesAtMs: r.activates === null ? null : T + r.activates,
        expiresAtMs: r.expires === null ? null : T + r.expires,
        scheduledTo: SCHEDULED_TO,
        expiresTo: EXPIRES_TO,
        archived: true,
        visitor: r.visitor,
        nowMs: T,
      }));

    const r = differential("D15-archived-precedence", arb, "overlapping", {
      ifImplementationIsRight: "archived precedence is as A7 guesses it.",
      ifReferenceIsRight: "archived precedence is as A7 guesses it.",
    });
    expect(r.failed, r.message).toBe(false);
  });
});

/* ============================================================================
   8. Determinism
   ========================================================================= */

describe("determinism", () => {
  it("the same rules, visitor and clock give one answer over 25 evaluations", () => {
    // Oracle: architecture.md — packages/domain is "side-effect-free" and
    // routing.ts's own header says "no clock, no randomness, no I/O".
    const sample = fc.sample(caseArb, { numRuns: 1_500, seed: SEED });
    const unstable: string[] = [];
    for (const c of sample) {
      for (const reading of READINGS) {
        const refFirst = show(refResolve(c, reading));
        const implFirst = show(implResolve(c));
        for (let i = 0; i < 25; i += 1) {
          if (show(refResolve(c, reading)) !== refFirst) unstable.push(`reference/${reading}: ${describeCase(c)}`);
          if (show(implResolve(c)) !== implFirst) unstable.push(`implementation: ${describeCase(c)}`);
        }
      }
    }
    expect(unstable.slice(0, 5), `Unstable across 25 identical evaluations:\n${unstable.slice(0, 5).join("\n")}`).toEqual([]);
  });

  it("two visitors identical in country, device and language get the same destination", () => {
    /* Oracle: routing.ts's VisitorContext documents `visitorHash` as "Stable per
       visitor per day. Used to keep A/B buckets sticky." A chain with no split
       therefore must not depend on it; a chain WITH a split does. This test
       pins the boundary of that dependence rather than assuming it. */
    const arb = fc.tuple(chainArb, rawVisitorArb, visitorHashArb);
    const details = fc.check(
      fc.property(arb, ([rules, visitor, otherHash]) => {
        const a = evaluateRouting(rules, DEFAULT_DESTINATION, ctxOf(chainCase(rules, visitor)));
        const b = evaluateRouting(
          rules,
          DEFAULT_DESTINATION,
          ctxOf(chainCase(rules, { ...visitor, visitorHash: otherHash })),
        );
        return a.destination === b.destination;
      }),
      { numRuns: TARGETED_RUNS, seed: SEED },
    );

    let message = "D17: no divergence.";
    if (details.failed) {
      // fc.check wraps the property's argument list: for a single tuple
      // arbitrary the counterexample is [[rules, visitor, otherHash]].
      const [rules, visitor, otherHash] = (details.counterexample as [[RoutingRule[], RawVisitor, string]])[0];
      const a = evaluateRouting(rules, DEFAULT_DESTINATION, ctxOf(chainCase(rules, visitor)));
      const b = evaluateRouting(rules, DEFAULT_DESTINATION, ctxOf(chainCase(rules, { ...visitor, visitorHash: otherHash })));
      message = [
        ``,
        `DIVERGENCE D17-destination-depends-on-visitorHash (seed ${SEED}, shrinks=${details.numShrinks})`,
        `  minimal input   : ${describeCase(chainCase(rules, visitor))}`,
        `  visitorHash ${visitor.visitorHash} → ${a.matchedRuleId} ${a.destination}`,
        `  visitorHash ${otherHash} → ${b.matchedRuleId} ${b.destination}`,
        `  reading 1 — if the implementation is right: a weighted catch-all is a per-visitor split and this is the feature working.`,
        `  reading 2 — if the reference is right (A3 reading iii): the routing decision must be a function of country/device/language alone, and it is not.`,
        `  This test does not choose (qa-oracles §2).`,
        ``,
      ].join("\n");
      report.targeted.push({
        id: "D17-destination-depends-on-visitorHash",
        reading: "overlapping",
        numRuns: TARGETED_RUNS,
        failed: true,
        numShrinks: details.numShrinks,
        minimalCase: { rules, visitor, otherHash },
        referenceSays: `${a.destination} for every visitor`,
        implementationSays: `${a.destination} or ${b.destination} depending on visitorHash`,
      });
    }
    expect(details.failed, message).toBe(false);
  });
});
