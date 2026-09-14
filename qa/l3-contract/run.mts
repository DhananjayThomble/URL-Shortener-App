/*
 * L3 — API <-> contract differential.
 *
 * Drives the REAL running API (never a mock, never the fixtures used by
 * e2e/) and checks every response it sends against the exact zod schema
 * `apps/api/src/openapi/registry.ts` says answers that route — which is the
 * same schema web/ imports from `@snapurl/contract` to type what it consumes.
 *
 * Oracle: `@snapurl/contract`'s schemas, reached via the registry's route
 * table so "which schema is the oracle for this route" is never something
 * this script decides for itself — it reads the answer the codebase already
 * committed to in openapi/paths/*.ts. See qa/l3-contract/README.md.
 *
 * Every safeParse failure, every response field the schema does not mention,
 * and every .strict() rejection is written to
 * .qa-runs/l3-contract/findings.jsonl as evidence, not as a verdict
 * (steering §2). Nothing here decides whether a mismatch is "a bug" — it
 * records what was sent, what was expected, and what came back.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../..");
const API_BASE = process.env.API_BASE ?? "http://localhost:3001/api/v1";
const RUN_DIR = resolve(REPO_ROOT, ".qa-runs/l3-contract");
const FINDINGS_PATH = resolve(RUN_DIR, "findings.jsonl");

mkdirSync(RUN_DIR, { recursive: true });
// Truncate findings.jsonl at the start of each run — this is a per-run report,
// not an accumulating log across runs.
writeFileSync(FINDINGS_PATH, "");

// ---------------------------------------------------------------------------
// Load the route table straight from the registry the API itself boots from,
// not from the serialized OpenAPI JSON — the JSON loses the zod schema's
// object identity, which is what lets this script call the SAME schema
// object `.safeParse()` rather than a re-derived shape.
// ---------------------------------------------------------------------------
const documentModule = await import(resolve(REPO_ROOT, "apps/api/dist/openapi/document.js"));
documentModule.buildOpenApiDocument("api/v1"); // populates registry.definitions as a side effect
const registryModule = await import(resolve(REPO_ROOT, "apps/api/dist/openapi/registry.js"));

interface RouteDef {
  method: string;
  path: string; // "{id}" style, as declared
  tags: string[];
  summary: string;
  security: unknown[];
  request: {
    params?: z.ZodTypeAny;
    query?: z.ZodTypeAny;
    body?: { content: Record<string, { schema: z.ZodTypeAny }> };
  };
  responses: Record<string, { description: string; content?: Record<string, { schema: z.ZodTypeAny }> }>;
}

const routeDefs: RouteDef[] = registryModule.registry.definitions
  .filter((d: { type: string }) => d.type === "route")
  .map((d: { route: RouteDef }) => d.route);

console.log(`Loaded ${routeDefs.length} route definitions from the OpenAPI registry.`);

// ---------------------------------------------------------------------------
// Finding + result bookkeeping
// ---------------------------------------------------------------------------
interface Finding {
  id: string;
  layer: string;
  title: string;
  target: string;
  what_i_did: string;
  expected: string;
  observed: string;
  evidence: string[];
  repro: string;
  severity_hint: string;
  confidence: string;
  notes?: string;
}

function writeFinding(f: Finding): void {
  appendFileSync(FINDINGS_PATH, JSON.stringify(f) + "\n");
}

type Kind = "missing" | "null-drift" | "type" | "undocumented-extra-field" | "strict-reject" | "http-error" | "unreachable" | "undocumented-route";

interface DriftRow {
  route: string;
  method: string;
  field: string;
  schemaSays: string;
  apiReturned: string;
  kind: Kind;
}

const driftRows: DriftRow[] = [];
const coverageGaps: string[] = [];
let routesChecked = 0;
let routesClean = 0;
let routesDrifted = 0;
let routesUnreachable = 0;

// A response can drift in more than one field; track distinct (route, kind)
// so findings.jsonl gets one entry per distinct drift with a recurrence count,
// per the brief.
const findingCounts = new Map<string, number>();
function recordDrift(row: DriftRow, finding: Omit<Finding, "id">): void {
  driftRows.push(row);
  const key = `${row.method} ${row.route} :: ${row.field} :: ${row.kind}`;
  const n = (findingCounts.get(key) ?? 0) + 1;
  findingCounts.set(key, n);
  if (n === 1) {
    // First occurrence: write the finding. Later occurrences of the exact
    // same (route, field, kind) just bump the drift table's implicit count —
    // rewriting the same finding.jsonl line repeatedly adds nothing.
    writeFinding({
      id: key
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 120),
      ...finding,
    });
  }
}

// ---------------------------------------------------------------------------
// Route-enumeration completeness: does the registry's route table (the thing
// `buildOpenApiDocument()` walks, and the thing this whole script trusts to
// name "every GET/mutating route") actually name every route the NestJS
// controllers declare?
//
// Oracle here is the controller source itself — not because it's the payload
// oracle (steering §1 forbids that), but because "which routes exist" is a
// question about the real Nest route table, and @Controller()/@Get() etc.
// ARE that route table; nothing in @snapurl/contract or packages/domain
// states it independently. This is a structural completeness check on the
// enumeration step (task item 1 of the brief), not a payload-shape check.
// ---------------------------------------------------------------------------
{
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const apiSrc = resolve(REPO_ROOT, "apps/api/src");
  const controllerFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".controller.ts")) controllerFiles.push(full);
    }
  };
  walk(apiSrc);

  const registryPaths = new Set(routeDefs.map((r) => `${r.method.toUpperCase()} ${r.path}`));
  const controllerRoutes: Array<{ method: string; path: string; file: string }> = [];

  for (const file of controllerFiles) {
    const src = readFileSync(file, "utf8");
    const controllerMatch = src.match(/@Controller\((?:"([^"]*)")?\)/);
    const prefix = controllerMatch?.[1] ?? "";
    const decoratorRe = /@(Get|Post|Patch|Put|Delete)\((?:"([^"]*)")?\)/g;
    let m: RegExpExecArray | null;
    while ((m = decoratorRe.exec(src))) {
      const method = m[1]!.toUpperCase();
      const sub = m[2] ?? "";
      const joined = ["", prefix, sub].filter(Boolean).join("/").replace(/\/+/g, "/");
      // NestJS :param syntax -> OpenAPI {param} syntax, to match the registry's
      // path spelling exactly.
      const path = "/" + joined.replace(/^\/+/, "").replace(/:([A-Za-z_]+)/g, "{$1}");
      controllerRoutes.push({ method, path, file });
    }
  }

  const undocumented = controllerRoutes.filter((r) => !registryPaths.has(`${r.method} ${r.path}`));
  for (const r of undocumented) {
    const relFile = r.file.replace(REPO_ROOT + "/", "");
    const decoratorName = r.method === "GET" ? "Get" : r.method === "POST" ? "Post" : r.method === "PATCH" ? "Patch" : r.method === "PUT" ? "Put" : "Delete";

    // Save the actual controller snippet as evidence rather than pointing
    // back at findings.jsonl itself.
    const controllerSrc = readFileSync(r.file, "utf8");
    const decoratorIdx = controllerSrc.search(new RegExp(`@${decoratorName}\\([^)]*${r.path.split("/").pop()?.replace(/[{}]/g, "") ?? ""}`));
    const snippetStart = decoratorIdx >= 0 ? Math.max(0, decoratorIdx - 80) : 0;
    const evidencePath = resolve(RUN_DIR, "artifacts", `undocumented-route-${r.method.toLowerCase()}-${r.path.replace(/[/{}]/g, "_")}.txt`);
    writeFileSync(
      evidencePath,
      `Route: ${r.method} ${r.path}\nFile: ${relFile}\n\n--- controller excerpt ---\n${controllerSrc.slice(snippetStart, snippetStart + 400)}\n\n--- registry route paths present for this controller's prefix ---\n${[...registryPaths].filter((p) => p.includes(r.path.split("/")[1] ?? "")).join("\n")}\n`,
    );

    recordDrift(
      { route: r.path, method: r.method, field: "(route)", schemaSays: "registered in apps/api/src/openapi/paths/*.ts", apiReturned: `declared in ${relFile}, absent from the registry`, kind: "undocumented-route" },
      {
        layer: "contract",
        title: `${r.method} ${r.path} is a live NestJS route with no entry in the OpenAPI registry`,
        target: `${r.method} ${r.path} (${relFile})`,
        what_i_did: `Parsed every apps/api/src/**/*.controller.ts for @${decoratorName}() decorators combined with each controller's @Controller() prefix, and compared the resulting route set against apps/api/src/openapi/registry.ts's registry.definitions (the same structure buildOpenApiDocument() walks).`,
        expected: `apps/api/src/openapi/registry.ts's module doc says every route is "the same zod schema the API validates against and the frontend imports" and the generated doc "cannot drift" from the controllers (registry.ts comment, and main.ts's buildOpenApiDocument() comment). A route present in a controller should have a matching route() call in openapi/paths/*.ts.`,
        observed: `${r.method} ${r.path} exists in ${relFile} but has no route() registration in apps/api/src/openapi/paths/*.ts, so it is invisible to buildOpenApiDocument(), to /api/v1/docs-json, and to this harness's own route enumeration (step 1 of the brief) unless independently discovered.`,
        evidence: [evidencePath],
        repro: `grep -n "@${decoratorName}" ${relFile}; grep -rn "${r.path.replace(/[{}]/g, "")}" apps/api/src/openapi/paths/`,
        severity_hint: "unknown",
        confidence: "high",
      },
    );
  }
  console.log(`Route-enumeration completeness: ${controllerRoutes.length} controller routes, ${undocumented.length} absent from the OpenAPI registry.`);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
let accessToken: string | null = null;

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; query?: Record<string, string>; auth?: boolean; contentType?: string } = {},
): Promise<{ status: number; json: unknown; text: string; headers: Headers }> {
  const url = new URL(API_BASE + path);
  if (opts.query) for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = undefined;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json") && text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Redacts anything that looks like a secret before it goes in a finding. */
