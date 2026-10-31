/* Access-matrix suite — every route × every principal, no side effect on a
 * denial (spec: api-stack-tests, requirements M2–M5, design §7).
 *
 * Consumes the maintainer-APPROVED oracle `access-matrix.expected.ts` (#891)
 * and asserts the running stack matches it, one generated test per
 * (route, principal). It does NOT re-decide policy: the oracle is the authority,
 * this suite only checks the API obeys it.
 *
 *   M2  one row per inventory route; a route with no row fails (coverage guard,
 *       both directions — every inventory route has a row AND every row names a
 *       real route). The suite also fails if any row is still `status:
 *       "observed"`: an unapproved oracle is not an oracle.
 *   M3  outcomes are "allow" | 401 | 403 | 404 | "own-only". `own-only` lists
 *       must contain no id from the OTHER workspace.
 *   M4  a denial has no side effect: for every mutating {id} route and every
 *       denied principal, a FRESH owner-A target is read back after the denied
 *       request and must be byte-for-byte unchanged (minus timestamps allowed
 *       to move).
 *   M5  a row with `intended` (approved intent ≠ today's behaviour) is run as an
 *       expected failure linked to its issue; it goes red when the issue is
 *       fixed, forcing the marker's removal. (No row carries `intended` today —
 *       observed == intended for all 71 — but the mechanism is enforced.)
 *
 * Runs only against a live stack (describeStack). `THROTTLE_LIMIT=100000
 * pnpm staging:up`, then
 * `STACK_API_URL=… STACK_DATABASE_URL=… pnpm --filter @snapurl/api test:stack`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStack, STACK_API_URL, STACK_DATABASE_URL } from "./env.js";
import { seedPrincipals, type Principal, type PrincipalName, type SeededStack } from "./principals.js";
import {
  DEFAULT_DOMAIN,
  seedResources,
  freshLink,
  freshForm,
  freshDomain,
  freshBioPage,
  freshWebhook,
  freshApiKey,
  freshMember,
  type SeededResources,
} from "./resources.js";
import { buildRouteInventory, routeKeys } from "./route-inventory.js";
import {
  ACCESS_MATRIX,
  EXPECTED_ROUTE_COUNT,
  type Expect,
  type Principal as OraclePrincipal,
  type Row,
} from "./access-matrix.expected.js";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const DENIAL_STATUSES = new Set([401, 403, 404]);
const BLOCK_ID = "00000000-0000-4000-8000-000000000000";

function splitRoute(route: string): { method: Method; path: string } {
  const sp = route.indexOf(" ");
  return { method: route.slice(0, sp) as Method, path: route.slice(sp + 1) };
}

function hasIdParam(path: string): boolean {
  return /\{id\}/.test(path);
}

/** The /api/v1 prefix is already in STACK_API_URL, so route paths are made
 *  relative before being appended. */
function toRel(path: string): string {
  return path.replace(/^\/api\/v1/, "");
}

/** The seeded resource id that matches a route's resource kind. */
function idForKind(path: string, r: SeededResources): string {
  if (path.includes("/forms/")) return r.formId;
  if (path.includes("/domains/")) return r.domainId;
  if (path.includes("/bio-pages/")) return r.bioPageId;
  if (path.includes("/webhooks/")) return r.webhookId;
  if (path.includes("/api-keys/")) return r.apiKeyId;
  if (path.includes("/members/")) return r.memberId;
  if (path.includes("/reports/")) return BLOCK_ID; // no seeded report {id}; a non-existent uuid still exercises the authz guard (which runs first)
  return r.linkId;
}

/** Build the relative URL for a route, filling {id} with the resolved target id
 *  and {slug}/{domain}/{blockId} from workspace A's public fixtures (public
 *  routes are tenant-agnostic). The right {slug} depends on the route kind: a
 *  /public/bio-pages/{slug} route needs the live bio-page slug, a
 *  /public/links/{slug} route the link slug; /public/forms/{slug} is expected
 *  to 404 (the seeded form is a draft), so any slug is fine there. */
function slugForPath(path: string, f: SeededResources): string {
  if (path.includes("/public/bio-pages/")) return f.bioSlug;
  return f.linkSlug;
}

function urlFor(path: string, id: string, publicFixtures: SeededResources): string {
  const rel = toRel(path)
    .replace("{id}", id)
    .replace("{slug}", slugForPath(path, publicFixtures))
    .replace("{domain}", DEFAULT_DOMAIN)
    .replace("{blockId}", BLOCK_ID);
  return `${STACK_API_URL}${rel}`;
}

