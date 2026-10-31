/* Contract fuzz suite (spec: api-stack-tests, requirements F3–F5, design §6).
 *
 * For every registry route, authenticated as ownerA with path params taken
 * from the seeded resources, property-fuzz the request against the real
 * staging stack and assert the four F3 oracles:
 *
 *   1. the status is NEVER 5xx — a 5xx on fuzzed/malformed input is the bug;
 *   2. a contract-INVALID body gets a 4xx;
 *   3. a contract-VALID body never gets the VALIDATION 400 — the one with an
 *      `issues` array (ValidationErrorBody, zod.pipe.ts). Getting one means the
 *      controller and the registry disagree about the schema;
 *   4. every 2xx body parses against the registry's response schema for that
 *      status.
 *
 * Plus transport-level invalids per body route (malformed JSON, wrong
 * content-type, empty body where one is required) — all must be 4xx, never 5xx;
 * this settles whether malformed JSON is 400 or 500 (main.ts never verified it).
 *
 * Arbitraries come from the #889 generator (`validArb` / `invalidArb`); the
 * oracle that those arbitraries are sound is its own F2 self-check
 * (`zod-arbitrary.test.ts`), which runs in the normal suite.
 *
 * Budgets (F5): FUZZ_RUNS (default 25) and FUZZ_SEED (fixed default on PR,
 * `Date.now()` nightly). The seed, route and shrunk payload are printed on any
 * failure (F4), so a red is replayable.
 *
 * Runs only against a live stack (describeStack). `THROTTLE_LIMIT=100000
 * pnpm staging:up`, then
 * `STACK_API_URL=… STACK_DATABASE_URL=… pnpm --filter @snapurl/api test:stack`.
 *
 * ── Known coverage gaps (design §6) ──────────────────────────────────────────
 * Route-level @Throttle routes (auth.controller.ts, public.controller.ts) keep
 * their own low per-route buckets REGARDLESS of THROTTLE_LIMIT (which raises
 * only the global bucket), so they are capped at THROTTLED_SAMPLES (3) each to
 * avoid drowning the run in 429s. See THROTTLED below.
 *
 * ── Why the import gymnastics ────────────────────────────────────────────────
 * registry.ts calls extendZodWithOpenApi(z) then imports the contract; the
 * patch only reaches schemas built after it. esbuild hoists static imports, and
 * Vitest serves first-party .ts as ESM while externalising node_modules as CJS
 * (two zod instances). So we patch the CJS zod the contract uses FIRST, then
 * dynamically import the registry, the path modules and the generator — a
 * dynamic import is not hoisted, so the order holds without a setupFile. Same
 * shape as zod-arbitrary.test.ts / route-inventory.test.ts (proven on #889).
 */
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { describeStack, STACK_API_URL, STACK_DATABASE_URL } from "./env.js";
import { seedPrincipals, type SeededStack } from "./principals.js";
import { DEFAULT_DOMAIN, seedResources, type SeededResources } from "./resources.js";

/* 1. Patch the CJS zod the externalised contract uses, BEFORE importing it. */
const require = createRequire(import.meta.url);
const { extendZodWithOpenApi } = require("@asteasolutions/zod-to-openapi") as {
  extendZodWithOpenApi: (zod: typeof z) => void;
};
extendZodWithOpenApi(require("zod").z);
// Also patch the ESM zod this file holds, so response-schema parsing here uses
// a patched instance consistent with the registry.
extendZodWithOpenApi(z);

/* 2. Now load the registry, populate it with every path module, then the
 *    generator. */
const { registry } = await import("../openapi/registry.js");
await Promise.all([
  import("../openapi/paths/analytics.js"),
  import("../openapi/paths/auth.js"),
  import("../openapi/paths/bio-pages.js"),
  import("../openapi/paths/developers.js"),
  import("../openapi/paths/domains.js"),
  import("../openapi/paths/forms.js"),
  import("../openapi/paths/health.js"),
  import("../openapi/paths/links.js"),
  import("../openapi/paths/members.js"),
  import("../openapi/paths/public.js"),
  import("../openapi/paths/reports.js"),
  import("../openapi/paths/workspaces.js"),
]);
const { validArb, invalidArb, UnsupportedSchemaError } = await import("./zod-arbitrary.js");