function redact(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^(snap_live_|whsec_|eyJ|Bearer )/i.test(value) || value.length > 60) {
      return value.slice(0, 8) + "…[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|key|hash/i.test(k)) {
        out[k] = typeof v === "string" ? v.slice(0, 4) + "…[REDACTED]" : v;
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function truncate(value: unknown, max = 500): string {
  const s = typeof value === "string" ? value : JSON.stringify(redact(value));
  return s.length > max ? s.slice(0, max) + "…[truncated]" : s;
}

// ---------------------------------------------------------------------------
// The core check: validate one concrete (method, path) response against the
// schema the registry names for it.
// ---------------------------------------------------------------------------
function schemaOf(routeDef: RouteDef, status: number): z.ZodTypeAny | undefined {
  const resp = routeDef.responses[String(status)];
  return resp?.content?.["application/json"]?.schema;
}

/**
 * Walks the schema and the value in parallel looking for object keys the
 * value has that the schema's shape does not declare — a report distinct
 * from safeParse failure, since zod strips unknown keys by default rather
 * than failing on them (unless the schema is `.strict()`, which safeParse
 * already catches as a failure).
 */
function findUndocumentedFields(schema: z.ZodTypeAny, value: unknown, path = ""): string[] {
  const found: string[] = [];
  const def = (schema as unknown as { _zod?: { def: Record<string, unknown> } })._zod?.def;
  if (!def) return found;

  // Unwrap Optional/Default/Nullable wrappers to reach the underlying shape.
  if ((def.type === "optional" || def.type === "default" || def.type === "nullable") && def.innerType) {
    return findUndocumentedFields(def.innerType as z.ZodTypeAny, value, path);
  }

  if (def.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const shape = def.shape as Record<string, z.ZodTypeAny>;
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (!(key in shape)) {
        found.push(path ? `${path}.${key}` : key);
      } else {
        found.push(...findUndocumentedFields(shape[key]!, obj[key], path ? `${path}.${key}` : key));
      }
    }
    return found;
  }

  if (def.type === "array" && Array.isArray(value)) {
    const element = def.element as z.ZodTypeAny;
    // Only the first item is walked — every item in a homogeneous API list
    // is the same shape, and walking all of them buys nothing extra here.
    if (value.length > 0) found.push(...findUndocumentedFields(element, value[0], `${path}[0]`));
    return found;
  }

  if (def.type === "union" && (def.options as z.ZodTypeAny[])) {
    // For a union, only report fields undocumented by EVERY branch — a field
    // absent from one branch's shape but present in another (a discriminated
    // shape) is not undocumented, it just picked a different branch.
    const perBranch = (def.options as z.ZodTypeAny[]).map((opt) => findUndocumentedFields(opt, value, path));
    const first = perBranch[0] ?? [];
    return first.filter((f) => perBranch.every((b) => b.includes(f)));
  }

  return found;
}

