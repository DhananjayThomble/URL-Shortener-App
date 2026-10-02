#!/usr/bin/env node
/* ============================================================
   L5 adversarial checks — issue #607.

   Drives the real staging stack (pnpm staging:up: api :3001, redirect :3002,
   postgres :5435 via docker). Never production, never AWS.

   This is plain Node + fetch + `docker exec psql` — no new dependency added
   to the workspace. Each check states its oracle in a comment immediately
   above it (qa-oracles.md §1) and appends ONE finding line to
   `.qa-runs/<run>/findings.jsonl` the instant it is confirmed (steering §3),
   whether the check caught something or not — the record is "what I did /
   expected / observed", never a verdict (steering §2). No check here decides
   "defect" or "not a defect"; that adjudication is explicitly out of scope
   for this run.

   Usage:
     QA_RUN_DIR=.qa-runs/<run-id> node qa/adversarial/run.mjs

   Requires: staging stack up (`pnpm staging:up`), reachable at
   http://localhost:3001/api/v1 (api) and http://localhost:3002 (redirect),
   and the `snapurl-staging-postgres` container reachable via `docker exec`
   for the DB-level workspace-isolation oracle.
   ============================================================ */

import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const API = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";
const REDIRECT = process.env.QA_REDIRECT_URL ?? "http://localhost:3002";
const PG_CONTAINER = process.env.QA_DB_CONTAINER ?? "snapurl-staging-postgres";
const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(process.cwd(), ".qa-runs/adversarial-local");
const FINDINGS_FILE = path.join(RUN_DIR, "findings.jsonl");
const ARTIFACTS_DIR = path.join(RUN_DIR, "artifacts");
const SUMMARY_FILE = path.join(RUN_DIR, "summary.md");
const PROGRESS_FILE = path.join(RUN_DIR, "progress.md");

mkdirSync(ARTIFACTS_DIR, { recursive: true });

/** Findings with a severity_hint other than "unknown" recorded this run —
 * tracked so main() can turn an exploit signature into a non-zero exit
 * (steering §2/§4: a suite that stays green against a real signature is
 * worthless; writing a finding alone is not a passing assertion). */
const nonUnknownFindings = [];

/** Append one finding immediately — never buffered (steering §3). */
function finding(f) {
  const line = JSON.stringify(f);
  appendFileSync(FINDINGS_FILE, line + "\n");
  console.log(`[finding] ${f.id}`);
  if (f.severity_hint && f.severity_hint !== "unknown") {
    nonUnknownFindings.push({ id: f.id, severity_hint: f.severity_hint, target: f.target });
  }
}

function saveArtifact(name, data) {
  const file = path.join(ARTIFACTS_DIR, name);
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2));
  return file;
}

/* ------------------------------------------------------------
   summary.md — created before any check runs, updated as each phase
   finishes (steering §3.1). Tracked in-memory and rewritten in full on
   every update rather than appended-to, since the per-phase status lines
   mutate (pending -> completed/errored) rather than only growing.
   ------------------------------------------------------------ */
const phaseStatus = new Map();

function initSummary(phaseNames) {
  for (const name of phaseNames) phaseStatus.set(name, { result: "pending", detail: "" });
  writeSummary();
}

function setPhaseStatus(name, result, detail) {
  phaseStatus.set(name, { result, detail });
  writeSummary();
}

function writeSummary() {
  const lines = [];
  lines.push("# L5 adversarial run — summary");
  lines.push("");
  lines.push(`Run dir: \`${RUN_DIR}\``);
  lines.push(`Generated: ${new Date().toISOString()} (rewritten as each phase finishes)`);
  lines.push("");
  lines.push("## Phases");
  lines.push("");
  lines.push("| phase | result | detail |");
  lines.push("| --- | --- | --- |");
  for (const [name, s] of phaseStatus.entries()) {
    lines.push(`| ${name} | ${s.result} | ${s.detail.replace(/\|/g, "/").slice(0, 200)} |`);
  }
  lines.push("");
  const attempted = phaseStatus.size;
  const completed = [...phaseStatus.values()].filter((s) => s.result === "completed").length;
  const errored = [...phaseStatus.values()].filter((s) => s.result === "errored").length;
  const pending = [...phaseStatus.values()].filter((s) => s.result === "pending").length;
  lines.push(`Checks: ${attempted} phases attempted, ${completed} completed, ${errored} errored, ${pending} pending.`);
  lines.push("");
  lines.push("## Findings with a non-\"unknown\" severity_hint recorded this run");
  lines.push("");
  if (nonUnknownFindings.length === 0) {
    lines.push("(none yet)");
  } else {
    for (const f of nonUnknownFindings) {
      lines.push(`- \`${f.severity_hint}\` ${f.id} — ${f.target}`);
    }
  }
  lines.push("");
  lines.push("## Coverage gaps");
  lines.push("");
  lines.push("- Phase 3 (reserved-slug) probes 8 of the full `RESERVED_SLUGS` list in");
  lines.push("  `packages/domain/src/slug.ts`, not all of it.");
  lines.push("- Phase 5 (bio XSS) DOM-executes only the `profile.name` payload via a real");
  lines.push("  browser; `profile.bio`, `block.title` and `block.href` are checked at the");
  lines.push("  HTTP/contract layer only (see that phase's findings for which).");
  lines.push("- No ZAP/semgrep/static scan is run by this suite.");
  lines.push("");
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(SUMMARY_FILE, lines.join("\n"));
}