/* ── budgets (F5) ─────────────────────────────────────────────────────────── */

const FUZZ_RUNS = Number(process.env.FUZZ_RUNS ?? 25);
const FUZZ_SEED = Number(process.env.FUZZ_SEED ?? 8_902_026);
const THROTTLED_SAMPLES = 3;
/** A full route × FUZZ_RUNS property, each run a real HTTP round-trip, can run
 *  many seconds under load; FUZZ_RUNS=300 nightly needs real headroom. */
const TEST_TIMEOUT_MS = 180_000;

/* ── route model ──────────────────────────────────────────────────────────── */

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface RouteDef {
  method: Method;
  /** Registry path WITHOUT the /api/v1 prefix, e.g. "/links/{id}". */
  path: string;
  /** `true` when the route has no bearer security (@Public). */
  isPublic: boolean;
  bodySchema?: z.ZodType;
  /** Response schemas by status code (only those with a JSON schema). */
  responses: Map<number, z.ZodType>;
}

/** Pull the route surface + its request/response JSON schemas out of the
 *  registry, the single source of truth the controllers validate against. */
function collectRoutes(): RouteDef[] {
  const out: RouteDef[] = [];
  for (const d of registry.definitions) {
    if (d.type !== "route") continue;
    const r = d.route;
    const bodyMedia = r.request?.body?.content?.["application/json"];
    const bodySchema = bodyMedia?.schema instanceof z.ZodType ? bodyMedia.schema : undefined;
    const responses = new Map<number, z.ZodType>();
    for (const [status, resp] of Object.entries(r.responses ?? {})) {
      const media = (resp as { content?: Record<string, { schema?: unknown }> }).content?.["application/json"];
      if (media?.schema instanceof z.ZodType) responses.set(Number(status), media.schema);
    }
    out.push({
      method: r.method.toUpperCase() as Method,
      path: r.path,
      isPublic: Array.isArray(r.security) && r.security.length === 0,
      bodySchema,
      responses,
    });
  }
  return out.sort((a, b) => a.method.localeCompare(b.method) || a.path.localeCompare(b.path));
}

const ROUTES = collectRoutes();

/** Destructive routes — fuzzed with invalid input / nonexistent ids ONLY
 *  (design §6). A valid destructive call belongs to the access matrix (#892),
 *  which uses a fresh resource per case. */
const DESTRUCTIVE = new Set<string>([
  "POST /auth/logout",
  "POST /auth/2fa/disable",
  "POST /auth/password-reset/confirm",
  // every DELETE is destructive — matched by method below too
]);
function isDestructive(r: RouteDef): boolean {
  return r.method === "DELETE" || DESTRUCTIVE.has(`${r.method} ${r.path}`);
}

/** Route-level @Throttle routes (auth.controller.ts, public.controller.ts):
 *  their own per-route buckets are NOT raised by THROTTLE_LIMIT, so cap samples
 *  to 3 each. Listed here as the design's known coverage gap. */
const THROTTLED = new Set<string>([
  "POST /auth/register",
  "POST /auth/login",
  "POST /auth/invite/accept",
  "POST /auth/password-reset/request",
  "POST /auth/password-reset/confirm",
  "POST /auth/email/resend",
  "POST /auth/2fa/verify",
  "POST /public/links/{slug}/unlock",
  "POST /public/bio-pages/by-domain/{domain}/{slug}/view",
  "POST /public/bio-pages/by-domain/{domain}/{slug}/blocks/{blockId}/click",
  "POST /public/bio-pages/{slug}/view",
  "POST /public/bio-pages/{slug}/blocks/{blockId}/click",
  "POST /public/forms/{slug}",
  "POST /public/links/{slug}/report",
]);
function isThrottled(r: RouteDef): boolean {
  return THROTTLED.has(`${r.method} ${r.path}`);
}