const attemptedRoutes = new Set<string>();

function checkResponse(
  routeLabel: string,
  method: string,
  status: number,
  routeDef: RouteDef,
  body: unknown,
  reproCmd: string,
): void {
  attemptedRoutes.add(`${method} ${routeLabel}`);
  routesChecked++;
  const schema = schemaOf(routeDef, status);
  if (!schema) {
    // 204 routes, and text/csv routes, have no JSON schema to check — that's
    // by design, not a gap, so it does not count as unreachable/uncovered.
    routesClean++;
    return;
  }

  const result = schema.safeParse(body);
  let hadDrift = false;

  if (!result.success) {
    hadDrift = true;
    for (const issue of result.error.issues) {
      const fieldPath = issue.path.length ? issue.path.join(".") : "(root)";
      const kind: Kind =
        issue.code === "invalid_type" && issue.message.includes("received null")
          ? "null-drift"
          : issue.code === "invalid_type" && issue.message.includes("received undefined")
            ? "missing"
            : issue.code === "unrecognized_keys"
              ? "strict-reject"
              : "type";

      const observedValue = issue.path.length
        ? issue.path.reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key as string] : undefined), body)
        : body;

      const evidencePath = resolve(
        RUN_DIR,
        "artifacts",
        `drift-${method.toLowerCase()}-${routeLabel.replace(/[/{}]/g, "_")}-${fieldPath.replace(/[^a-z0-9]+/gi, "_")}-${status}.json`,
      );
      writeFileSync(
        evidencePath,
        JSON.stringify({ route: routeLabel, method, status, fieldPath, zodIssue: issue, fullResponseBody: redact(body) }, null, 2),
      );

      recordDrift(
        { route: routeLabel, method, field: fieldPath, schemaSays: issue.message, apiReturned: truncate(observedValue, 200), kind },
        {
          layer: "contract",
          title: `${method} ${routeLabel} response field "${fieldPath}" failed contract validation`,
          target: `${method} ${routeLabel}`,
          what_i_did: reproCmd,
          expected: `@snapurl/contract schema registered for this route in apps/api/src/openapi/paths — zod issue: ${issue.code} at "${fieldPath}"`,
          observed: `HTTP ${status}. safeParse error: ${issue.message}. Field value: ${truncate(observedValue, 300)}`,
          evidence: [evidencePath],
          repro: reproCmd,
          severity_hint: "unknown",
          confidence: "high",
        },
      );
    }
  }

  // Undocumented extra fields — reported even when safeParse succeeded,
  // since zod silently strips unknown keys by default (steering brief).
  const extras = findUndocumentedFields(schema, body);
  if (extras.length > 0) {
    hadDrift = true;
    for (const extraPath of extras) {
      const evidencePath = resolve(
        RUN_DIR,
        "artifacts",
        `extra-field-${method.toLowerCase()}-${routeLabel.replace(/[/{}]/g, "_")}-${extraPath.replace(/[^a-z0-9]+/gi, "_")}.json`,
      );
      writeFileSync(evidencePath, JSON.stringify({ route: routeLabel, method, status, extraFieldPath: extraPath, fullResponseBody: redact(body) }, null, 2));

      recordDrift(
        { route: routeLabel, method, field: extraPath, schemaSays: "(not declared)", apiReturned: "(present in response)", kind: "undocumented-extra-field" },
        {
          layer: "contract",
          title: `${method} ${routeLabel} response has field "${extraPath}" absent from its @snapurl/contract schema`,
          target: `${method} ${routeLabel}`,
          what_i_did: reproCmd,
          expected: `@snapurl/contract schema for this route declares no "${extraPath}" key; zod strips unknown keys by default so this does not fail safeParse, but the field is undocumented surface`,
          observed: `HTTP ${status} response included "${extraPath}"`,
          evidence: [evidencePath],
          repro: reproCmd,
          severity_hint: "unknown",
          confidence: "medium",
          notes: "zod strips this silently; a frontend reading it would be reading undeclared surface, not a validated contract field.",
        },
      );
    }
  }

  if (hadDrift) routesDrifted++;
  else routesClean++;
}

function markUnreachable(routeLabel: string, method: string, reason: string): void {
  attemptedRoutes.add(`${method} ${routeLabel}`);
  routesUnreachable++;
  coverageGaps.push(`${method} ${routeLabel}: ${reason}`);
}

