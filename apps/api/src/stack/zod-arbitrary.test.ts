import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";

/* ============================================================
   F2 — the generator's self-check.

   For EVERY request schema the OpenAPI registry binds (every route's body,
   params and query), 200 `validArb` samples must all pass `safeParse` and 200
   `invalidArb` samples must all fail it. A fixed seed makes failures replayable.

   This is a plain unit test (`*.test.ts`), so it runs in the normal `pnpm test`
   without a stack (design §2). It is the oracle that lets the HTTP fuzzer (F3)
   trust the arbitraries this generator produces.

   --- Why the gymnastics below ---

   `apps/api/src/openapi/registry.ts` calls `extendZodWithOpenApi(z)` and only
   THEN imports `@snapurl/contract`, because the patch that gives every schema
   its `.openapi()` reaches only schemas constructed AFTER it runs. That holds
   when the app runs on its compiled CommonJS output (imports run in source
   order). Under Vitest two things break it:
     1. esbuild HOISTS every static `import` to the top of the module, so a
        static `import { registry }` here would construct the contract schemas
        before the patch — `registry.register` then throws "openapi is not a
        function".
     2. Vitest serves first-party `.ts` as ESM but externalises `node_modules`
        as CommonJS, so an `import { z } from "zod"` and the `require("zod")`
        inside the contract dist can be DIFFERENT instances; patching one leaves
        the other unpatched.

   So this file patches the SAME CommonJS zod the externalised contract uses
   (via `createRequire`) FIRST, then pulls in the registry, the path modules and
   the generator through a top-level `await import()` — a dynamic import is not
   hoisted, so the ordering is honoured and nothing needs a Vitest setupFile.
   ============================================================ */

// 1. Patch zod BEFORE anything imports the contract.
const require = createRequire(import.meta.url);
const { extendZodWithOpenApi } = require("@asteasolutions/zod-to-openapi") as {
  extendZodWithOpenApi: (zod: typeof z) => void;
};
extendZodWithOpenApi(require("zod").z);

// 2. Now it is safe to load the registry, populate it, and load the generator.
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
const { invalidArb, validArb } = await import("./zod-arbitrary.js");

const SEED = 889_2026;
const SAMPLES = 200;
// 200 full safeParse runs per schema (plus fast-check shrinking on a failure)
// can exceed Vitest's 5s default when the suite runs in parallel on a loaded
// CI box, so give each property its own generous budget. It is headroom, not a
// slow test: each property finishes in tens of ms in isolation.
const TEST_TIMEOUT_MS = 30_000;

interface BoundSchema {
  label: string;
  schema: z.ZodType;
}

/** Collect every request schema (body, params, query) the registry binds to a
 *  route, de-duplicated by label. */
function collectRequestSchemas(): BoundSchema[] {
  const out: BoundSchema[] = [];
  const seen = new Set<string>();
  const push = (label: string, schema: unknown) => {
    if (!(schema instanceof z.ZodType)) return; // skip any raw SchemaObject
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ label, schema });
  };

  for (const d of registry.definitions) {
    if (d.type !== "route") continue;
    const { method, path, request } = d.route;
    if (!request) continue;
    const where = `${method.toUpperCase()} ${path}`;

    if (request.params) push(`${where} [params]`, request.params);
    if (request.query) push(`${where} [query]`, request.query);
    if (request.body?.content) {
      for (const [contentType, media] of Object.entries(request.body.content)) {
        push(`${where} [body ${contentType}]`, (media as { schema?: unknown })?.schema);
      }
    }
  }
  return out;
}

const bound = collectRequestSchemas();

describe("zod-arbitrary generator self-check (F2)", () => {
  it("binds a substantial set of request schemas from the registry", () => {
    // Guards against a silent collector regression: if this hit 0 every
    // per-schema test below would vacuously pass.
    expect(bound.length).toBeGreaterThan(20);
  });

  describe("every valid sample passes safeParse", () => {
    for (const { label, schema } of bound) {
      it(`${label}: ${SAMPLES} valid samples all parse`, () => {
        fc.assert(
          fc.property(validArb(schema, label), (value) => {
            const result = schema.safeParse(value);
            if (!result.success) {
              throw new Error(
                `valid sample REJECTED by ${label}: ${JSON.stringify(value)}\n` +
                  `issues: ${JSON.stringify(result.error.issues)}`,
              );
            }
          }),
          { numRuns: SAMPLES, seed: SEED },
        );
      }, TEST_TIMEOUT_MS);
    }
  });

  describe("every invalid sample fails safeParse", () => {
    for (const { label, schema } of bound) {
      it(`${label}: ${SAMPLES} invalid samples all fail`, () => {
        fc.assert(
          fc.property(invalidArb(schema, label), (value) => {
            const result = schema.safeParse(value);
            if (result.success) {
              throw new Error(
                `invalid sample ACCEPTED by ${label}: ${JSON.stringify(value)}\n` +
                  `parsed as: ${JSON.stringify(result.data)}`,
              );
            }
          }),
          { numRuns: SAMPLES, seed: SEED },
        );
      }, TEST_TIMEOUT_MS);
    }
  });

  // The generator's contract: NO silent fc.anything() fallback. An unmodelled
  // construct must throw and name the path, so a schema the walker cannot honour
  // is a loud failure rather than fake coverage.
  describe("throws (never silently generates) on an unsupported construct", () => {
    it("validArb throws on z.date(), naming the path", () => {
      expect(() => validArb(z.date(), "SomeSchema.when")).toThrowError(/unsupported zod type "date" at SomeSchema\.when/);
    });

    it("invalidArb throws on z.date(), naming the path", () => {
      expect(() => invalidArb(z.date(), "SomeSchema.when")).toThrowError(/unsupported zod type "date" at SomeSchema\.when/);
    });

    it("validArb throws on a .refine() string with no override, pointing at OVERRIDES", () => {
      const refined = z.string().refine(() => true);
      expect(() => validArb(refined, "Mystery.field")).toThrowError(/custom check at Mystery\.field has no override/);
    });

    it("validArb throws on an object-level .refine() with no override", () => {
      const refinedObj = z.object({ a: z.string() }).refine(() => true);
      expect(() => validArb(refinedObj, "Mystery")).toThrowError(/object-level \.refine\(\) at Mystery has no override/);
    });
  });
});