function runsFor(r: RouteDef): number {
  return isThrottled(r) ? THROTTLED_SAMPLES : FUZZ_RUNS;
}

/**
 * Known contract-valid inputs that currently 5xx (oracle F3.1), each linked to
 * its filed issue. While a case is listed here the fuzzer does NOT fail oracle 1
 * for THAT route (the bug is known and tracked), and a dedicated expected-
 * failure test below asserts the exact input still 500s — so when the endpoint
 * is fixed, that test flips red and forces this entry's removal (design M5 / the
 * issue's "mark as an expected failure linked to the issue" rule).
 */
interface ExpectedFailure {
  route: string; // "METHOD /path"
  issue: number;
  /** The exact request body that reproduces the 5xx. */
  body: unknown;
  /** The path kind to target (uses the owner's own seeded resource). */
}
const EXPECTED_5XX: ExpectedFailure[] = [
  {
    route: "PATCH /links/{id}",
    issue: 947,
    // A routing rule whose weight is the smallest positive subnormal double.
    // Passes RoutingRule's z.number().min(0).max(100) but 500s on persist.
    body: { rules: [{ id: "", when: { country: "US" }, then: "https://example.com", weight: 5e-324 }] },
  },
];
function expectedFailureFor(label: string): ExpectedFailure | undefined {
  return EXPECTED_5XX.find((e) => e.route === label);
}

/* ── request plumbing ─────────────────────────────────────────────────────── */

const BLOCK_ID = "00000000-0000-4000-8000-000000000000";
/** A 429-rate tally across the whole run (design §6: fail if > 5%). */
let totalRequests = 0;
let total429 = 0;

/** Fill {id}/{slug}/{domain}/{blockId} in a route path from A's seeded
 *  resources. `idOverride` supplies a fuzzed path id (design §6: a {id}-shaped
 *  arbitrary in invalid mode — non-UUID strings, then random valid UUIDs); when
 *  absent, a destructive {id} route uses a nonexistent UUID (so a successful
 *  destructive op never happens) and everything else uses A's own resource. */
function fillPath(
  r: RouteDef,
  resA: SeededResources,
  opts: { nonexistentId?: boolean; idOverride?: string } = {},
): string {
  const id = opts.idOverride ?? (opts.nonexistentId ? BLOCK_ID : idForKind(r.path, resA));
  const slug = r.path.includes("/public/bio-pages/") ? resA.bioSlug : resA.linkSlug;
  const rel = r.path
    .replace("{id}", encodeURIComponent(id))
    .replace("{slug}", slug)
    .replace("{domain}", DEFAULT_DOMAIN)
    .replace("{blockId}", BLOCK_ID);
  return `${STACK_API_URL}${rel}`;
}

/** A `{id}`-shaped path-param arbitrary in invalid mode: mostly non-UUID
 *  strings (which `ParseUUIDPipe` must reject with a 4xx — remove the pipe and
 *  a non-UUID reaches the DB and 500s, which oracle 1 then catches), plus some
 *  random valid UUIDs that simply miss. Never empty (an empty segment changes
 *  the route). */
const ID_PARAM_ARB: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 24 }).filter((s) => !/^[0-9a-f-]{36}$/i.test(s) && !s.includes("/")) },
  { weight: 2, arbitrary: fc.constantFrom("not-a-uuid", "12345", "../etc", "null", "undefined", "%2e%2e", "' OR '1'='1") },
  { weight: 1, arbitrary: fc.uuid() },
);

function idForKind(path: string, r: SeededResources): string {
  if (path.includes("/forms/")) return r.formId;
  if (path.includes("/domains/")) return r.domainId;
  if (path.includes("/bio-pages/")) return r.bioPageId;
  if (path.includes("/webhooks/")) return r.webhookId;
  if (path.includes("/api-keys/")) return r.apiKeyId;
  if (path.includes("/members/")) return r.memberId;
  return r.linkId;
}