// ---------------------------------------------------------------------------
// Account setup
// ---------------------------------------------------------------------------
const runId = randomBytes(4).toString("hex");
const email = `qa-l3-contract-${runId}@example.test`;
// Generated at runtime, per the brief — never a literal, this repo is public.
const password = randomBytes(18).toString("base64url") + "Aa1!";

console.log(`Registering throwaway account ${email} ...`);
const registerRepro = `curl -s -X POST ${API_BASE}/auth/register -H 'Content-Type: application/json' -d '{"name":"QA L3","email":"<redacted>","password":"<redacted>"}'`;
const registerRes = await call("POST", "/auth/register", {
  body: { name: "QA L3 Contract", email, password },
  auth: false,
});

const registerRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/register")!;
checkResponse("/auth/register", "POST", registerRes.status, registerRouteDef, registerRes.json, registerRepro);

if (registerRes.status !== 201 || !registerRes.json) {
  console.error("Registration failed — cannot proceed.", registerRes.status, redact(registerRes.json ?? registerRes.text));
  process.exit(1);
}
const session = registerRes.json as { accessToken: string; refreshToken: string; user: { id: string } };
accessToken = session.accessToken;
const refreshToken = session.refreshToken;

console.log("Registered. Proceeding with authenticated route checks.");

// ---------------------------------------------------------------------------
// Seed data — create one of each throwaway object so GET-by-id, list, and
// mutation routes all have something real to read back. Every created object
// is a fresh, disposable row this run owns; nothing seeded is mutated or
// deleted here beyond this run's own rows.
// ---------------------------------------------------------------------------
const domainName = "localhost:3002"; // the DEFAULT_DOMAIN this stack provisions per-workspace

console.log("Seeding a link, form, bio page, api key, webhook ...");

const linkRes = await call("POST", "/links", { body: { destination: "https://example.com/qa-l3", domain: domainName } });
const linkRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/links")!;
checkResponse("/links", "POST", linkRes.status, linkRouteDef, linkRes.json, `curl -s -X POST ${API_BASE}/links -H 'Authorization: Bearer <token>' -d '{"destination":"https://example.com/qa-l3","domain":"${domainName}"}'`);
const link = linkRes.json as { id?: string; slug?: string } | undefined;

const formRes = await call("POST", "/forms", { body: { title: "QA L3 form" } });
const formRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/forms")!;
checkResponse("/forms", "POST", formRes.status, formRouteDef, formRes.json, `curl -s -X POST ${API_BASE}/forms -d '{"title":"QA L3 form"}'`);
const form = formRes.json as { id?: string; slug?: string } | undefined;

const bioRes = await call("PUT", "/bio-pages", { body: { domain: domainName, slug: `qa-l3-bio-${runId}`, profile: { name: "QA L3" } } });
const bioRouteDef = routeDefs.find((r) => r.method === "put" && r.path === "/bio-pages")!;
checkResponse("/bio-pages", "PUT", bioRes.status, bioRouteDef, bioRes.json, `curl -s -X PUT ${API_BASE}/bio-pages -d '{"domain":"${domainName}","slug":"qa-l3-bio-${runId}","profile":{"name":"QA L3"}}'`);
const bioPage = bioRes.json as { id?: string } | undefined;

const apiKeyRes = await call("POST", "/api-keys", { body: { name: "qa-l3-key", scopes: ["links:read"] } });
const apiKeyRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/api-keys")!;
checkResponse("/api-keys", "POST", apiKeyRes.status, apiKeyRouteDef, apiKeyRes.json, `curl -s -X POST ${API_BASE}/api-keys -d '{"name":"qa-l3-key","scopes":["links:read"]}'`);
const apiKey = apiKeyRes.json as { id?: string } | undefined;

const webhookRes = await call("POST", "/webhooks", { body: { endpoint: "https://example.com/qa-l3-hook", events: ["link.created"] } });
const webhookRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/webhooks")!;
checkResponse("/webhooks", "POST", webhookRes.status, webhookRouteDef, webhookRes.json, `curl -s -X POST ${API_BASE}/webhooks -d '{"endpoint":"https://example.com/qa-l3-hook","events":["link.created"]}'`);
const webhook = webhookRes.json as { id?: string } | undefined;

const domainAddRes = await call("POST", "/domains", { body: { domain: `qa-l3-${runId}.example.test` } });
const domainAddRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/domains")!;
checkResponse("/domains", "POST", domainAddRes.status, domainAddRouteDef, domainAddRes.json, `curl -s -X POST ${API_BASE}/domains -d '{"domain":"qa-l3-${runId}.example.test"}'`);
const newDomain = domainAddRes.json as { id?: string } | undefined;

// A conversion needs a link to attach to.
const conversionRes = await call("POST", "/conversions", {
  body: { linkId: link?.id, kind: "lead", name: "qa-l3-lead" },
});
const conversionRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/conversions")!;
checkResponse("/conversions", "POST", conversionRes.status, conversionRouteDef, conversionRes.json, `curl -s -X POST ${API_BASE}/conversions -d '{"linkId":"<id>","kind":"lead","name":"qa-l3-lead"}'`);

// ---------------------------------------------------------------------------
// GET / simple mutating routes reachable with this session's role (owner —
// clears every @Roles() bar in the app, so no route is skipped for rank).
// ---------------------------------------------------------------------------
/**
 * `templatePath` is the `{param}`-style path as declared in the OpenAPI
 * registry (used to look up the right schema and to label findings/coverage
 * gaps consistently with every other route in this report). `params` fills
 * in the concrete values for the actual HTTP call. Keeping the two separate
 * is what lets a parameterised route like GET /links/{id} still be found in
 * routeDefs — looking it up by the concrete, UUID-substituted path silently
 * missed it in an earlier version of this script (it always reported
 * "not present in the OpenAPI registry route table" even though it was).
 */