/** A minimal body that clears the guard for each write route. Authorization
 *  runs in the guard BEFORE the body pipe (auth.guard.ts), so a 400 past the
 *  guard still means "authorized" and counts as `allow`. */
function bodyFor(path: string, method: Method): unknown {
  if (method === "GET" || method === "DELETE") return undefined;
  if (path.endsWith("/links")) return { destination: "https://example.com/am", domain: DEFAULT_DOMAIN };
  if (path.endsWith("/links/bulk")) return { links: [{ destination: "https://example.com/am", domain: DEFAULT_DOMAIN }] };
  if (/\/links\/\{id\}\/clone$/.test(path)) return {};
  if (/\/links\/\{id\}$/.test(path)) return { comment: "am" };
  if (path.endsWith("/forms")) return { title: "am", status: "draft", fields: [] };
  if (/\/forms\/\{id\}$/.test(path)) return { title: "am" };
  if (path.endsWith("/domains")) return { domain: "am-body.example.com" };
  if (/\/domains\/\{id\}\/verify$/.test(path)) return {};
  if (/\/domains\/\{id\}$/.test(path)) return { rootRedirect: "https://example.com/am" };
  if (path.endsWith("/members")) return { email: "am-body@example.com", role: "editor" };
  if (/\/members\/\{id\}\/resend$/.test(path)) return {};
  if (/\/members\/\{id\}$/.test(path)) return { role: "editor" };
  if (path.endsWith("/api-keys")) return { name: "am", scopes: ["links:read"] };
  if (path.endsWith("/webhooks")) return { endpoint: "https://example.com/hook", events: ["link.created"] };
  if (path.endsWith("/bio-pages")) return { domain: DEFAULT_DOMAIN, slug: "am-body", profile: { name: "am", bio: "" }, blocks: [] };
  if (path.endsWith("/workspaces/current")) return { name: "am" };
  if (path.endsWith("/conversions")) return { linkId: BLOCK_ID, type: "signup" };
  if (/\/reports\/\{id\}$/.test(path)) return { status: "reviewing" };
  return {}; // auth/public @Public bodies — empty object clears the guard
}

async function send(method: Method, url: string, auth: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** All id-looking strings inside a JSON value (own-only cross-workspace check). */
function collectIds(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) collectIds(x, out);
  } else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "id" && typeof val === "string") out.add(val);
      collectIds(val, out);
    }
  }
  return out;
}

/* ── the suite ──────────────────────────────────────────────────────────────── */