interface SendResult {
  status: number;
  /** Parsed JSON body, or undefined for a non-JSON/empty body. */
  json: unknown;
  contentType: string | null;
}

async function send(
  method: Method,
  url: string,
  auth: string | null,
  body: unknown | undefined,
  opts: { raw?: string; contentType?: string | null } = {},
): Promise<SendResult> {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  let payload: string | undefined;
  if (opts.raw !== undefined) {
    payload = opts.raw;
    if (opts.contentType) headers["content-type"] = opts.contentType;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = opts.contentType ?? "application/json";
  }
  const res = await fetch(url, { method, headers, body: payload });
  totalRequests += 1;
  if (res.status === 429) total429 += 1;
  const ct = res.headers.get("content-type");
  let json: unknown;
  if (ct?.includes("application/json")) json = await res.json().catch(() => undefined);
  else await res.text().catch(() => undefined);
  return { status: res.status, json, contentType: ct };
}

function is5xx(status: number): boolean {
  return status >= 500 && status < 600;
}
function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}
function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

/** The VALIDATION 400 — the contract pipe's ValidationErrorBody, identified by
 *  its `issues` array (zod.pipe.ts). A 400 WITHOUT `issues` is some other
 *  domain 400 (e.g. a business-rule rejection) and is NOT oracle-3 relevant. */
function isValidationError(status: number, json: unknown): boolean {
  return (
    status === 400 &&
    !!json &&
    typeof json === "object" &&
    Array.isArray((json as { issues?: unknown }).issues)
  );
}

/* ── the suite ────────────────────────────────────────────────────────────── */