async function checkGet(
  templatePath: string,
  opts: { query?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<unknown> {
  const routeDef = routeDefs.find((r) => r.method === "get" && r.path === templatePath);
  if (!routeDef) {
    markUnreachable(templatePath, "GET", "not present in the OpenAPI registry route table");
    return undefined;
  }
  let concretePath = templatePath;
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) concretePath = concretePath.replace(`{${k}}`, v);
  }
  const res = await call("GET", concretePath, { query: opts.query });
  const repro = `curl -s ${API_BASE}${concretePath}${opts.query ? "?" + new URLSearchParams(opts.query).toString() : ""} -H 'Authorization: Bearer <token>'`;
  if (res.status >= 400) {
    markUnreachable(templatePath, "GET", `HTTP ${res.status} — ${truncate(res.json ?? res.text, 200)}`);
    return undefined;
  }
  checkResponse(templatePath, "GET", res.status, routeDef, res.json, repro);
  return res.json;
}

console.log("Checking GET / list / by-id routes ...");

await checkGet("/links");
if (link?.id) await checkGet("/links/{id}", { params: { id: link.id } });
await checkGet("/analytics", { query: { range: "30d" } });
await checkGet("/conversions", { query: { range: "30d" } });
await checkGet("/domains");
if (newDomain?.id) {
  const verifyRes = await call("POST", `/domains/${newDomain.id}/verify`);
  attemptedRoutes.add("POST /domains/{id}/verify");
  const verifyRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/domains/{id}/verify")!;
  if (verifyRes.status >= 400) {
    // Expected: this domain's TXT record was never actually published, so DNS
    // verification legitimately fails. Still worth confirming the shape of a
    // 4xx here is a real error body, but the SUCCESS schema cannot be
    // exercised without a real DNS record — recorded as a coverage gap, not
    // skipped silently.
    coverageGaps.push(`POST /domains/{id}/verify: returned HTTP ${verifyRes.status} (${truncate(verifyRes.json, 150)}) — the seeded domain has no real TXT record to verify against, so the 200 success schema could not be exercised`);
  } else {
    checkResponse("/domains/{id}/verify", "POST", verifyRes.status, verifyRouteDef, verifyRes.json, `curl -s -X POST ${API_BASE}/domains/${newDomain.id}/verify -H 'Authorization: Bearer <token>'`);
  }
}
await checkGet("/bio-pages");
await checkGet("/forms");
if (form?.id) {
  await checkGet("/forms/{id}", { params: { id: form.id } });
}
if (form?.id) {
  const responsesRoutePath = "/forms/{id}/responses";
  const routeDef = routeDefs.find((r) => r.method === "get" && r.path === responsesRoutePath);
  if (routeDef) {
    const res = await call("GET", `/forms/${form.id}/responses`);
    if (res.status < 400) {
      checkResponse(responsesRoutePath, "GET", res.status, routeDef, res.json, `curl -s ${API_BASE}/forms/${form.id}/responses -H 'Authorization: Bearer <token>'`);
    } else {
      markUnreachable(responsesRoutePath, "GET", `HTTP ${res.status}`);
    }
  }
}
await checkGet("/reports");
await checkGet("/members");
await checkGet("/audit");
await checkGet("/api-keys");
await checkGet("/webhooks");
await checkGet("/workspaces/current");
await checkGet("/auth/me");

// /links/export and /forms/{id}/responses.csv return text/csv, which the
// contract deliberately types as z.string() — there is no structured
// payload to differential-check beyond confirming the route answers, so
// these are recorded as a coverage note rather than run through checkResponse
// (whose safeParse would trivially pass on any string and prove nothing).
{
  const res = await call("GET", "/links/export");
  attemptedRoutes.add("GET /links/export");
  if (res.status >= 400) coverageGaps.push(`GET /links/export: HTTP ${res.status} — could not confirm CSV stream`);
  else coverageGaps.push(`GET /links/export: returned HTTP ${res.status}, content-type ${res.headers.get("content-type")}. Schema is z.string() for the CSV body; safeParse against any string is not a meaningful contract check, so this route's response was inspected for content-type only, not differential-tested.`);
}
if (form?.id) {
  const res = await call("GET", `/forms/${form.id}/responses.csv`);
  attemptedRoutes.add("GET /forms/{id}/responses.csv");
  if (res.status >= 400) coverageGaps.push(`GET /forms/{id}/responses.csv: HTTP ${res.status}`);
  else coverageGaps.push(`GET /forms/{id}/responses.csv: returned HTTP ${res.status}, content-type ${res.headers.get("content-type")}. Same z.string() CSV situation as /links/export — inspected, not differential-tested.`);
}

// ---------------------------------------------------------------------------
// Mutating routes on the seeded objects: read-modify-read, clone, patch.
// ---------------------------------------------------------------------------
console.log("Checking PATCH / clone / update routes ...");

if (link?.id) {
  const patchRes = await call("PATCH", `/links/${link.id}`, { body: { comment: "qa-l3 patched" } });
  const patchRouteDef = routeDefs.find((r) => r.method === "patch" && r.path === "/links/{id}")!;
  if (patchRes.status < 400) checkResponse("/links/{id}", "PATCH", patchRes.status, patchRouteDef, patchRes.json, `curl -s -X PATCH ${API_BASE}/links/${link.id} -d '{"comment":"qa-l3 patched"}'`);
  else markUnreachable("/links/{id}", "PATCH", `HTTP ${patchRes.status}`);

  const cloneRes = await call("POST", `/links/${link.id}/clone`, { body: {} });
  const cloneRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/links/{id}/clone")!;
  if (cloneRes.status < 400) checkResponse("/links/{id}/clone", "POST", cloneRes.status, cloneRouteDef, cloneRes.json, `curl -s -X POST ${API_BASE}/links/${link.id}/clone -d '{}'`);
  else markUnreachable("/links/{id}/clone", "POST", `HTTP ${cloneRes.status}`);

  const bulkRes = await call("POST", "/links/bulk", { body: { links: [{ destination: "https://example.com/qa-l3-bulk", domain: domainName }] } });
  const bulkRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/links/bulk")!;
  if (bulkRes.status < 400) checkResponse("/links/bulk", "POST", bulkRes.status, bulkRouteDef, bulkRes.json, `curl -s -X POST ${API_BASE}/links/bulk -d '{"links":[{"destination":"https://example.com/qa-l3-bulk","domain":"${domainName}"}]}'`);
  else markUnreachable("/links/bulk", "POST", `HTTP ${bulkRes.status}`);
}