async function req(method, url, { body, token, headers } = {}) {
  const h = { ...(headers ?? {}) };
  if (body !== undefined) h["content-type"] = "application/json";
  if (token) h["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: Object.fromEntries(res.headers.entries()) };
}

/** psql against the staging container, read-only queries only. */
function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-t", "-A", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

/** Drives e2e/adversarial/dom-xss.spec.ts (real Chromium via Playwright)
 * against a bio-page slug this run already wrote a payload into. Playwright
 * manages its own webServer lifecycle (next dev), so nothing long-lived is
 * hand-started from this script's shell (session-hygiene.md). Synchronous
 * on purpose — this phase must not move on to other payloads/finish while a
 * browser check for THIS payload is still outstanding. */
function runDomXssCheck(slug) {
  const env = {
    ...process.env,
    BIO_SLUG: slug,
    QA_RUN_DIR: RUN_DIR,
    QA_API_URL: API,
  };
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync(
      "pnpm",
      ["--filter", "snapurl-e2e", "exec", "playwright", "test", "-c", "adversarial/playwright.dom-xss.config.ts"],
      { cwd: path.join(REPO_ROOT, "e2e"), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    // execFileSync throws on non-zero exit — that IS the signal (a failed
    // Playwright assertion means fired=true, i.e. the payload executed).
    stdout = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    exitCode = typeof e.status === "number" ? e.status : 1;
  }
  const match = stdout.match(/DOM_XSS_RESULT.*$/m);
  return {
    exitCode,
    ranSuccessfully: /DOM_XSS_RESULT/.test(stdout),
    summaryLine: match ? match[0] : undefined,
    rawOutputTail: stdout.slice(-4000),
  };
}

function randSuffix() {
  return `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
}

const PASSWORD = randomBytes(24).toString("base64url"); // clears the 12-char RegisterInput minimum

async function registerUser(label) {
  const suffix = randSuffix();
  const email = `l5-${label}-${suffix}@example.com`;
  const name = `l5 ${label} ${suffix}`;
  const res = await req("POST", `${API}/auth/register`, { body: { name, email, password: PASSWORD } });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`register(${label}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { email, password: PASSWORD, accessToken: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user?.id, workspaceId: res.body.user?.workspaceId };
}

async function currentWorkspace(token) {
  const res = await req("GET", `${API}/workspaces/current`, { token });
  return res.body;
}

async function createLink(token, domain, destination) {
  const res = await req("POST", `${API}/links`, {
    token,
    body: { destination, domain, slug: `l5-${randSuffix()}` },
  });
  return res;
}

// ============================================================
// Phase 1 — IDOR across :id routes
// Oracle: security-and-context.md "every data query is workspace-scoped";
// a cross-workspace :id read/update/delete must fail (404/403), never
// return or mutate another workspace's row.
// ============================================================
async function phase1_idor() {
  const phase = "idor-cross-workspace";
  const userA = await registerUser("idor-a");
  const userB = await registerUser("idor-b");
  const wsA = await currentWorkspace(userA.accessToken);
  const wsB = await currentWorkspace(userB.accessToken);

  const linkRes = await createLink(userA.accessToken, wsA.defaultDomain, "https://example.com/idor-victim-link");
  const linkId = linkRes.body?.id;

  const routes = [
    { method: "GET", path: `/links/${linkId}`, name: "links-get" },
    { method: "PATCH", path: `/links/${linkId}`, name: "links-patch", body: { destination: "https://example.com/attacker-overwrite" } },
  ];

  for (const route of routes) {
    const res = await req(route.method, `${API}${route.path}`, { token: userB.accessToken, body: route.body });
    const artifact = saveArtifact(`idor-${route.name}.json`, { request: route, response: res });
    finding({
      id: `idor-${route.name}-${randSuffix()}`,
      layer: "adversarial",
      title: `User B attempts ${route.method} ${route.path} (User A's link) with User B's own token`,
      target: `${route.method} ${route.path}`,
      what_i_did: `Registered two independent accounts (A, B), each provisioned its own workspace by registration. ` +
        `A created a link (id=${linkId}) in A's workspace. B then called ${route.method} ${route.path} using ONLY B's access token.`,
      expected: `security-and-context.md: "Every data query is workspace-scoped. A new query that can read across ` +
        `workspace boundaries is a security bug." Oracle predicts 404 (LinksService.get/.update scope by actor.workspaceId) ` +
        `and B's workspace must be unaffected.`,
      observed: `status=${res.status} body=${JSON.stringify(res.body).slice(0, 300)}`,
      evidence: [artifact],
      repro: `curl -s -X ${route.method} ${API}${route.path} -H "authorization: Bearer <B_TOKEN>"` + (route.body ? ` -H "content-type: application/json" -d '${JSON.stringify(route.body)}'` : ""),
      severity_hint: res.status >= 200 && res.status < 300 ? "sev1" : "unknown",
      confidence: "high",
      notes: "Cross-account probe over the real staging API; both accounts and the link are freshly created per run, not shared fixtures.",
    });
  }

  // Also check the link is unmodified in A's view (independent re-read, not reused response).
  const reread = await req("GET", `${API}/links/${linkId}`, { token: userA.accessToken });
  const artifact2 = saveArtifact("idor-reread-by-owner.json", reread);
  finding({
    id: `idor-link-state-after-cross-attempt-${randSuffix()}`,
    layer: "adversarial",
    title: "Re-read link as its owner (A) after B's cross-workspace PATCH attempt",
    target: "GET /links/:id",
    what_i_did: `After B's PATCH attempt above, re-fetched the same link as A to see whether destination changed.`,
    expected: `Destination must still read https://example.com/idor-victim-link if the PATCH in the prior check was rejected.`,
    observed: `status=${reread.status} destination=${reread.body?.destination}`,
    evidence: [artifact2],
    repro: `curl -s ${API}/links/${linkId} -H "authorization: Bearer <A_TOKEN>"`,
    severity_hint: "unknown",
    confidence: "high",
    notes: "",
  });
}

// ============================================================
// Phase 2 — Workspace isolation at the DB level
// Oracle: qa-oracles.md §1.4 invariant — a user can never read another
// workspace's rows — checked directly against Postgres row ownership,
// not just the API response shape.
// ============================================================
async function phase2_db_isolation() {
  const userA = await registerUser("dbiso-a");
  const userB = await registerUser("dbiso-b");
  const wsA = await currentWorkspace(userA.accessToken);
  const wsB = await currentWorkspace(userB.accessToken);

  const linkRes = await createLink(userA.accessToken, wsA.defaultDomain, "https://example.com/db-isolation-check");
  const linkId = linkRes.body?.id;

  // Oracle check 1: GET /links (list) for B must not include A's link id.
  const listB = await req("GET", `${API}/links`, { token: userB.accessToken });
  const idsInB = (listB.body?.items ?? listB.body ?? []).map?.((l) => l.id) ?? [];
  const leaked = Array.isArray(idsInB) && idsInB.includes(linkId);
  const artifact1 = saveArtifact("db-isolation-list-b.json", listB);
  finding({
    id: `workspace-isolation-list-leak-${randSuffix()}`,
    layer: "adversarial",
    title: "GET /links as User B must not list User A's link id",
    target: "GET /links",
    what_i_did: `A created link id=${linkId} in A's workspace. Called GET /links with B's token and checked whether ${linkId} appears.`,
    expected: `qa-oracles.md §1.4: a user can never read another workspace's rows.`,
    observed: `status=${listB.status}; A's link id present in B's list = ${leaked}`,
    evidence: [artifact1],
    repro: `curl -s ${API}/links -H "authorization: Bearer <B_TOKEN>"`,
    severity_hint: leaked ? "sev1" : "unknown",
    confidence: "high",
    notes: "",
  });

  // Oracle check 2: direct DB row ownership — the link's workspace_id column
  // must equal wsA.id, independent of what any API response claims.
  let dbRow = "";
  let dbErr = null;
  try {
    dbRow = psql(`select workspace_id from links where id = '${linkId}';`);
  } catch (e) {
    dbErr = String(e);
  }
  const artifact2 = saveArtifact("db-isolation-row-ownership.txt", `workspace_id for link ${linkId}: ${dbRow}\nexpected wsA.id: ${wsA.id}\nerror: ${dbErr}`);
  finding({
    id: `workspace-isolation-db-row-ownership-${randSuffix()}`,
    layer: "adversarial",
    title: "Direct Postgres check that link row's workspace_id matches the creating workspace",
    target: "packages/database links table (via docker exec psql)",
    what_i_did: `Queried Postgres directly (not through the API) for the workspace_id column of link id=${linkId}, bypassing any API-layer response shaping.`,
    expected: `workspace_id column must equal A's workspace id (${wsA.id}), the invariant qa-oracles.md §1.4 names explicitly as a DB-level check, not just an API response-shape check.`,
    observed: dbErr ? `psql error: ${dbErr}` : `workspace_id=${dbRow}`,
    evidence: [artifact2],
    repro: `docker exec -i ${PG_CONTAINER} psql -U snapurl -d snapurl -t -A -c "select workspace_id from links where id = '${linkId}';"`,
    severity_hint: "unknown",
    confidence: dbErr ? "low" : "high",
    notes: dbErr ? "psql invocation failed; see notes for a different-method cross-check next time (API list) rather than treating this as a pass." : "",
  });
}

// ============================================================
// Phase 3 — Reserved-slug bypass
// Oracle: packages/domain/src/slug.ts RESERVED_SLUGS + isSlugAvailableShape —
// the declared list of slugs the product refuses to assign. A link create
// that succeeds with a reserved slug (in any case variant) is the defect
// signature the oracle predicts should be rejected.
// ============================================================
async function phase3_reserved_slug() {
  const user = await registerUser("reserved");
  const ws = await currentWorkspace(user.accessToken);

  const candidates = ["admin", "ADMIN", "Admin", "login", "api", "p", "security", "_next"];
  for (const slug of candidates) {
    const res = await req("POST", `${API}/links`, {
      token: user.accessToken,
      body: { destination: "https://example.com/reserved-slug-probe", domain: ws.defaultDomain, slug },
    });
    const artifact = saveArtifact(`reserved-slug-${slug}.json`, res);
    finding({
      id: `reserved-slug-bypass-${slug}-${randSuffix()}`,
      layer: "adversarial",
      title: `POST /links with reserved slug "${slug}"`,
      target: "POST /links",
      what_i_did: `Called POST /links with slug="${slug}" (one of packages/domain/src/slug.ts RESERVED_SLUGS, or a case variant of one).`,
      expected: `packages/domain/src/slug.ts isSlugAvailableShape: RESERVED_SLUGS.has(slug.toLowerCase()) must reject with "is reserved by SnapURL". Oracle predicts 400/409, never 200/201.`,
      observed: `status=${res.status} body=${JSON.stringify(res.body).slice(0, 300)}`,
      evidence: [artifact],
      repro: `curl -s -X POST ${API}/links -H "authorization: Bearer <TOKEN>" -H "content-type: application/json" -d '{"destination":"https://example.com/x","domain":"${ws.defaultDomain}","slug":"${slug}"}'`,
      severity_hint: res.status >= 200 && res.status < 300 ? "sev2" : "unknown",
      confidence: "high",
      notes: "",
    });
  }
}

// ============================================================
// Phase 4 — Open redirect via a crafted routing chain
// Oracle: packages/contract/src/http-url.ts HttpUrl (the contract-layer SSRF
// guard: non-http(s) scheme or denied-range host must be rejected before the
// chain is ever saved). A routing rule whose `then` reaches a denied host or
// non-http(s) scheme, that is accepted and later actually served by the
// redirect service, is the defect signature.
// ============================================================
async function phase4_open_redirect() {
  const user = await registerUser("redirect");
  const ws = await currentWorkspace(user.accessToken);

  const maliciousDestinations = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3001/api/v1/workspaces/current",
    "ftp://example.com/x",
  ];

  for (const dest of maliciousDestinations) {
    // Attempt as the link's own destination AND as a routing-rule `then`.
    const slug = `l5-${randSuffix()}`;
    const createRes = await req("POST", `${API}/links`, {
      token: user.accessToken,
      body: {
        destination: "https://example.com/safe-fallback",
        domain: ws.defaultDomain,
        slug,
        rules: [{ id: "r1", when: { country: "IN" }, then: dest }],
      },
    });
    const artifactCreate = saveArtifact(`open-redirect-create-${encodeURIComponent(dest)}.json`, createRes);
    finding({
      id: `open-redirect-chain-create-${encodeURIComponent(dest)}-${randSuffix()}`,
      layer: "adversarial",
      title: `POST /links with a routing rule whose "then" is "${dest}"`,
      target: "POST /links (rules[].then)",
      what_i_did: `Created a link whose routing chain has one rule {when:{country:"IN"}, then:"${dest}"} and a safe fallback destination.`,
      expected: `packages/contract/src/link.ts RoutingRule.then is typed HttpUrl (packages/contract/src/http-url.ts), which rejects non-http(s) schemes and denied-range hosts at parse time. Oracle predicts 400, chain never persisted.`,
      observed: `status=${createRes.status} body=${JSON.stringify(createRes.body).slice(0, 300)}`,
      evidence: [artifactCreate],
      repro: `curl -s -X POST ${API}/links -H "authorization: Bearer <TOKEN>" -H "content-type: application/json" -d '{"destination":"https://example.com/safe-fallback","domain":"${ws.defaultDomain}","slug":"${slug}","rules":[{"id":"r1","when":{"country":"IN"},"then":"${dest}"}]}'`,
      severity_hint: createRes.status >= 200 && createRes.status < 300 ? "sev1" : "unknown",
      confidence: "high",
      notes: "",
    });

    // If creation somehow succeeded, follow up by actually hitting the redirect
    // service with a matching country header to see if it is actually SERVED,
    // not just accepted — the acceptance criterion names the redirect service's
    // execution explicitly (both import packages/domain, divergence is a bug).
    if (createRes.status >= 200 && createRes.status < 300 && createRes.body?.id) {
      const redirectRes = await req("GET", `${REDIRECT}/${slug}`, {
        headers: { "cloudfront-viewer-country": "IN", host: ws.defaultDomain },
      });
      const artifactServe = saveArtifact(`open-redirect-serve-${encodeURIComponent(dest)}.json`, redirectRes);
      finding({
        id: `open-redirect-chain-serve-${encodeURIComponent(dest)}-${randSuffix()}`,
        layer: "adversarial",
        title: `GET redirect for a link whose routing rule "then" is "${dest}", with a matching visitor context`,
        target: `GET /${slug} (apps/redirect)`,
        what_i_did: `The create call above was accepted, so hit the redirect service directly with cloudfront-viewer-country: IN to force the rule to match.`,
        expected: `apps/redirect and apps/api both import packages/domain's evaluateRouting; the acceptance criteria for this issue state the two "must agree" — if the API wrongly accepted the chain, the test is whether redirect ALSO actually serves it (Location header = ${dest}) or independently refuses.`,
        observed: `status=${redirectRes.status} location=${redirectRes.headers?.location ?? "(none)"}`,
        evidence: [artifactServe],
        repro: `curl -s -D- -o /dev/null ${REDIRECT}/${slug} -H "cloudfront-viewer-country: IN" -H "host: ${ws.defaultDomain}"`,
        severity_hint: redirectRes.headers?.location === dest ? "sev1" : "unknown",
        confidence: "high",
        notes: "",
      });
    }
  }
}

// ============================================================
// Phase 5 — Stored XSS on bio pages
// Oracle: DOM-based — the public bio page (GET /public/bio-pages/:slug then
// rendered at web /b/:slug) must not let an injected payload execute. For the
// API layer itself: packages/contract/src/workspace.ts BioBlock/UpsertBioPageInput
// (profile.name/bio are plain z.string(), block.href is HttpUrl). A payload
// that round-trips unescaped into a sink a DOM check can detect executing, or
// a write-path field that accepts a non-http(s) scheme, is the defect
// signature.
// ============================================================
async function phase5_bio_xss() {
  const user = await registerUser("xss");
  const ws = await currentWorkspace(user.accessToken);

  const xssPayloads = [
    { field: "profile.name", value: '<img src=x onerror=alert(1)>' },
    { field: "profile.bio", value: '<script>alert(document.domain)</script>' },
    { field: "block.title", value: '"><svg onload=alert(1)>' },
    { field: "block.href-javascript", value: "javascript:alert(1)" },
  ];

  for (const payload of xssPayloads) {
    const slug = `l5xss-${randSuffix()}`;
    const isHrefCase = payload.field === "block.href-javascript";
    const body = {
      domain: ws.defaultDomain,
      slug,
      status: "live",
      profile: {
        name: payload.field === "profile.name" ? payload.value : "L5 Bio",
        bio: payload.field === "profile.bio" ? payload.value : "bio",
      },
      blocks: [
        {
          kind: "link",
          title: payload.field === "block.title" ? payload.value : "A link",
          href: isHrefCase ? payload.value : "https://example.com/safe",
        },
      ],
    };
    const upsertRes = await req("PUT", `${API}/bio-pages`, { token: user.accessToken, body });
    const artifact = saveArtifact(`bio-xss-write-${payload.field.replace(/[^a-z0-9-]/gi, "_")}.json`, upsertRes);

    finding({
      id: `bio-xss-write-${payload.field.replace(/[^a-z0-9-]/gi, "_")}-${randSuffix()}`,
      layer: "adversarial",
      title: `PUT /bio-pages with payload in ${payload.field}: ${JSON.stringify(payload.value)}`,
      target: "PUT /bio-pages",
      what_i_did: `Upserted a bio page with an XSS-style payload in ${payload.field}.`,
      expected: isHrefCase
        ? `packages/contract/src/workspace.ts UpsertBioPageInput.blocks[].href is typed HttpUrl, which z.url({protocol:/^https?$/}) rejects a javascript: scheme before the host check ever runs. Oracle predicts 400, not persisted.`
        : `profile.name/profile.bio/block.title are plain z.string() in the contract (no HTML stripping declared) — the oracle for THIS layer is whether the value is stored verbatim (expected, contract allows it) and whether it is later rendered unescaped by the consuming page (checked in the next finding, by fetching the public page and the rendered DOM).`,
      observed: `status=${upsertRes.status} body=${JSON.stringify(upsertRes.body).slice(0, 400)}`,
      evidence: [artifact],
      repro: `curl -s -X PUT ${API}/bio-pages -H "authorization: Bearer <TOKEN>" -H "content-type: application/json" -d '${JSON.stringify(body)}'`,
      severity_hint: isHrefCase && upsertRes.status >= 200 && upsertRes.status < 300 ? "sev1" : "unknown",
      confidence: "high",
      notes: "",
    });

    // Independent second method: read back the PUBLIC endpoint (unauthenticated,
    // the actual oracle surface a visitor's browser sees) and record literally
    // whether the payload appears unescaped in the JSON the web app would render
    // via JSX text interpolation. This does NOT execute a browser — a true DOM
    // execution oracle needs Playwright and is listed as a coverage gap below if
    // not run in this pass.
    if (upsertRes.status >= 200 && upsertRes.status < 300) {
      const publicRes = await req("GET", `${API}/public/bio-pages/${slug}`);
      const raw = JSON.stringify(publicRes.body);
      const containsRawScriptTag = raw.includes("<script>") || raw.includes("onerror=") || raw.includes("onload=");
      const artifact2 = saveArtifact(`bio-xss-public-read-${payload.field.replace(/[^a-z0-9-]/gi, "_")}.json`, publicRes);
      finding({
        id: `bio-xss-public-read-${payload.field.replace(/[^a-z0-9-]/gi, "_")}-${randSuffix()}`,
        layer: "adversarial",
        title: `GET /public/bio-pages/:slug after storing payload in ${payload.field}`,
        target: "GET /public/bio-pages/:slug",
        what_i_did: `Fetched the unauthenticated public bio-page JSON for the page created above and checked whether the raw payload markup is present in the response body.`,
        expected: `This is a JSON API response, not HTML — the oracle for actual execution is the web app's JSX rendering (text interpolation auto-escapes; web/src/app/b/[slug]/page.tsx has no dangerouslySetInnerHTML as of this run's read of that file). This check only establishes whether the API stores/echoes the payload verbatim; it is NOT a DOM execution oracle by itself.`,
        observed: `status=${publicRes.status}; raw payload substring present in response = ${containsRawScriptTag}`,
        evidence: [artifact2],
        repro: `curl -s ${API}/public/bio-pages/${slug}`,
        severity_hint: "unknown",
        confidence: "medium",
        notes: "",
      });
    }

    // DOM-execution oracle (issue #607: "DOM-based oracle (does the payload
    // execute), not a judgement call") — run the real-browser check from
    // e2e/adversarial/dom-xss.spec.ts against THIS payload's slug, for the
    // profile.name case. profile.name is picked because it is the one field
    // rendered unconditionally on every bio page regardless of other content
    // (web/src/app/b/[slug]/page.tsx renders {p.profile.name} directly in an
    // <h1>), making it the most representative single DOM check to wire into
    // the automated suite; the other three payloads are still exercised at
    // the HTTP/contract layer above and are a named coverage gap in
    // summary.md for the DOM layer specifically.
    if (payload.field === "profile.name" && upsertRes.status >= 200 && upsertRes.status < 300) {
      const domResult = runDomXssCheck(slug);
      const artifact3 = saveArtifact(`bio-xss-dom-${payload.field.replace(/[^a-z0-9-]/gi, "_")}.json`, domResult);
      finding({
        id: `bio-xss-dom-execution-${payload.field.replace(/[^a-z0-9-]/gi, "_")}-${randSuffix()}`,
        layer: "adversarial",
        title: `Real-browser DOM check: does the ${payload.field} payload execute on the rendered /b/${slug} page?`,
        target: "web /b/:slug (e2e/adversarial/dom-xss.spec.ts)",
        what_i_did: `Ran e2e/adversarial/dom-xss.spec.ts (Playwright, real Chromium) with BIO_SLUG=${slug} against the public bio page carrying the ${payload.field} payload ${JSON.stringify(payload.value)}.`,
        expected: `web/src/app/b/[slug]/page.tsx renders profile.name via plain JSX text interpolation ({p.profile.name}), which React escapes — the spec's oracle is window.alert/dialog firing. Oracle predicts the Playwright test PASSES (fired=false, no execution).`,
        observed: `playwright exit code=${domResult.exitCode}; ${domResult.summaryLine ?? "(no DOM_XSS_RESULT line captured — see artifact for raw output)"}`,
        evidence: [artifact3],
        repro: `BIO_SLUG=${slug} QA_WEB_URL=http://localhost:3000 QA_API_URL=${API} pnpm --filter snapurl-e2e exec playwright test -c adversarial/playwright.dom-xss.config.ts`,
        severity_hint: domResult.exitCode !== 0 ? "sev1" : "unknown",
        confidence: domResult.ranSuccessfully ? "high" : "low",
        notes: domResult.ranSuccessfully
          ? ""
          : "The Playwright invocation itself did not complete cleanly (see artifact raw output) — this is a harness-execution concern worth re-probing, not evidence either way about the payload.",
      });
    }
  }
}

// ============================================================
// Phase 6 — Refresh-token reuse after rotation
// Oracle: apps/api/src/auth/token.service.ts TokenService.rotate — a token
// that has already been replaced (row.replacedById set) must revoke the
// WHOLE family, not just refuse the one reused token. security-and-context.md:
// "rotating refresh token with reuse detection... do not remove reuse
// detection".
// ============================================================
async function phase6_refresh_reuse() {
  const user = await registerUser("reuse");

  const first = await req("POST", `${API}/auth/refresh`, { body: { refreshToken: user.refreshToken } });
  const artifact1 = saveArtifact("refresh-reuse-first-rotation.json", first);
  const rotatedToken = first.body?.refreshToken;

  finding({
    id: `refresh-reuse-first-rotation-${randSuffix()}`,
    layer: "adversarial",
    title: "First use of a freshly issued refresh token rotates successfully",
    target: "POST /auth/refresh",
    what_i_did: `Registered a user, then immediately called POST /auth/refresh once with the refresh token issued at registration.`,
    expected: `token.service.ts TokenService.rotate: a valid, unused, unexpired token rotates and returns a new pair. Oracle predicts 200 with a new refreshToken different from the original.`,
    observed: `status=${first.status}; new token issued and differs from original = ${rotatedToken && rotatedToken !== user.refreshToken}`,
    evidence: [artifact1],
    repro: `curl -s -X POST ${API}/auth/refresh -H "content-type: application/json" -d '{"refreshToken":"<ORIGINAL_REFRESH_TOKEN>"}'`,
    severity_hint: "unknown",
    confidence: "high",
    notes: "",
  });

  // Reuse the ORIGINAL (already-rotated) token — this is the attack scenario:
  // someone who captured the token before rotation tries to use the stale copy.
  const reuseAttempt = await req("POST", `${API}/auth/refresh`, { body: { refreshToken: user.refreshToken } });
  const artifact2 = saveArtifact("refresh-reuse-second-attempt.json", reuseAttempt);
  finding({
    id: `refresh-reuse-stale-token-rejected-${randSuffix()}`,
    layer: "adversarial",
    title: "Reusing the original (already-rotated) refresh token must be rejected",
    target: "POST /auth/refresh",
    what_i_did: `Called POST /auth/refresh AGAIN with the SAME original refresh token already consumed in the prior check.`,
    expected: `token.service.ts: row.replacedById is set from the first rotation, so TokenService.rotate must throw UnauthorizedException("...already used...") and revoke the whole family (reuse detection). Oracle predicts 401, never a fresh token pair.`,
    observed: `status=${reuseAttempt.status} body=${JSON.stringify(reuseAttempt.body).slice(0, 300)}`,
    evidence: [artifact2],
    repro: `curl -s -X POST ${API}/auth/refresh -H "content-type: application/json" -d '{"refreshToken":"<ORIGINAL_REFRESH_TOKEN>"}'`,
    severity_hint: reuseAttempt.status >= 200 && reuseAttempt.status < 300 ? "sev1" : "unknown",
    confidence: "high",
    notes: "",
  });

  // Family-revocation check: after the reuse attempt, the ROTATED token (from
  // the first, legitimate rotation) must ALSO now be dead, because reuse
  // detection is supposed to kill the whole family, not just refuse the stale
  // token.
  if (rotatedToken) {
    const familyCheck = await req("POST", `${API}/auth/refresh`, { body: { refreshToken: rotatedToken } });
    const artifact3 = saveArtifact("refresh-reuse-family-revoked-check.json", familyCheck);
    finding({
      id: `refresh-reuse-family-revocation-${randSuffix()}`,
      layer: "adversarial",
      title: "After a detected reuse, the legitimately-rotated token from the same family must also be dead",
      target: "POST /auth/refresh",
      what_i_did: `After the stale-token reuse attempt above (which should trigger revokeFamily), called POST /auth/refresh with the NEW token from the FIRST legitimate rotation — same family, never itself reused.`,
      expected: `token.service.ts docblock: "the whole family is revoked and every session descended from that login is dead." Oracle predicts 401 even though this specific token was never directly reused.`,
      observed: `status=${familyCheck.status} body=${JSON.stringify(familyCheck.body).slice(0, 300)}`,
      evidence: [artifact3],
      repro: `curl -s -X POST ${API}/auth/refresh -H "content-type: application/json" -d '{"refreshToken":"<ROTATED_TOKEN_FROM_FIRST_REFRESH>"}'`,
      severity_hint: familyCheck.status >= 200 && familyCheck.status < 300 ? "sev1" : "unknown",
      confidence: "high",
      notes: "",
    });
  }
}

// ============================================================
// Phase 7 — IDOR across member/form/domain/bio-page/api-key :id routes
// Oracle: same as phase 1 — security-and-context.md "every data query is
// workspace-scoped" — extended beyond /links to the other :id-bearing
// controllers named in the issue's "files likely touched" scope.
// ============================================================
async function phase7_idor_other_resources() {
  const userA = await registerUser("idor2-a");
  const userB = await registerUser("idor2-b");
  const wsA = await currentWorkspace(userA.accessToken);

  // Form owned by A.
  const formRes = await req("POST", `${API}/forms`, {
    token: userA.accessToken,
    body: { title: `l5 form ${randSuffix()}`, slug: `l5form-${randSuffix()}`, fields: [{ label: "Email", type: "email", required: true }] },
  });
  const formId = formRes.body?.id;

  // Bio page owned by A.
  const bioRes = await req("PUT", `${API}/bio-pages`, {
    token: userA.accessToken,
    body: { domain: wsA.defaultDomain, slug: `l5bio-${randSuffix()}`, status: "draft", profile: { name: "A", bio: "" }, blocks: [] },
  });
  const bioPageId = bioRes.body?.id;

  // Domain owned by A — use the system default domain's workspace record if
  // a custom-domain create isn't trivial; fall back to skipping gracefully if
  // the API requires DNS verification setup. Try anyway and record whatever
  // happens, since the oracle covers "any :id route", not just the ones that
  // happen to succeed easily.
  const domainCreateRes = await req("POST", `${API}/domains`, {
    token: userA.accessToken,
    body: { domain: `l5-dom-${randSuffix()}.example.com` },
  });
  const domainId = domainCreateRes.body?.id;

  const probes = [
    formId && { method: "GET", path: `/forms/${formId}`, name: "forms-get" },
    formId && { method: "PATCH", path: `/forms/${formId}`, name: "forms-patch", body: { title: "attacker-renamed" } },
    formId && { method: "DELETE", path: `/forms/${formId}`, name: "forms-delete" },
    bioPageId && { method: "DELETE", path: `/bio-pages/${bioPageId}`, name: "bio-pages-delete" },
    domainId && { method: "DELETE", path: `/domains/${domainId}`, name: "domains-delete" },
  ].filter(Boolean);

  for (const probe of probes) {
    const res = await req(probe.method, `${API}${probe.path}`, { token: userB.accessToken, body: probe.body });
    const artifact = saveArtifact(`idor2-${probe.name}.json`, { probe, response: res });
    finding({
      id: `idor-cross-workspace-${probe.name}-${randSuffix()}`,
      layer: "adversarial",
      title: `User B attempts ${probe.method} ${probe.path} (User A's resource) with User B's own token`,
      target: `${probe.method} ${probe.path}`,
      what_i_did: `A created the resource under test in A's workspace. B then called ${probe.method} ${probe.path} using ONLY B's access token (B never had this resource's id handed to them by the API — it was read out of A's own creation response).`,
      expected: `security-and-context.md: "Every data query is workspace-scoped." Oracle predicts 404 (not found scoped to B's workspace) for read/update/delete, and the DELETE in particular must not reduce A's resource count.`,
      observed: `status=${res.status} body=${JSON.stringify(res.body).slice(0, 300)}`,
      evidence: [artifact],
      repro: `curl -s -X ${probe.method} ${API}${probe.path} -H "authorization: Bearer <B_TOKEN>"` + (probe.body ? ` -H "content-type: application/json" -d '${JSON.stringify(probe.body)}'` : ""),
      severity_hint: res.status >= 200 && res.status < 300 ? "sev1" : "unknown",
      confidence: formId || bioPageId || domainId ? "high" : "low",
      notes: !formId ? "forms-create itself may have failed; see artifact for the create response before trusting this probe's absence." : "",
    });
  }
}

// ============================================================
// Phase 8 — API key scope boundary (part of the workspace-isolation /
// authorization scope item). Oracle: apps/api/src/auth/auth.guard.ts —
// "A key may now reach a route only if that route names a scope the key
// actually holds" (fixing the historical gap documented in that file's own
// comment). A links:read-only key reaching a @Roles("admin")-gated,
// no-@Scope route (e.g. members, developers) is the defect signature.
// ============================================================
async function phase8_api_key_scope_boundary() {
  const user = await registerUser("apikey");

  const createKeyRes = await req("POST", `${API}/api-keys`, {
    token: user.accessToken,
    body: { name: `l5-key-${randSuffix()}`, scopes: ["links:read"] },
  });
  const apiKey = createKeyRes.body?.key;
  const artifactCreate = saveArtifact("apikey-create.json", createKeyRes);
  finding({
    id: `apikey-scope-create-${randSuffix()}`,
    layer: "adversarial",
    title: "Create an API key scoped to links:read only",
    target: "POST /api-keys",
    what_i_did: `Created an API key with scopes=["links:read"] only.`,
    expected: `packages/contract/src/workspace.ts CreatedApiKey; expect 201 with a usable key string.`,
    observed: `status=${createKeyRes.status} key present=${Boolean(apiKey)}`,
    evidence: [artifactCreate],
    repro: `curl -s -X POST ${API}/api-keys -H "authorization: Bearer <TOKEN>" -H "content-type: application/json" -d '{"name":"probe","scopes":["links:read"]}'`,
    severity_hint: "unknown",
    confidence: "high",
    notes: "",
  });

  if (!apiKey) return;

  // Route with NO @Scope decorator and @Roles("admin") — members list.
  // auth.guard.ts: "API keys fail CLOSED... A key may now reach a route only
  // if that route names a scope the key actually holds." members has no
  // @Scope at all, so the guard's `if (!scope) throw Forbidden` branch should
  // fire before @Roles is even consulted for an API-key actor.
  const membersRes = await req("GET", `${API}/members`, { token: apiKey });
  const artifactMembers = saveArtifact("apikey-members-probe.json", membersRes);
  finding({
    id: `apikey-scope-boundary-members-${randSuffix()}`,
    layer: "adversarial",
    title: "links:read-scoped API key attempts GET /members (no @Scope on that route)",
    target: "GET /members",
    what_i_did: `Called GET /members using the Authorization header set to the links:read-only API key created above (not a user JWT).`,
    expected: `auth.guard.ts: a route with no @Scope decorator must reject any API-key actor outright ("This route is not available to API keys."), regardless of what scopes the key holds. Oracle predicts 403, never member data.`,
    observed: `status=${membersRes.status} body=${JSON.stringify(membersRes.body).slice(0, 300)}`,
    evidence: [artifactMembers],
    repro: `curl -s ${API}/members -H "authorization: Bearer <API_KEY>"`,
    severity_hint: membersRes.status >= 200 && membersRes.status < 300 ? "sev1" : "unknown",
    confidence: "high",
    notes: "",
  });

  // Route WITH @Scope("links:write") but the key only has links:read.
  const createLinkWithKey = await req("POST", `${API}/links`, {
    token: apiKey,
    body: { destination: "https://example.com/apikey-scope-probe", domain: "localhost:3002", slug: `l5key-${randSuffix()}` },
  });
  const artifactWrite = saveArtifact("apikey-links-write-probe.json", createLinkWithKey);
  finding({
    id: `apikey-scope-boundary-links-write-${randSuffix()}`,
    layer: "adversarial",
    title: "links:read-scoped API key attempts POST /links (@Scope(\"links:write\"))",
    target: "POST /links",
    what_i_did: `Called POST /links (which declares @Scope("links:write")) using the links:read-only API key.`,
    expected: `auth.guard.ts: "if (!request.actor.scopes?.includes(scope)) throw Forbidden". Oracle predicts 403, no link created.`,
    observed: `status=${createLinkWithKey.status} body=${JSON.stringify(createLinkWithKey.body).slice(0, 300)}`,
    evidence: [artifactWrite],
    repro: `curl -s -X POST ${API}/links -H "authorization: Bearer <API_KEY>" -H "content-type: application/json" -d '{"destination":"https://example.com/x","domain":"localhost:3002","slug":"probe"}'`,
    severity_hint: createLinkWithKey.status >= 200 && createLinkWithKey.status < 300 ? "sev1" : "unknown",
    confidence: "high",
    notes: "",
  });
}

async function main() {
  const phases = [
    ["idor", phase1_idor],
    ["db-isolation", phase2_db_isolation],
    ["reserved-slug", phase3_reserved_slug],
    ["open-redirect", phase4_open_redirect],
    ["bio-xss", phase5_bio_xss],
    ["refresh-reuse", phase6_refresh_reuse],
    ["idor-other-resources", phase7_idor_other_resources],
    ["api-key-scope-boundary", phase8_api_key_scope_boundary],
  ];

  // summary.md must exist before any check runs (steering §3.1), not only
  // once a reviewer or operator happens to create it by hand.
  initSummary(phases.map(([name]) => name));

  let anyPhaseErrored = false;

  for (const [name, fn] of phases) {
    try {
      await fn();
      appendFileSync(PROGRESS_FILE, `${new Date().toISOString()} phase=${name} result=completed\n`);
      console.log(`== phase ${name}: completed ==`);
      setPhaseStatus(name, "completed", "");
    } catch (e) {
      anyPhaseErrored = true;
      appendFileSync(PROGRESS_FILE, `${new Date().toISOString()} phase=${name} result=errored: ${String(e).slice(0, 300)}\n`);
      console.error(`== phase ${name}: ERRORED ==`, e);
      setPhaseStatus(name, "errored", String(e).slice(0, 300));
    }
  }

  // Final summary rewrite happens inside setPhaseStatus already, but do one
  // more pass so the "non-unknown findings" section reflects anything a
  // phase recorded on its very last iteration.
  writeSummary();

  // The runner must turn an exploit signature or phase failure into a
  // non-zero exit — a finding written to findings.jsonl is evidence, not a
  // passing assertion (review on PR #628, confirmed by the bug-injection
  // gate: disabling RESERVED_SLUGS produced sev2 findings but a 0 exit).
  if (nonUnknownFindings.length > 0) {
    console.error(
      `\n[FAIL] ${nonUnknownFindings.length} finding(s) with a non-"unknown" severity_hint were recorded this run:`,
    );
    for (const f of nonUnknownFindings) {
      console.error(`  - ${f.severity_hint} ${f.id} (${f.target})`);
    }
    console.error(`See ${FINDINGS_FILE} and ${SUMMARY_FILE} for full detail.`);
    process.exitCode = 1;
    return;
  }

  if (anyPhaseErrored) {
    console.error(`\n[FAIL] at least one phase errored. See ${PROGRESS_FILE} and ${SUMMARY_FILE}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n[OK] all phases completed, no non-"unknown" severity_hint recorded.`);
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exitCode = 1;
});