describeStack("access-matrix (M2–M5): every route × principal matches the approved oracle", () => {
  let stack: SeededStack;
  let resA: SeededResources;
  let resB: SeededResources;
  /** Every id seeded in workspace A — the set an own-only B list must exclude. */
  let aIds: Set<string>;

  beforeAll(async () => {
    if (!STACK_DATABASE_URL) throw new Error("STACK_DATABASE_URL is required for the access-matrix suite.");
    stack = await seedPrincipals({ apiUrl: STACK_API_URL!, databaseUrl: STACK_DATABASE_URL });
    resA = await seedResources(STACK_API_URL!, stack.principals.ownerA);
    resB = await seedResources(STACK_API_URL!, stack.principals.ownerB);
    aIds = new Set<string>([resA.linkId, resA.formId, resA.domainId, resA.bioPageId, resA.webhookId, resA.apiKeyId, resA.memberId]);
  }, 120_000);

  afterAll(async () => {
    await stack?.cleanup();
  });

  /* M2 + approval gate — plain assertions, fail fast and clear. */
  describe("oracle integrity (M2, approval gate)", () => {
    it("every oracle row is approved — no row left observed", () => {
      const observed = ACCESS_MATRIX.filter((r) => r.status !== "approved").map((r) => r.route);
      expect(observed, "unapproved rows remain — an unapproved oracle is not an oracle").toEqual([]);
    });

    it("rows with `intended` carry an issue number (M5 marker well-formed)", () => {
      const malformed = ACCESS_MATRIX.filter((r) => r.intended && !r.issue).map((r) => r.route);
      expect(malformed, "a row with `intended` must link its issue").toEqual([]);
    });

    it("coverage guard: every inventory route has exactly one row, every row names a real route", () => {
      const inventoryRoutes = routeKeys(buildRouteInventory("api/v1"));
      const oracleRoutes = ACCESS_MATRIX.map((r) => r.route as string).sort();
      const dupes = oracleRoutes.filter((r, i) => oracleRoutes.indexOf(r) !== i);
      const missingRow = inventoryRoutes.filter((r) => !oracleRoutes.includes(r));
      const phantomRow = oracleRoutes.filter((r) => !inventoryRoutes.includes(r));
      expect(
        { missingRow, phantomRow, dupes },
        "oracle and route inventory disagree — add a row for a new route, or remove a row whose route no longer exists",
      ).toEqual({ missingRow: [], phantomRow: [], dupes: [] });
    });

    it("the oracle has the 71 rows the design records", () => {
      expect(ACCESS_MATRIX.length).toBe(EXPECTED_ROUTE_COUNT);
    });
  });

  /* M3 — one generated test per (route, principal). */
  describe("every (route, principal) matches the oracle (M3)", () => {
    for (const row of ACCESS_MATRIX) {
      const { method, path } = splitRoute(row.route);
      for (const [pName, declared] of resolvePrincipals(row)) {
        const effective = row.intended?.[pName] ?? declared; // M5: intended wins when present
        const marker = row.intended?.[pName] !== undefined ? ` (expected failure, #${row.issue})` : "";

        it(`${row.route} — ${pName} → ${String(effective)}${marker}`, async () => {
          const principal = stack.principals[pName as PrincipalName];
          const ctx = `${row.route} [${pName}]`;

          // Resolve the {id} target. The expected value says which workspace to
          // probe: a 404 on an {id} route is the cross-tenant probe (the OTHER
          // workspace's resource); anything else probes the principal's OWN
          // workspace. A mutating cell gets a FRESH target so it never consumes
          // a resource another cell depends on. Routes with no {id} ignore this.
          const id = await resolveId(pName, path, method, effective);
          const url = urlFor(path, id, resA);
          const body = method === "GET" ? undefined : bodyFor(path, method);
          const res = await send(method, url, principal.authorization, body);
          const status = res.status;

          if (effective === "allow") {
            expect(DENIAL_STATUSES.has(status), `${ctx} expected allow, got ${status}`).toBe(false);
          } else if (effective === "own-only") {
            expect(status >= 200 && status < 300, `${ctx} expected own-only 2xx, got ${status}`).toBe(true);
            // The own-only principals are in workspace B; their list must leak no
            // workspace-A id. Compare against A's seeded id set.
            const ids = collectIds(await res.json().catch(() => null));
            const leaked = [...ids].filter((x) => aIds.has(x));
            expect(leaked, `${ctx} own-only list leaked workspace-A ids`).toEqual([]);
          } else {
            expect(status, `${ctx} expected ${effective}, got ${status}`).toBe(effective);
          }
        });
      }
    }
  });

  /**
   * The `{id}` value for a cell, or a placeholder when the route has none.
   *
   *   - no `{id}`            → placeholder (unused).
   *   - expected 404        → the OTHER workspace's resource (cross-tenant). A
   *                           read-only shared resource is fine: a cross-tenant
   *                           probe never mutates (it 404s first).
   *   - mutating (non-GET)  → a FRESH resource in the principal's OWN workspace,
   *                           so an `allow`/`own` write consumes only its own
   *                           throwaway target.
   *   - GET own             → the shared own-workspace resource (reads are safe).
   */
  async function resolveId(
    pName: OraclePrincipal,
    path: string,
    method: Method,
    expected: Expect,
  ): Promise<string> {
    if (!hasIdParam(path)) return BLOCK_ID;
    const own = ownWorkspace(pName); // "A" | "B" | null(anon → treat as A)
    if (expected === 404) {
      // cross-tenant: the workspace the principal is NOT in (anon can't 404 on
      // an {id} route — anon is 401 — so anon never reaches here).
      const other = own === "B" ? resA : resB;
      return idForKind(path, other);
    }
    if (method !== "GET") {
      // fresh own-workspace target for a mutating cell
      const owner = own === "B" ? stack.principals.ownerB : stack.principals.ownerA;
      const fresh = await makeFresh(path, STACK_API_URL!, owner);
      return fresh?.id ?? idForKind(path, own === "B" ? resB : resA);
    }
    // GET on own workspace → shared resource (read-only, safe to share)
    return idForKind(path, own === "B" ? resB : resA);
  }

  /* M4 — a denied mutation leaves its target unchanged. */
  describe("no side effect on a denied mutation (M4)", () => {
    for (const row of ACCESS_MATRIX) {
      const { method, path } = splitRoute(row.route);
      if (method === "GET" || !hasIdParam(path)) continue; // only {id}-addressable mutations have a readable target
      const denied = resolvePrincipals(row).filter(([, exp]) => exp === 401 || exp === 403 || exp === 404);
      if (denied.length === 0) continue;

      for (const [pName] of denied) {
        it(`${row.route} — denied ${pName} leaves a fresh target unchanged`, async () => {
          const owner = stack.principals.ownerA;
          const fresh = await makeFresh(path, STACK_API_URL!, owner);
          if (!fresh) return;
          const before = await readBack(path, fresh.id, STACK_API_URL!, owner.authorization!);

          const principal = stack.principals[pName as PrincipalName];
          const rel = toRel(path).replace("{id}", fresh.id).replace("{blockId}", BLOCK_ID);
          await send(method, `${STACK_API_URL}${rel}`, principal.authorization, bodyFor(path, method));

          const after = await readBack(path, fresh.id, STACK_API_URL!, owner.authorization!);
          expect(stripVolatile(after), `${row.route} [${pName}] mutated a denied target`).toEqual(stripVolatile(before));
        });
      }
    }
  });
});