if (form?.id) {
  const patchFormRes = await call("PATCH", `/forms/${form.id}`, { body: { description: "qa-l3 patched" } });
  const patchFormRouteDef = routeDefs.find((r) => r.method === "patch" && r.path === "/forms/{id}")!;
  if (patchFormRes.status < 400) checkResponse("/forms/{id}", "PATCH", patchFormRes.status, patchFormRouteDef, patchFormRes.json, `curl -s -X PATCH ${API_BASE}/forms/${form.id} -d '{"description":"qa-l3 patched"}'`);
  else markUnreachable("/forms/{id}", "PATCH", `HTTP ${patchFormRes.status}`);
}

// Workspace update — everything optional, patch retention only to avoid
// touching anything that would change other checks' assumptions.
{
  const wsRes = await call("PATCH", "/workspaces/current", { body: { name: "QA L3 Tester's workspace" } });
  const wsRouteDef = routeDefs.find((r) => r.method === "patch" && r.path === "/workspaces/current")!;
  if (wsRes.status < 400) checkResponse("/workspaces/current", "PATCH", wsRes.status, wsRouteDef, wsRes.json, `curl -s -X PATCH ${API_BASE}/workspaces/current -d '{"name":"QA L3 Tester'"'"'s workspace"}'`);
  else markUnreachable("/workspaces/current", "PATCH", `HTTP ${wsRes.status}`);
}

// Members: invite a second (throwaway) member, then change their role.
{
  const inviteEmail = `qa-l3-member-${runId}@example.test`;
  const inviteRes = await call("POST", "/members", { body: { email: inviteEmail, role: "viewer" } });
  const inviteRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/members")!;
  if (inviteRes.status < 400) {
    checkResponse("/members", "POST", inviteRes.status, inviteRouteDef, inviteRes.json, `curl -s -X POST ${API_BASE}/members -d '{"email":"<redacted>","role":"viewer"}'`);
    const invited = inviteRes.json as { id?: string } | undefined;
    if (invited?.id) {
      const roleRes = await call("PATCH", `/members/${invited.id}`, { body: { role: "editor" } });
      const roleRouteDef = routeDefs.find((r) => r.method === "patch" && r.path === "/members/{id}")!;
      // 204 No Content — no JSON schema, checkResponse will just count it clean.
      checkResponse("/members/{id}", "PATCH", roleRes.status, roleRouteDef, roleRes.json, `curl -s -X PATCH ${API_BASE}/members/${invited.id} -d '{"role":"editor"}'`);
      if (roleRes.status >= 400) coverageGaps.push(`PATCH /members/{id} returned HTTP ${roleRes.status}: ${truncate(roleRes.json, 150)}`);

      const removeRes = await call("DELETE", `/members/${invited.id}`);
      attemptedRoutes.add("DELETE /members/{id}");
      if (removeRes.status >= 400) {
        coverageGaps.push(`DELETE /members/{id} returned HTTP ${removeRes.status} for cleanup of the seeded invite — left in place`);
      } else {
        routesChecked++;
        routesClean++; // 204, no body to differential-test — same as the other DELETE routes.
      }
    }
  } else {
    markUnreachable("/members", "POST", `HTTP ${inviteRes.status} — ${truncate(inviteRes.json, 150)}`);
  }
}

// Reports: no report exists yet from this session (reports come from the
// PUBLIC report-abuse endpoint), so seed one first via /public/links/{slug}/report,
// then review it as the operator.
if (link?.slug) {
  const reportRes = await call("POST", `/public/links/${link.slug}/report`, { body: { reason: "qa-l3 automated check" }, auth: false });
  const reportRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/public/links/{slug}/report")!;
  checkResponse("/public/links/{slug}/report", "POST", reportRes.status, reportRouteDef, reportRes.json, `curl -s -X POST ${API_BASE}/public/links/${link.slug}/report -d '{"reason":"qa-l3 automated check"}'`);

  // Give the report a moment to land, then look it up as the operator.
  const reportsListRes = await call("GET", "/reports");
  const reportsListRouteDef = routeDefs.find((r) => r.method === "get" && r.path === "/reports")!;
  if (reportsListRes.status < 400) {
    checkResponse("/reports", "GET", reportsListRes.status, reportsListRouteDef, reportsListRes.json, `curl -s ${API_BASE}/reports -H 'Authorization: Bearer <token>'`);
    const reports = reportsListRes.json as Array<{ id: string; slug: string }> | undefined;
    const ours = reports?.find((r) => r.slug === link.slug);
    if (ours) {
      const reviewRes = await call("PATCH", `/reports/${ours.id}`, { body: { status: "reviewed" } });
      const reviewRouteDef = routeDefs.find((r) => r.method === "patch" && r.path === "/reports/{id}")!;
      checkResponse("/reports/{id}", "PATCH", reviewRes.status, reviewRouteDef, reviewRes.json, `curl -s -X PATCH ${API_BASE}/reports/${ours.id} -d '{"status":"reviewed"}'`);
    } else {
      coverageGaps.push("PATCH /reports/{id}: the report just submitted via POST /public/links/{slug}/report did not appear in GET /reports by slug match, so the review endpoint could not be exercised on it");
    }
  }
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) routes.
// ---------------------------------------------------------------------------
console.log("Checking public routes ...");

