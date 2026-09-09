import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fixtureRequest, FIXTURE_ROUTE_PATTERNS } from "./fixtures";
import { FIXTURE_PARITY_ALLOWLIST } from "./fixture-parity.allowlist";

/*
 * Fixture-parity guard (issue #354). web/src/lib/api/fixtures.ts is a hand-kept
 * fake backend; when the real API grows a route with no fixture branch, the UI
 * looks like it works but is entirely fake. This test fails the build on drift in
 * BOTH directions, against the API's own route surface serialized as data in
 * openapi.generated.json (emitted by apps/api/scripts/emit-openapi.mjs — the route
 * list crosses the web<->apps boundary as JSON, never as a source import).
 */

const here = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(resolve(here, "./openapi.generated.json"), "utf8")) as Record<string, string[]>;

// Flatten the OpenAPI paths into {method, path} pairs — the live API surface.
const apiRoutes = Object.entries(doc).flatMap(([path, methods]) =>
  methods.map((method) => ({ method: method.toUpperCase(), path })),
);

const DUMMY = "sample-id";
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, DUMMY);

const isAllowed = (method: string, path: string) =>
  FIXTURE_PARITY_ALLOWLIST.some((e) => e.method.toUpperCase() === method && e.path === path);

/** Ask the REAL dispatcher whether a branch handles (method, concrete path).
 *  The dispatcher throws "No fixture for ..." only when nothing matched; any
 *  other throw means a branch DID match but choked on our dummy body/schema —
 *  which still counts as "a branch exists". */
async function hasFixtureBranch(method: string, path: string): Promise<boolean> {
  try {
    await fixtureRequest(concrete(path), z.any(), { method, body: {} });
    return true;
  } catch (err) {
    // The dispatcher's no-branch sentinel is exactly "No fixture for <METHOD> <path>.".
    // Match that precisely — a branch's own not-found error ("No fixture form ...",
    // "No fixture link ...", "No fixture domain ...") means a branch DID match.
    return !/^No fixture for [A-Z]+ /.test(String((err as Error).message));
  }
}

describe("fixture parity: every API route has a fixture branch (direction 1)", () => {
  for (const { method, path } of apiRoutes) {
    const testName = `${method} ${path}`;
    it(testName, async () => {
      if (isAllowed(method, path)) return; // intentional gap, documented in the allowlist
      const covered = await hasFixtureBranch(method, path);
      expect(
        covered,
        `${testName} is a live API route with no branch in fixtures.ts. Add a fixture branch, or add an explicit, reasoned entry to fixture-parity.allowlist.ts.`,
      ).toBe(true);
    });
  }
});

describe("fixture parity: every fixture branch maps to a live API route (direction 2)", () => {
  for (const branch of FIXTURE_ROUTE_PATTERNS) {
    for (const method of branch.methods) {
      const label = `${method} ${branch.pattern}`;
      it(label, () => {
        const matchesLiveRoute = apiRoutes.some(
          (r) => r.method === method && branch.pattern.test(concrete(r.path)),
        );
        const matchesAllowlisted = FIXTURE_PARITY_ALLOWLIST.some(
          (e) => e.method.toUpperCase() === method && branch.pattern.test(concrete(e.path)),
        );
        expect(
          matchesLiveRoute || matchesAllowlisted,
          `${label} is a fixture branch that matches no live API route. The route was likely removed/renamed — delete the stale branch, or allowlist it.`,
        ).toBe(true);
      });
    }
  }
});

describe("fixture parity: the declared pattern list stays in sync with the dispatcher", () => {
  // Each declared (method, pattern) must actually resolve in the real dispatcher,
  // so FIXTURE_ROUTE_PATTERNS cannot claim a branch the chain does not have. We
  // build a concrete sample path from the pattern and probe the real dispatcher.
  const sampleFor = (pattern: RegExp) =>
    pattern.source
      .replace(/^\^/, "")
      .replace(/\$$/, "")
      .replace(/\\\//g, "/")
      .replace(/\(\[\^\/\]\+\)/g, DUMMY)
      .replace(/\(([a-z|]+)\)/g, (_m, alts: string) => alts.split("|")[0]);

  for (const branch of FIXTURE_ROUTE_PATTERNS) {
    for (const method of branch.methods) {
      const samplePath = sampleFor(branch.pattern);
      it(`${method} ${samplePath} resolves in the dispatcher`, async () => {
        const resolved = await hasFixtureBranch(method, samplePath);
        expect(
          resolved,
          `FIXTURE_ROUTE_PATTERNS declares ${method} ${branch.pattern} but the dispatcher does not recognize ${method} ${samplePath} — the list drifted from the if/else chain.`,
        ).toBe(true);
      });
    }
  }

  it("the allowlist has a reason for every entry", () => {
    for (const e of FIXTURE_PARITY_ALLOWLIST) {
      expect(e.reason.trim().length, `Allowlist entry ${e.method} ${e.path} needs a non-empty reason`).toBeGreaterThan(0);
    }
  });
});