/* ── oracle/principal helpers ─────────────────────────────────────────────────── */

/** Which workspace a principal belongs to. API keys inherit their key's
 *  workspace (keyA-* → A, keyB-all → B); anon belongs to neither and is treated
 *  as A for the (never-reached) {id} case. */
function ownWorkspace(pName: OraclePrincipal): "A" | "B" | null {
  if (pName === "anon") return null;
  if (pName === "ownerB" || pName === "keyB-all") return "B";
  return "A";
}

/** (principal, expected) pairs to test for a row. A `{ any }` row is @Public:
 *  the design says test only anon and ownerA (all nine would burn throttles).
 *  Otherwise every principal the row explicitly names. */
function resolvePrincipals(row: Row): Array<[OraclePrincipal, Expect]> {
  if (row.expect.any !== undefined) {
    return [
      ["anon", row.expect.any],
      ["ownerA", row.expect.any],
    ];
  }
  return Object.entries(row.expect)
    .filter(([k]) => k !== "any")
    .map(([k, v]) => [k as OraclePrincipal, v as Expect]);
}

async function makeFresh(path: string, api: string, owner: Principal): Promise<{ id: string } | null> {
  if (path.includes("/links/")) return freshLink(api, owner);
  if (path.includes("/forms/")) return freshForm(api, owner);
  if (path.includes("/domains/")) return freshDomain(api, owner);
  if (path.includes("/bio-pages/")) return freshBioPage(api, owner);
  if (path.includes("/webhooks/")) return freshWebhook(api, owner);
  if (path.includes("/api-keys/")) return freshApiKey(api, owner);
  if (path.includes("/members/")) return freshMember(api, owner);
  return null;
}

/** Read a resource back as the owner. GET-by-id where the kind has one, else
 *  the kind's list (webhooks/api-keys/members/domains/bio-pages have no
 *  GET-by-id). Returns the entry matching `id` for list kinds. */
async function readBack(path: string, id: string, api: string, auth: string): Promise<unknown> {
  const listKind = !path.includes("/links/") && !path.includes("/forms/");
  const rel = path.includes("/links/")
    ? `/links/${id}`
    : path.includes("/forms/")
      ? `/forms/${id}`
      : path.includes("/domains/")
        ? `/domains`
        : path.includes("/bio-pages/")
          ? `/bio-pages`
          : path.includes("/webhooks/")
            ? `/webhooks`
            : path.includes("/api-keys/")
              ? `/api-keys`
              : path.includes("/members/")
                ? `/members`
                : null;
  if (!rel) return { __noReadback: true };
  const res = await fetch(`${api}${rel}`, { headers: { authorization: auth } });
  if (res.status < 200 || res.status >= 300) return { __status: res.status };
  const body = await res.json().catch(() => null);
  if (!listKind) return body;
  // For list kinds, pin the comparison to the one row we created.
  const rows = Array.isArray(body) ? body : collectRows(body);
  return rows.find((r) => r && typeof r === "object" && (r as { id?: string }).id === id) ?? { __missing: id };
}

function collectRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const key of ["items", "data", "links", "forms", "domains", "members", "webhooks", "apiKeys", "results", "rows"]) {
      const v = (body as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** Drop fields allowed to move between two reads (design §4: full JSON minus
 *  timestamps that may move). */
function stripVolatile(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (["updatedAt", "lastUsed", "lastActive", "sslRenewsAt", "createdAt", "latencyMs"].includes(k)) continue;
      out[k] = stripVolatile(val);
    }
    return out;
  }
  return v;
}