if (link?.slug) {
  const previewRes = await call("GET", `/public/links/${link.slug}/preview`, { query: { host: domainName }, auth: false });
  const previewRouteDef = routeDefs.find((r) => r.method === "get" && r.path === "/public/links/{slug}/preview")!;
  checkResponse("/public/links/{slug}/preview", "GET", previewRes.status, previewRouteDef, previewRes.json, `curl -s '${API_BASE}/public/links/${link.slug}/preview?host=${domainName}'`);
}

// The seeded form is created in "draft" status (CreateFormInput default), so
// the public GET must 404 by design (see forms.service.publicForm) — publish
// it first so the public GET/POST schemas can actually be exercised.
if (form?.id && form?.slug) {
  const publishRes = await call("PATCH", `/forms/${form.id}`, { body: { status: "live" } });
  if (publishRes.status < 400) {
    const pubGetRes = await call("GET", `/public/forms/${form.slug}`, { auth: false });
    const pubGetRouteDef = routeDefs.find((r) => r.method === "get" && r.path === "/public/forms/{slug}")!;
    if (pubGetRes.status < 400) checkResponse("/public/forms/{slug}", "GET", pubGetRes.status, pubGetRouteDef, pubGetRes.json, `curl -s ${API_BASE}/public/forms/${form.slug}`);
    else markUnreachable("/public/forms/{slug}", "GET", `HTTP ${pubGetRes.status}`);

    const pubPostRes = await call("POST", `/public/forms/${form.slug}`, { body: { answers: {} }, auth: false });
    const pubPostRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/public/forms/{slug}")!;
    checkResponse("/public/forms/{slug}", "POST", pubPostRes.status, pubPostRouteDef, pubPostRes.json, `curl -s -X POST ${API_BASE}/public/forms/${form.slug} -d '{"answers":{}}'`);
  } else {
    coverageGaps.push(`PATCH /forms/{id} (publishing the seeded form to exercise public routes) failed with HTTP ${publishRes.status}, so GET/POST /public/forms/{slug} could not be exercised`);
  }
}

// unlock — needs a password-protected link, which nothing above created.
// Create one specifically for this check.
{
  const pwLinkRes = await call("POST", "/links", { body: { destination: "https://example.com/qa-l3-locked", domain: domainName, password: "qa-l3-unlock-pw" } });
  if (pwLinkRes.status < 400) {
    const pwLink = pwLinkRes.json as { slug?: string } | undefined;
    if (pwLink?.slug) {
      const unlockRes = await call("POST", `/public/links/${pwLink.slug}/unlock`, { body: { password: "qa-l3-unlock-pw" }, query: { host: domainName }, auth: false });
      const unlockRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/public/links/{slug}/unlock")!;
      checkResponse("/public/links/{slug}/unlock", "POST", unlockRes.status, unlockRouteDef, unlockRes.json, `curl -s -X POST '${API_BASE}/public/links/${pwLink.slug}/unlock?host=${domainName}' -d '{"password":"<redacted>"}'`);
    }
  } else {
    coverageGaps.push(`POST /links with a password (to seed a target for /public/links/{slug}/unlock) failed with HTTP ${pwLinkRes.status}`);
  }
}

const healthRes = await call("GET", "/health", { auth: false });
const healthRouteDef = routeDefs.find((r) => r.method === "get" && r.path === "/health")!;
checkResponse("/health", "GET", healthRes.status, healthRouteDef, healthRes.json, `curl -s ${API_BASE}/health`);

// ---------------------------------------------------------------------------
// Auth flows beyond register: login, refresh, logout, oauth (unreachable —
// no real IdP token available in this environment), 2FA.
// ---------------------------------------------------------------------------
console.log("Checking auth/session routes ...");

{
  const loginRes = await call("POST", "/auth/login", { body: { email, password }, auth: false });
  const loginRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/login")!;
  checkResponse("/auth/login", "POST", loginRes.status, loginRouteDef, loginRes.json, `curl -s -X POST ${API_BASE}/auth/login -d '{"email":"<redacted>","password":"<redacted>"}'`);
}

{
  const refreshRes = await call("POST", "/auth/refresh", { body: { refreshToken }, auth: false });
  const refreshRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/refresh")!;
  checkResponse("/auth/refresh", "POST", refreshRes.status, refreshRouteDef, refreshRes.json, `curl -s -X POST ${API_BASE}/auth/refresh -d '{"refreshToken":"<redacted>"}'`);
  // Rotate: use the freshly issued token for the rest of this run if it succeeded.
  if (refreshRes.status < 400) {
    const rotated = refreshRes.json as { accessToken?: string } | undefined;
    if (rotated?.accessToken) accessToken = rotated.accessToken;
  }
}

markUnreachable("/auth/oauth", "POST", "requires a real Google/Apple-signed ID token; no IdP credentials available in this environment, and fabricating one cannot exercise real signature verification");