describeStack("contract fuzz (F3–F5): no 5xx, invalid→4xx, valid never validation-400, 2xx parses", () => {
  let stack: SeededStack;
  let resA: SeededResources;
  let auth: string;

  beforeAll(async () => {
    if (!STACK_DATABASE_URL) throw new Error("STACK_DATABASE_URL is required for the fuzz suite.");
    stack = await seedPrincipals({ apiUrl: STACK_API_URL!, databaseUrl: STACK_DATABASE_URL });
    resA = await seedResources(STACK_API_URL!, stack.principals.ownerA);
    auth = stack.principals.ownerA.authorization!;
    // eslint-disable-next-line no-console
    console.log(
      `[fuzz] FUZZ_RUNS=${FUZZ_RUNS} FUZZ_SEED=${FUZZ_SEED} routes=${ROUTES.length} ` +
        `throttled(capped@${THROTTLED_SAMPLES})=${ROUTES.filter(isThrottled).length} public=${ROUTES.filter((x) => x.isPublic).length}`,
    );
  }, 120_000);

  afterAll(async () => {
    await stack?.cleanup();
    // eslint-disable-next-line no-console
    console.log(`[fuzz] total requests=${totalRequests} 429s=${total429} (${((total429 / Math.max(1, totalRequests)) * 100).toFixed(1)}%)`);
  });

  it("the registry bound a substantial route surface", () => {
    expect(ROUTES.length).toBeGreaterThan(60);
  });

  /* The four F3 oracles, per route, property-fuzzed. */
  for (const r of ROUTES) {
    const label = `${r.method} ${r.path}`;
    const numRuns = runsFor(r);

    it(`${label} — F3 oracles (${numRuns} runs)`, async () => {
      // auth is set in beforeAll, so resolve authFor INSIDE the test, not at
      // collection time (when `auth` is still undefined).
      const authFor = r.isPublic ? null : auth;
      // A route with a KNOWN, filed 5xx-on-valid bug (EXPECTED_5XX) does not fail
      // oracle 1 — the dedicated expected-failure test below tracks that it is
      // still broken and will go red when it is fixed.
      const knownFailure = expectedFailureFor(label);
      // Oracle 1 always applies: no 5xx on ANY input.
      // Oracle 2/3 apply to body routes (invalid→4xx, valid→not validation-400).
      // Oracle 4 applies whenever a 2xx carries a JSON response schema.
      const hasBody = r.bodySchema !== undefined;
      const destructive = isDestructive(r);

      // Build the arbitrary: for a body route, alternate valid/invalid bodies;
      // for a destructive route use invalid bodies only; for a no-body route a
      // constant undefined (the fuzzing then exercises the route with a
      // nonexistent / seeded id and no body).
      let bodyArb: fc.Arbitrary<{ kind: "valid" | "invalid" | "none"; value: unknown }>;
      if (!hasBody) {
        bodyArb = fc.constant({ kind: "none" as const, value: undefined });
      } else if (destructive) {
        bodyArb = invalidArb(r.bodySchema!, label).map((value) => ({ kind: "invalid" as const, value }));
      } else {
        try {
          const valid = validArb(r.bodySchema!, label).map((value) => ({ kind: "valid" as const, value }));
          const invalid = invalidArb(r.bodySchema!, label).map((value) => ({ kind: "invalid" as const, value }));
          bodyArb = fc.oneof(valid, invalid);
        } catch (err) {
          if (err instanceof UnsupportedSchemaError) {
            // Should not happen — F2 covers every bound schema — but fail loudly
            // rather than silently skipping a route.
            throw new Error(`${label}: generator could not build an arbitrary — ${String(err)}`);
          }
          throw err;
        }
      }

      // For {id} routes, also fuzz the path param (design §6). Half the runs
      // use a fuzzed (mostly non-UUID) id — which must be rejected 4xx by
      // ParseUUIDPipe, never reach the DB and 5xx — and half use the real
      // seeded id so valid-body oracles still exercise a reachable resource.
      const hasId = r.path.includes("{id}");
      const idArb: fc.Arbitrary<string | undefined> = hasId
        ? fc.oneof(ID_PARAM_ARB, fc.constant(undefined))
        : fc.constant(undefined);

      await fc.assert(
        fc.asyncProperty(bodyArb, idArb, async (sample, fuzzedId) => {
          const url = fillPath(r, resA, {
            nonexistentId: destructive && hasId,
            idOverride: fuzzedId,
          });
          const res = await send(r.method, url, authFor, sample.value);

          // Oracle 1 — never 5xx (except a known, filed, expected failure).
          if (is5xx(res.status) && !knownFailure) {
            throw new Error(
              `ORACLE 1 (no 5xx): ${label} returned ${res.status} on ${sample.kind} input\n` +
                `payload: ${JSON.stringify(sample.value)}\nbody: ${JSON.stringify(res.json)?.slice(0, 400)}`,
            );
          }
          // Oracle 2 — contract-invalid body gets a 4xx.
          if (sample.kind === "invalid") {
            if (!is4xx(res.status)) {
              throw new Error(
                `ORACLE 2 (invalid→4xx): ${label} returned ${res.status} on invalid input\n` +
                  `payload: ${JSON.stringify(sample.value)}`,
              );
            }
          }
          // Oracle 3 — contract-valid body never gets the VALIDATION 400.
          if (sample.kind === "valid" && isValidationError(res.status, res.json)) {
            throw new Error(
              `ORACLE 3 (valid never validation-400): ${label} rejected a contract-VALID body — ` +
                `controller and registry disagree.\npayload: ${JSON.stringify(sample.value)}\n` +
                `issues: ${JSON.stringify((res.json as { issues?: unknown }).issues)}`,
            );
          }
          // Oracle 4 — a 2xx body parses against the registry's response schema.
          if (is2xx(res.status)) {
            const schema = r.responses.get(res.status);
            if (schema && res.json !== undefined) {
              const parsed = schema.safeParse(res.json);
              if (!parsed.success) {
                throw new Error(
                  `ORACLE 4 (2xx parses): ${label} ${res.status} body does not match the response schema\n` +
                    `body: ${JSON.stringify(res.json)?.slice(0, 400)}\n` +
                    `issues: ${JSON.stringify(parsed.error.issues)?.slice(0, 400)}`,
                );
              }
            }
          }
        }),
        { numRuns, seed: FUZZ_SEED, verbose: true },
      );
    }, TEST_TIMEOUT_MS);
  }

  /* Transport-level invalids per body route — malformed JSON, wrong
     content-type, empty body where one is required. All must be 4xx, never 5xx
     (settles main.ts's never-checked JSON-parse path). Throttled routes are
     skipped here to preserve their tiny budget for the oracle property above. */
  describe("transport-level invalids are 4xx, never 5xx", () => {
    for (const r of ROUTES) {
      if (r.bodySchema === undefined) continue; // only body routes
      if (isThrottled(r)) continue; // preserve the throttle budget
      const label = `${r.method} ${r.path}`;
      const url = () => fillPath(r, resA, { nonexistentId: isDestructive(r) && r.path.includes("{id}") });

      it(`${label} — malformed JSON → 4xx`, async () => {
        const authFor = r.isPublic ? null : auth;
        const res = await send(r.method, url(), authFor, undefined, { raw: "{ not json ", contentType: "application/json" });
        expect(is5xx(res.status), `malformed JSON gave ${res.status}`).toBe(false);
        expect(is4xx(res.status), `malformed JSON gave ${res.status}, expected 4xx`).toBe(true);
      });

      it(`${label} — wrong content-type → 4xx`, async () => {
        const authFor = r.isPublic ? null : auth;
        const res = await send(r.method, url(), authFor, undefined, { raw: "plain text body", contentType: "text/plain" });
        expect(is5xx(res.status), `wrong content-type gave ${res.status}`).toBe(false);
        expect(is4xx(res.status), `wrong content-type gave ${res.status}, expected 4xx`).toBe(true);
      });

      it(`${label} — empty body → 4xx`, async () => {
        const authFor = r.isPublic ? null : auth;
        const res = await send(r.method, url(), authFor, undefined, { raw: "", contentType: "application/json" });
        expect(is5xx(res.status), `empty body gave ${res.status}`).toBe(false);
        expect(is4xx(res.status), `empty body gave ${res.status}, expected 4xx`).toBe(true);
      });
    }
  });

  /* Expected failures (design M5 / issue "mark as expected failure"): each known
     5xx-on-valid case must STILL 5xx. When the linked issue is fixed the case
     stops 5xx'ing, this test goes red, and whoever fixed it must delete the
     EXPECTED_5XX entry (and the oracle-1 suppression goes with it). */
  describe("known 5xx-on-valid cases are still broken (expected failures)", () => {
    for (const ef of EXPECTED_5XX) {
      it(`${ef.route} still 500s on the input filed in #${ef.issue} — remove the marker when fixed`, async () => {
        const [method, path] = [ef.route.slice(0, ef.route.indexOf(" ")) as Method, ef.route.slice(ef.route.indexOf(" ") + 1)];
        const authFor = ROUTES.find((x) => `${x.method} ${x.path}` === ef.route)?.isPublic ? null : auth;
        const url = fillPath({ method, path } as RouteDef, resA);
        const res = await send(method, url, authFor, ef.body);
        expect(
          is5xx(res.status),
          `${ef.route} no longer 5xx on the #${ef.issue} input (got ${res.status}) — it appears FIXED. ` +
            `Remove the EXPECTED_5XX entry and the oracle-1 suppression, then close #${ef.issue}.`,
        ).toBe(true);
      });
    }
  });

  /* 429 budget (design §6): more than 5% means the budget is wrong, not the API.
     Asserted last so it sees the whole run's tally. */
  it("fewer than 5% of all requests were 429", () => {
    const rate = total429 / Math.max(1, totalRequests);
    expect(rate, `429 rate ${(rate * 100).toFixed(1)}% (${total429}/${totalRequests}) — raise THROTTLE_LIMIT or lower sample counts`).toBeLessThan(0.05);
  });
});