{
  const setupRes = await call("POST", "/auth/2fa/setup");
  const setupRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/2fa/setup")!;
  checkResponse("/auth/2fa/setup", "POST", setupRes.status, setupRouteDef, setupRes.json, `curl -s -X POST ${API_BASE}/auth/2fa/setup -H 'Authorization: Bearer <token>'`);

  const setup = setupRes.json as { secret?: string } | undefined;
  if (setup?.secret) {
    // otplib is only hoisted into apps/api's own node_modules (a workspace
    // dependency of @snapurl/api, not the repo root), so resolve it the same
    // way the API's own code would rather than assuming a root hoist.
    const { createRequire } = await import("node:module");
    const requireFromApi = createRequire(resolve(REPO_ROOT, "apps/api/package.json"));
    const { authenticator } = requireFromApi("otplib") as typeof import("otplib");
    const code = authenticator.generate(setup.secret);
    const enableRes = await call("POST", "/auth/2fa/enable", { body: { code } });
    const enableRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/2fa/enable")!;
    checkResponse("/auth/2fa/enable", "POST", enableRes.status, enableRouteDef, enableRes.json, `curl -s -X POST ${API_BASE}/auth/2fa/enable -d '{"code":"<redacted>"}'`);

    if (enableRes.status < 400) {
      // 2FA is now on. Exercise 2fa/verify by logging in again (which now
      // returns a TotpChallenge, not a session) and completing it.
      const login2Res = await call("POST", "/auth/login", { body: { email, password }, auth: false });
      const challenge = login2Res.json as { challenge?: string; challengeToken?: string } | undefined;
      if (login2Res.status < 400 && challenge?.challenge === "totp" && challenge.challengeToken) {
        const code2 = authenticator.generate(setup.secret);
        const verifyRes = await call("POST", "/auth/2fa/verify", { body: { challengeToken: challenge.challengeToken, code: code2 }, auth: false });
        const verifyRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/2fa/verify")!;
        checkResponse("/auth/2fa/verify", "POST", verifyRes.status, verifyRouteDef, verifyRes.json, `curl -s -X POST ${API_BASE}/auth/2fa/verify -d '{"challengeToken":"<redacted>","code":"<redacted>"}'`);
      } else {
        coverageGaps.push(`POST /auth/2fa/verify: re-login after enabling 2FA did not return the expected TotpChallenge shape (got HTTP ${login2Res.status}, ${truncate(login2Res.json, 150)}), so /auth/2fa/verify could not be exercised`);
      }

      // Turn it back off so it doesn't interfere with anything checked after
      // this point in the same session.
      const disableRes = await call("POST", "/auth/2fa/disable", { body: { password } });
      attemptedRoutes.add("POST /auth/2fa/disable");
      if (disableRes.status >= 400) {
        coverageGaps.push(`POST /auth/2fa/disable cleanup returned HTTP ${disableRes.status}`);
      } else {
        routesChecked++;
        routesClean++; // 204, no body to differential-test — same as the other 204 routes.
      }
    } else {
      coverageGaps.push(`POST /auth/2fa/verify: enabling 2FA failed (HTTP ${enableRes.status}), so the challenge flow could not be exercised`);
    }
  }
}

// logout — do this LAST, since it revokes the refresh token family and any
// subsequent authenticated call in this script would then fail.
{
  const logoutRes = await call("POST", "/auth/logout", { body: { refreshToken }, auth: false });
  const logoutRouteDef = routeDefs.find((r) => r.method === "post" && r.path === "/auth/logout")!;
  checkResponse("/auth/logout", "POST", logoutRes.status, logoutRouteDef, logoutRes.json, `curl -s -X POST ${API_BASE}/auth/logout -d '{"refreshToken":"<redacted>"}'`);
}

// ---------------------------------------------------------------------------
// Routes never reachable in this run, with a stated reason each — required
// coverage-gap accounting (steering §3/§brief).
// ---------------------------------------------------------------------------
markUnreachable("/api-keys/{id}", "DELETE", "not exercised — deleting the seeded API key would remove the ability to attribute later drift to a known object; response has no JSON body (204) so nothing further to check via safeParse");
markUnreachable("/webhooks/{id}", "DELETE", "not exercised for the same reason as /api-keys/{id} — 204, no body to validate");
markUnreachable("/bio-pages/{id}", "DELETE", "not exercised — 204, no body to validate; deleting it was not necessary to reach any other route");
markUnreachable("/domains/{id}", "DELETE", "not exercised — the seeded domain has 0 links so deletion would succeed, but doing so was not necessary for any other route and DELETE responses are 204 (no body to differential-test)");
markUnreachable("/links/{id}", "DELETE", "not exercised for the same reason — 204, no body to validate");
markUnreachable("/forms/{id}", "DELETE", "not exercised for the same reason — 204, no body to validate");
// POST /auth/2fa/disable is NOT marked unreachable here: it is exercised
// inline in the 2FA block above whenever POST /auth/2fa/enable succeeds, and
// checkResponse() already records it as checked in that case. If enable had
// failed, the coverage-gap note pushed inline there names /auth/2fa/verify
// (the routes both depend on the same successful-enable precondition) — no
// separate note is added here to avoid a misleading duplicate for a route
// that may in fact have been checked cleanly in this same run.

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
// Any registry route this run never even attempted (checked or marked
// unreachable) is a blind spot the coverage-gap notes above did not name
// explicitly — surface it rather than let it silently not appear anywhere.
for (const r of routeDefs) {
  const label = `${r.method.toUpperCase()} ${r.path}`;
  if (!attemptedRoutes.has(label)) {
    coverageGaps.push(`${label}: never attempted by this run — no seed data path or auth flow above reached it`);
  }
}

const total = routeDefs.length;
console.log(`\nDone. ${routesChecked} response(s) checked (${routesClean} clean, ${routesDrifted} drifted), ${routesUnreachable} coverage-gap note(s), ${total} total route definitions in the registry.`);
console.log("Attempted routes:", [...attemptedRoutes].sort().join("\n  "));

writeFileSync(resolve(RUN_DIR, "drift-table.json"), JSON.stringify(driftRows, null, 2));
writeFileSync(
  resolve(RUN_DIR, "run-meta.json"),
  JSON.stringify(
    {
      apiBase: API_BASE,
      runId,
      totalRoutesInRegistry: total,
      responsesChecked: routesChecked,
      responsesClean: routesClean,
      responsesDrifted: routesDrifted,
      coverageGapCount: coverageGaps.length,
      coverageGaps,
    },
    null,
    2,
  ),
);

console.log(`Findings: ${FINDINGS_PATH}`);
console.log(`Drift table: ${resolve(RUN_DIR, "drift-table.json")}`);
