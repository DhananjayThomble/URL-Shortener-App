/*
 * L4 — semantic end-to-end. Values, not renders.
 *
 * Every check below constructs its own ground truth (a known N of clicks, a
 * known mix of countries/devices, a known conversion value) and then reads
 * the SAME fact back through two independent surfaces where the brief asks
 * for it (API vs raw SQL). Ground truth is never derived by reading
 * apps/api or apps/worker — see .kiro/steering/qa-oracles.md §1.
 *
 * Oracles used, per check:
 *   C1  the N this script drove, read via GET /analytics AND
 *       `select count(*) from click_events`.
 *   C2  the two distinct User-Agent identities this script drove (IP is
 *       constant — TRUSTED_PROXY_HOPS=0 in compose staging means the
 *       redirect trusts the socket IP, not X-Forwarded-For, and every
 *       request in this script comes from the same process/socket — so a
 *       UA change is what varies visitorHash's second input). Oracle:
 *       packages/domain/src/visitor.ts's documented inputs (ip, ua,
 *       linkId, salt) — read for STRUCTURE (which headers matter), not for
 *       the expected count, which is fixed by construction (M+1 clicks, 2
 *       uniques).
 *   C3  the exact (country, device, referrer) mix this script drove.
 *   C4  the count of bot-UA clicks driven (oracle for "excluded from
 *       rollup": apps/worker/src/jobs/rollup.ts's rollupClicks folds only
 *       `is_bot = false` rows into click_daily/breakdown_daily — read
 *       structurally to know WHERE to look, not to invent the expected
 *       number, which is "0 added to clicks/uniques" by construction).
 *   C5  the link's own {domain}/{slug} it was created with.
 *   C6  the valueMinor/currency/externalId this script sent.
 *   C7  docs/DECISIONS.md + scripts/smoke-redirect.sh, both read as the
 *       DECLARED rule for the query/UTM merge, never apps/redirect.
 *
 * Findings: .qa-runs/l4-semantic/findings.jsonl (steering §3, one line per
 * mismatch/observation worth recording). Summary: .qa-runs/l4-semantic/summary.md.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../..");
const RUN_DIR = resolve(REPO_ROOT, ".qa-runs/l4-semantic");
const ARTIFACTS_DIR = resolve(RUN_DIR, "artifacts");
const FINDINGS_PATH = resolve(RUN_DIR, "findings.jsonl");
const SUMMARY_PATH = resolve(RUN_DIR, "summary.md");

const API = process.env.API_BASE ?? "http://localhost:3001/api/v1";
const RD = process.env.RD_BASE ?? "http://localhost:3002";
const DB_URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5435/snapurl";
const LINK_DOMAIN = process.env.LINK_DOMAIN ?? "localhost:3002"; // must equal DEFAULT_DOMAIN, verified below

mkdirSync(ARTIFACTS_DIR, { recursive: true });
writeFileSync(FINDINGS_PATH, ""); // per-run report, not an accumulating log

// A realistic, non-bot desktop UA. BOT_PATTERN (packages/domain/src/visitor.ts)
// matches curl/wget/etc, so every "real visitor" click in this script uses one
// of the UAs below rather than fetch/undici defaults.
const UA_DESKTOP_1 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA_DESKTOP_2 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const UA_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";
const UA_BOT_GOOGLE = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const UA_BOT_CURL = "curl/8.5.0";

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
  severity_hint: "sev1" | "sev2" | "sev3" | "unknown";
  confidence: "high" | "medium" | "low";
  notes?: string;
}

function record(f: Finding) {
  appendFileSync(FINDINGS_PATH, JSON.stringify(f) + "\n");
  console.log(`  [finding] ${f.id}: ${f.title}`);
}

interface CheckRow {
  check: string;
  groundTruth: string;
  observed: string;
  match: boolean;
}
const checkRows: CheckRow[] = [];
const coverageGaps: string[] = [];
let rollupWaitSeconds: number | null = null;

function report(check: string, groundTruth: string, observed: string, match: boolean) {
  checkRows.push({ check, groundTruth, observed, match });
  console.log(`  [${match ? "MATCH" : "MISMATCH"}] ${check}: expected=${groundTruth} observed=${observed}`);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; body: any }> {
  // Only set Content-Type when there is actually a body: Fastify's JSON body
  // parser 400s on "Body cannot be empty when content-type is set to
  // 'application/json'" for a bodyless request (e.g. DELETE) that carries the
  // header anyway. Discovered when this harness's own cleanup DELETEs were
  // silently failing (fixture links kept accumulating in staging).
  const headers: Record<string, string> = { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** One redirect hit. Returns status + Location, without following it. */
async function hit(slug: string, headers: Record<string, string> = {}): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${RD}/${slug}`, { redirect: "manual", headers });
  return { status: res.status, location: res.headers.get("location") };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll `fn` until `pred(result)` is true or the budget expires. Returns the
 *  last result and how many seconds were actually spent waiting. Never
 *  fixed-sleeps: it checks immediately, then backs off geometrically up to a
 *  4s ceiling, per the brief's "poll, don't fixed-sleep" instruction and the
 *  documented ~90s worst-case worker rollup lag. */
async function pollUntil<T>(
  fn: () => Promise<T>,
  pred: (v: T) => boolean,
  budgetSeconds = 90,
): Promise<{ value: T; waitedSeconds: number }> {
  const start = Date.now();
  let delay = 1000;
  for (;;) {
    const value = await fn();
    if (pred(value)) return { value, waitedSeconds: (Date.now() - start) / 1000 };
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= budgetSeconds) return { value, waitedSeconds: elapsed };
    await sleep(delay);
    delay = Math.min(delay * 1.5, 4000);
  }
}

// ---------------------------------------------------------------------------
// Setup: health check, throwaway account, DB handle
// ---------------------------------------------------------------------------
async function main() {
  console.log("== L4 semantic e2e ==");
  console.log(`API=${API} RD=${RD} DB=${DB_URL.replace(/:[^:@]+@/, ":***@")}`);

  // Health first. If staging is down, STOP per the brief — do not substitute
  // fixtures or invent numbers.
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch((e) => {
    throw new Error(`API health check failed: ${e}`);
  });
  if (health.status !== "ok") {
    throw new Error(`API reports unhealthy: ${JSON.stringify(health)}`);
  }
  console.log(`  API healthy: ${JSON.stringify(health)}`);

  const rdProbe = await fetch(`${RD}/__l4-does-not-exist__`, { redirect: "manual" }).catch((e) => {
    throw new Error(`Redirect service unreachable: ${e}`);
  });
  console.log(`  Redirect reachable: HTTP ${rdProbe.status} on an unknown slug (expect 404)`);
  if (rdProbe.status !== 404) {
    coverageGaps.push(
      `Redirect health probe returned ${rdProbe.status} instead of the expected 404 for an unknown slug — noted, not treated as a hard stop.`,
    );
  }

  const sql = postgres(DB_URL, { max: 2 });
  try {
    const [{ one }] = await sql<{ one: number }[]>`select 1 as one`;
    console.log(`  Postgres reachable: select 1 -> ${one}`);
  } catch (e) {
    throw new Error(`Postgres unreachable at ${DB_URL}: ${e}`);
  }

  // Confirm the domain assumption this whole harness depends on: link
  // creation is only possible on the workspace's DEFAULT_DOMAIN system
  // domain (see scripts/smoke-redirect.sh's header). Read directly from the
  // domains table rather than assuming.
  const sysDomains = await sql<{ domain: string }[]>`select domain from domains where is_system = true`;
  console.log(`  System domain(s) in DB: ${sysDomains.map((d) => d.domain).join(", ")}`);
  if (!sysDomains.some((d) => d.domain === LINK_DOMAIN)) {
    coverageGaps.push(
      `Expected system domain "${LINK_DOMAIN}" not found among [${sysDomains.map((d) => d.domain).join(", ")}]. Link creation may fail; LINK_DOMAIN may need overriding.`,
    );
  }

  // Throwaway account for this run.
  const email = `l4-semantic-${Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
  const password = `L4-semantic-${randomBytes(8).toString("hex")}`;
  const reg = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "L4 Semantic Tester", email, password }),
  });
  if (reg.status !== 201 && reg.status !== 200) {
    throw new Error(`Registration failed: HTTP ${reg.status} ${JSON.stringify(reg.body)}`);
  }
  const token: string = reg.body.accessToken;
  if (!token) throw new Error(`No accessToken in register response: ${JSON.stringify(reg.body)}`);
  console.log(`  Registered throwaway account ${email}`);

  const createdLinkIds: string[] = [];
  async function mklink(input: Record<string, unknown>): Promise<{ id: string; slug: string; domain: string }> {
    const res = await api("/links", { method: "POST", body: JSON.stringify(input) }, token);
    if (res.status !== 201) throw new Error(`Link creation failed: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    createdLinkIds.push(res.body.id);
    return { id: res.body.id, slug: res.body.slug, domain: res.body.domain };
  }

  const RUN = `l4s${Date.now().toString(36)}`;

  try {
    await checkC1(sql, token, mklink, RUN);
    await checkC2(sql, mklink, RUN);
    await checkC3(sql, token, mklink, RUN);
    await checkC4(sql, token, mklink, RUN);
    await checkC5(mklink, RUN);
    await checkC6(token, mklink, RUN);
    await checkC7();
    await checkC8(sql, token, mklink, RUN);
  } finally {
    // Cleanup: delete every fixture link this run created, regardless of
    // outcome, so staging (a shared stack) is left tidy.
    for (const id of createdLinkIds) {
      await api(`/links/${id}`, { method: "DELETE" }, token).catch(() => {});
    }
    console.log(`  cleaned up ${createdLinkIds.length} fixture link(s)`);
    await sql.end();
  }

  writeSummary();
}

// ---------------------------------------------------------------------------
// C1 — click count is exact
// ---------------------------------------------------------------------------
async function checkC1(
  sql: postgres.Sql,
  token: string,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C1: click count is exact ==");
  const N = 7; // >= 7, deliberately not round
  const link = await mklink({
    destination: "https://example.com/c1",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c1`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  for (let i = 0; i < N; i++) {
    const r = await hit(link.slug, { "User-Agent": UA_DESKTOP_1 });
    if (r.status !== 302) {
      record({
        id: "c1-drive-click-not-302",
        layer: "semantic-e2e",
        title: `Driving click ${i + 1}/${N} on a fresh link did not return 302`,
        target: `GET ${RD}/${link.slug}`,
        what_i_did: `curl -H 'User-Agent: ${UA_DESKTOP_1}' -D - ${RD}/${link.slug} (attempt ${i + 1} of ${N})`,
        expected: "302, per scripts/smoke-redirect.sh's basic-redirect assertion for a freshly created link",
        observed: `HTTP ${r.status}, Location: ${r.location}`,
        evidence: [],
        repro: `curl -sD - -o /dev/null "${RD}/${link.slug}" -H 'User-Agent: ${UA_DESKTOP_1}'`,
        severity_hint: "sev2",
        confidence: "high",
      });
    }
  }

  const dbCount = async () => {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from click_events where link_id = ${link.id}`;
    return n;
  };
  const apiCount = async () => {
    const res = await api(`/analytics?linkId=${link.id}&range=24h`, {}, token);
    return res.body?.totals?.clicks as number | undefined;
  };

  // click_events is written synchronously on the redirect hot path (no
  // rollup needed for the raw-row count), so this should already be N.
  const rawCount = await dbCount();
  report("C1a raw click_events row count", String(N), String(rawCount), rawCount === N);
  if (rawCount !== N) {
    record({
      id: "c1-raw-row-count-mismatch",
      layer: "semantic-e2e",
      title: `click_events row count for a link driven exactly ${N} times does not equal ${N}`,
      target: "click_events (direct SQL)",
      what_i_did: `Created link ${link.id} (${link.slug}), drove exactly ${N} non-bot redirects with a fixed browser UA, then ran select count(*) from click_events where link_id = '${link.id}'.`,
      expected: `${N} — this script drove exactly ${N} redirects and click_events is written synchronously per docs/DECISIONS.md's description of the redirect hot path.`,
      observed: `${rawCount}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select count(*) from click_events where link_id = '${link.id}'"`,
      severity_hint: rawCount > N ? "sev1" : "sev2",
      confidence: "high",
    });
  }

  // Poll the API's rolled-up total until it reaches N or the budget expires.
  const { value: apiTotal, waitedSeconds } = await pollUntil(apiCount, (v) => v === N, 90);
  rollupWaitSeconds = waitedSeconds;
  report("C1b API analytics totals.clicks (after rollup poll)", String(N), String(apiTotal), apiTotal === N);
  if (apiTotal !== N) {
    record({
      id: "c1-api-rollup-count-mismatch",
      layer: "semantic-e2e",
      title: `GET /analytics totals.clicks does not equal ${N} after polling up to ${waitedSeconds.toFixed(1)}s`,
      target: `GET /analytics?linkId=${link.id}&range=24h`,
      what_i_did: `Drove exactly ${N} non-bot redirects on link ${link.id}, then polled GET /analytics?linkId=${link.id}&range=24h every ~1-4s for up to 90s.`,
      expected: `${N} — the exact count this script drove, and the value should equal the direct SQL row count (raw=${rawCount}).`,
      observed: `${apiTotal} after ${waitedSeconds.toFixed(1)}s of polling`,
      evidence: [],
      repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev1",
      confidence: "high",
      notes:
        apiTotal !== rawCount
          ? `API total (${apiTotal}) also disagrees with the direct SQL row count (${rawCount}) — recorded as its own signal per the brief's "if the API and the database disagree, that is its own finding".`
          : undefined,
    });
  }
  if (apiTotal !== rawCount) {
    record({
      id: "c1-api-db-disagree",
      layer: "semantic-e2e",
      title: "GET /analytics totals.clicks disagrees with the raw click_events row count",
      target: `GET /analytics?linkId=${link.id}&range=24h vs click_events`,
      what_i_did: `Compared API totals.clicks (${apiTotal}) against select count(*) from click_events where link_id = '${link.id}' (${rawCount}) for the same link after the rollup poll settled.`,
      expected: "Both readings equal, since the rollup only aggregates click_events for this link and no other clicks were driven on it.",
      observed: `API=${apiTotal}, DB=${rawCount}`,
      evidence: [],
      repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"; PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select count(*) from click_events where link_id = '${link.id}'"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// C2 — uniques vs clicks
// ---------------------------------------------------------------------------
async function checkC2(
  sql: postgres.Sql,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C2: uniques vs clicks ==");
  const M = 5; // clicks from visitor 1
  const link = await mklink({
    destination: "https://example.com/c2",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c2`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  // Visitor identity here derives from visitorHash(ip, ua, linkId, dailySalt)
  // (packages/domain/src/visitor.ts). TRUSTED_PROXY_HOPS defaults to 0 in
  // compose staging (apps/redirect/src/main.ts), so the redirect trusts the
  // socket IP over X-Forwarded-For — and every request in this script comes
  // from the same process, so IP is constant regardless of what XFF we send.
  // A distinct visitor is therefore produced by a distinct User-Agent, held
  // constant per "visitor" across their clicks.
  for (let i = 0; i < M; i++) {
    await hit(link.slug, { "User-Agent": UA_DESKTOP_1 }); // visitor A, M times
  }
  await hit(link.slug, { "User-Agent": UA_DESKTOP_2 }); // visitor B, once

  const expectedClicks = M + 1;
  const expectedUniques = 2;

  const rawCounts = async () => {
    const [row] = await sql<{ clicks: number; uniques: number }[]>`
      select count(*)::int as clicks, count(distinct visitor_hash)::int as uniques
      from click_events where link_id = ${link.id}
    `;
    return row;
  };

  const raw = await rawCounts();
  report("C2a raw click_events clicks", String(expectedClicks), String(raw.clicks), raw.clicks === expectedClicks);
  report("C2b raw click_events distinct visitor_hash", String(expectedUniques), String(raw.uniques), raw.uniques === expectedUniques);

  if (raw.clicks !== expectedClicks) {
    record({
      id: "c2-raw-click-count-mismatch",
      layer: "semantic-e2e",
      title: `click_events row count is not ${expectedClicks} (M+1) for a link driven by 2 visitor identities`,
      target: "click_events (direct SQL)",
      what_i_did: `Drove ${M} redirects with UA "${UA_DESKTOP_1}" and 1 redirect with UA "${UA_DESKTOP_2}" on link ${link.id}, then counted rows.`,
      expected: `${expectedClicks}`,
      observed: `${raw.clicks}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select count(*) from click_events where link_id = '${link.id}'"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }
  if (raw.uniques !== expectedUniques) {
    record({
      id: "c2-raw-unique-visitor-hash-mismatch",
      layer: "semantic-e2e",
      title: `distinct visitor_hash count is not ${expectedUniques} for 2 distinct User-Agent identities on the same link`,
      target: "click_events.visitor_hash (direct SQL)",
      what_i_did: `Drove ${M} redirects with one UA and 1 redirect with a different UA (same link, same IP by construction — TRUSTED_PROXY_HOPS=0), then ran select count(distinct visitor_hash) from click_events where link_id = '${link.id}'.`,
      expected: `${expectedUniques} — visitorHash's inputs are (dailySalt, ip, userAgent, linkId) per packages/domain/src/visitor.ts; ip and linkId and salt are constant here, so exactly 2 distinct UAs should yield exactly 2 distinct hashes.`,
      observed: `${raw.uniques}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select count(distinct visitor_hash) from click_events where link_id = '${link.id}'"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }

  // Poll the rollup-derived uniques (click_daily.uniques, HLL-estimated).
  const rollupUniques = async () => {
    const [row] = await sql<{ uniques: number; clicks: number }[]>`
      select coalesce(sum(uniques)::int, 0) as uniques, coalesce(sum(clicks)::int, 0) as clicks
      from click_daily where link_id = ${link.id}
    `;
    return row;
  };
  const { value: rolled, waitedSeconds } = await pollUntil(
    rollupUniques,
    (v) => v.clicks === expectedClicks,
    90,
  );
  report("C2c rolled-up click_daily.clicks", String(expectedClicks), String(rolled.clicks), rolled.clicks === expectedClicks);
  // HLL is an approximate estimator, but at cardinality 2 with p=14
  // (packages/domain/src/hll.ts) it should read exactly 2 — the error only
  // becomes material at much higher cardinalities. Treated as an exact
  // check here on purpose: this is the smallest possible case, so any
  // deviation is worth recording rather than excusing as "expected error".
  report("C2d rolled-up click_daily.uniques (HLL estimate)", String(expectedUniques), String(rolled.uniques), rolled.uniques === expectedUniques);
  if (rolled.uniques !== expectedUniques) {
    record({
      id: "c2-hll-uniques-mismatch",
      layer: "semantic-e2e",
      title: `click_daily.uniques (HLL estimate) is not ${expectedUniques} for exactly 2 distinct visitors`,
      target: "click_daily.uniques (direct SQL, after rollup)",
      what_i_did: `Drove ${expectedClicks} total clicks from exactly 2 distinct (ip, UA) identities on link ${link.id}, waited up to 90s (actual: ${waitedSeconds.toFixed(1)}s) for the rollup, then read sum(uniques) from click_daily for that link.`,
      expected: `${expectedUniques} — HLL at p=14 has ~0.8% standard error, negligible at cardinality 2; packages/domain/src/hll.ts's estimator should read exactly 2 for exactly 2 distinct inputs.`,
      observed: `${rolled.uniques}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select sum(uniques) from click_daily where link_id = '${link.id}'"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// C3 — breakdowns match the mix exactly
// ---------------------------------------------------------------------------
async function checkC3(
  sql: postgres.Sql,
  token: string,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C3: breakdowns match the mix exactly ==");
  const link = await mklink({
    destination: "https://example.com/c3",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c3`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  // Deliberately uneven mix: 4 IN, 2 US, 1 FR (matches the brief's example).
  // Country comes from CloudFront-Viewer-Country (apps/redirect/src/main.ts),
  // which is trusted verbatim in compose staging (no real CloudFront in
  // front — see scripts/smoke-redirect.sh's CAN_SPOOF_COUNTRY note).
  const plan: Array<{ country: string; ua: string; referer?: string }> = [
    { country: "IN", ua: UA_DESKTOP_1, referer: "https://news.example.com/a" },
    { country: "IN", ua: UA_DESKTOP_1, referer: "https://news.example.com/a" },
    { country: "IN", ua: UA_IOS, referer: "https://social.example.com/b" },
    { country: "IN", ua: UA_ANDROID },
    { country: "US", ua: UA_DESKTOP_2, referer: "https://news.example.com/a" },
    { country: "US", ua: UA_IOS },
    { country: "FR", ua: UA_DESKTOP_1 },
  ];
  const expectedTotal = plan.length; // 7
  const expectedCountries: Record<string, number> = { IN: 4, US: 2, FR: 1 };
  const expectedDevices: Record<string, number> = { desktop: 4, ios: 2, android: 1 };
  const expectedReferrers: Record<string, number> = { "news.example.com": 3, "social.example.com": 1 };
  // unset referer means Unknown in breakdown_daily terms (coalesce(...,'Unknown'))

  for (const step of plan) {
    const headers: Record<string, string> = {
      "User-Agent": step.ua,
      "CloudFront-Viewer-Country": step.country,
    };
    if (step.referer) headers.Referer = step.referer;
    await hit(link.slug, headers);
  }

  const apiBreakdowns = async () => {
    const res = await api(`/analytics?linkId=${link.id}&range=24h`, {}, token);
    return res.body as { totals?: { clicks: number }; countries?: any[]; devices?: any[]; referrers?: any[] } | undefined;
  };

  const { value: analytics, waitedSeconds } = await pollUntil(
    apiBreakdowns,
    (v) => (v?.totals?.clicks ?? 0) === expectedTotal,
    90,
  );

  report("C3a total clicks", String(expectedTotal), String(analytics?.totals?.clicks), analytics?.totals?.clicks === expectedTotal);

  function toMap(rows: any[] | undefined): Record<string, number> {
    const m: Record<string, number> = {};
    for (const r of rows ?? []) m[r.label] = r.value;
    return m;
  }

  // countries[] labels are full country names (analytics.service.ts's
  // COUNTRY_NAMES map), so compare by name — read structurally, not for the
  // expected count.
  const countryNameFor: Record<string, string> = { IN: "India", US: "United States", FR: "France" };
  const observedCountries = toMap(analytics?.countries);
  for (const [code, expected] of Object.entries(expectedCountries)) {
    const name = countryNameFor[code] ?? code;
    const observed = observedCountries[name] ?? 0;
    report(`C3b country ${code} (${name})`, String(expected), String(observed), observed === expected);
    if (observed !== expected) {
      record({
        id: `c3-country-${code.toLowerCase()}-mismatch`,
        layer: "semantic-e2e",
        title: `Country breakdown for ${code} does not match the driven mix`,
        target: `GET /analytics?linkId=${link.id}&range=24h .countries[]`,
        what_i_did: `Drove a mix of ${JSON.stringify(expectedCountries)} via CloudFront-Viewer-Country headers on link ${link.id}, then read .countries[] after polling for the rollup (${waitedSeconds.toFixed(1)}s).`,
        expected: `${expected} clicks labeled "${name}"`,
        observed: `${observed} (full countries[]: ${JSON.stringify(analytics?.countries)})`,
        evidence: [],
        repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
        severity_hint: "sev2",
        confidence: "high",
      });
    }
  }

  const observedDevices = toMap(analytics?.devices);
  for (const [dev, expected] of Object.entries(expectedDevices)) {
    const observed = observedDevices[dev] ?? 0;
    report(`C3c device ${dev}`, String(expected), String(observed), observed === expected);
    if (observed !== expected) {
      record({
        id: `c3-device-${dev}-mismatch`,
        layer: "semantic-e2e",
        title: `Device breakdown for "${dev}" does not match the driven mix`,
        target: `GET /analytics?linkId=${link.id}&range=24h .devices[]`,
        what_i_did: `Drove a mix of ${JSON.stringify(expectedDevices)} via distinct User-Agent strings on link ${link.id}.`,
        expected: `${expected} clicks labeled "${dev}"`,
        observed: `${observed} (full devices[]: ${JSON.stringify(analytics?.devices)})`,
        evidence: [],
        repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
        severity_hint: "sev2",
        confidence: "high",
      });
    }
  }

  const observedReferrers = toMap(analytics?.referrers);
  for (const [host, expected] of Object.entries(expectedReferrers)) {
    const observed = observedReferrers[host] ?? 0;
    report(`C3d referrer ${host}`, String(expected), String(observed), observed === expected);
    if (observed !== expected) {
      record({
        id: `c3-referrer-${host.replace(/\W+/g, "_")}-mismatch`,
        layer: "semantic-e2e",
        title: `Referrer breakdown for "${host}" does not match the driven mix`,
        target: `GET /analytics?linkId=${link.id}&range=24h .referrers[]`,
        what_i_did: `Drove clicks with Referer headers pointing at ${JSON.stringify(expectedReferrers)} on link ${link.id}.`,
        expected: `${expected} clicks labeled "${host}"`,
        observed: `${observed} (full referrers[]: ${JSON.stringify(analytics?.referrers)})`,
        evidence: [],
        repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
        severity_hint: "sev3",
        confidence: "medium",
      });
    }
  }

  // Breakdown totals should sum to the total click count — an invariant, not
  // a value derived from implementation (steering §1's "invariants that must
  // hold regardless of implementation").
  const countrySum = (analytics?.countries ?? []).reduce((s, r) => s + r.value, 0);
  report("C3e countries[] sum equals total clicks", String(analytics?.totals?.clicks ?? "?"), String(countrySum), countrySum === (analytics?.totals?.clicks ?? -1));
  if (countrySum !== (analytics?.totals?.clicks ?? -1)) {
    record({
      id: "c3-country-sum-not-equal-total",
      layer: "semantic-e2e",
      title: "Sum of countries[] values does not equal totals.clicks",
      target: `GET /analytics?linkId=${link.id}&range=24h`,
      what_i_did: `Summed .countries[].value and compared against .totals.clicks for the same response.`,
      expected: `sum(countries[].value) == totals.clicks (an invariant independent of implementation: every non-bot click has exactly one country label, even if "Unknown")`,
      observed: `sum=${countrySum}, totals.clicks=${analytics?.totals?.clicks}`,
      evidence: [],
      repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// C4 — bots are excluded from the rollup but recorded raw
// ---------------------------------------------------------------------------
async function checkC4(
  sql: postgres.Sql,
  token: string,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C4: bots are excluded from the rollup ==");
  const K = 3;
  const link = await mklink({
    destination: "https://example.com/c4",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c4`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  const botUas = [UA_BOT_GOOGLE, UA_BOT_CURL, "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"];
  for (let i = 0; i < K; i++) {
    await hit(link.slug, { "User-Agent": botUas[i % botUas.length] });
  }
  // One real click too, so the rollup has non-zero clicks to compare the
  // bot-exclusion against (an all-bot link rolling up to exactly 0 clicks
  // could otherwise be indistinguishable from "the rollup hasn't run yet").
  await hit(link.slug, { "User-Agent": UA_DESKTOP_1 });

  const rawIsBotCounts = async () => {
    const rows = await sql<{ is_bot: boolean; n: number }[]>`
      select is_bot, count(*)::int as n from click_events where link_id = ${link.id} group by is_bot
    `;
    const m: Record<string, number> = { true: 0, false: 0 };
    for (const r of rows) m[String(r.is_bot)] = r.n;
    return m;
  };
  const raw = await rawIsBotCounts();
  report("C4a click_events rows with is_bot=true", String(K), String(raw.true), raw.true === K);
  report("C4b click_events rows with is_bot=false", "1", String(raw.false), raw.false === 1);

  if (raw.true !== K) {
    record({
      id: "c4-raw-bot-rows-mismatch",
      layer: "semantic-e2e",
      title: `click_events does not have ${K} rows with is_bot=true for ${K} bot-UA clicks`,
      target: "click_events.is_bot (direct SQL)",
      what_i_did: `Drove ${K} redirects using common bot User-Agents (${botUas.join(", ")}) on link ${link.id}, then grouped click_events by is_bot.`,
      expected: `${K} rows with is_bot=true — the schema (packages/database/src/schema/analytics.ts) stores is_bot as a column rather than filtering at ingest, so a bot click should still be a raw row.`,
      observed: JSON.stringify(raw),
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select is_bot, count(*) from click_events where link_id = '${link.id}' group by is_bot"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }

  const rollupClicks = async () => {
    const [row] = await sql<{ clicks: number }[]>`select coalesce(sum(clicks)::int,0) as clicks from click_daily where link_id = ${link.id}`;
    return row.clicks;
  };
  const { value: rolledClicks, waitedSeconds } = await pollUntil(rollupClicks, (v) => v >= 1, 90);
  report("C4c click_daily.clicks excludes the bot clicks", "1", String(rolledClicks), rolledClicks === 1);
  if (rolledClicks !== 1) {
    record({
      id: "c4-rollup-includes-bots",
      layer: "semantic-e2e",
      title: `click_daily.clicks is ${rolledClicks}, not 1, after driving ${K} bot clicks + 1 real click`,
      target: "click_daily.clicks (direct SQL, after rollup)",
      what_i_did: `Drove ${K} bot-UA clicks and 1 real-UA click on link ${link.id}, waited up to 90s (actual: ${waitedSeconds.toFixed(1)}s) for the rollup, then read sum(clicks) from click_daily.`,
      expected: `1 — apps/worker/src/jobs/rollup.ts's rollupClicks folds only "is_bot = false and blocked_reason is null" rows into click_daily (read structurally to know where to check, not to invent this expectation: it follows from "bots are excluded" being the documented behavior this check exists to verify by construction).`,
      observed: `${rolledClicks}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select sum(clicks) from click_daily where link_id = '${link.id}'"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }

  // Cross-check via the API too, since the brief says a mismatch between two
  // surfaces is its own finding.
  const apiClicks = async () => {
    const res = await api(`/analytics?linkId=${link.id}&range=24h`, {}, token);
    return res.body?.totals?.clicks as number | undefined;
  };
  const apiVal = await apiClicks();
  report("C4d API totals.clicks excludes the bot clicks", "1", String(apiVal), apiVal === 1);
  if (apiVal !== rolledClicks) {
    record({
      id: "c4-api-db-disagree",
      layer: "semantic-e2e",
      title: "GET /analytics totals.clicks disagrees with click_daily.clicks for the bot-exclusion check",
      target: `GET /analytics?linkId=${link.id}&range=24h vs click_daily`,
      what_i_did: `Compared API totals.clicks (${apiVal}) against direct-SQL click_daily.clicks (${rolledClicks}) for link ${link.id}.`,
      expected: "Both equal 1 (the single non-bot click).",
      observed: `API=${apiVal}, DB=${rolledClicks}`,
      evidence: [],
      repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// C5 — QR encodes the right URL
// ---------------------------------------------------------------------------
async function checkC5(
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C5: QR encodes the right URL ==");
  const link = await mklink({
    destination: "https://example.com/c5",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c5`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  // The brief says "Generate a QR for a known link through the API". There
  // is no such API route: QR generation in this codebase is entirely
  // client-side (web/src/app/(app)/qr/page.tsx, web/src/components/qr/
  // qr-preview.tsx both import `qrcode` and call it in the browser; grep
  // across apps/api/src turns up zero QR routes/controllers, and the OpenAPI
  // document served at runtime has no qr-related path). Recorded as a
  // coverage gap per the brief's "if you cannot state one for a check, skip
  // it and record why" rather than inventing an endpoint or asserting
  // against a client bundle this harness cannot execute headlessly.
  coverageGaps.push(
    "C5 (QR encodes the right URL through the API): no such endpoint exists. " +
      "QR generation is client-side only (web/src/components/qr/qr-preview.tsx, " +
      "web/src/app/(app)/qr/page.tsx both call the `qrcode` npm package in the " +
      "browser from `https://{link.domain}/{link.slug}`; apps/api/src has zero " +
      "QR routes). To still exercise the real, shipped encoding logic rather " +
      "than skip outright, this run generates a QR using the SAME `qrcode` " +
      "package version pinned in web/package.json, decodes it with a real " +
      "decoder (jsQR), and asserts the decoded payload against the link's own " +
      "{domain}/{slug} — which is ground truth by construction. This is NOT " +
      "the same proof as driving it through a running API+UI, hence the gap.",
  );

  const value = `https://${link.domain}/${link.slug}`;
  const dataUrl: string = await QRCode.toDataURL(value, { errorCorrectionLevel: "Q", margin: 1, width: 512 });
  const base64 = dataUrl.split(",")[1];
  const pngBuffer = Buffer.from(base64, "base64");
  const artifactPath = resolve(ARTIFACTS_DIR, `c5-qr-${link.id}.png`);
  writeFileSync(artifactPath, pngBuffer);

  const png = PNG.sync.read(pngBuffer);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

  const observed = decoded?.data ?? "(failed to decode)";
  report("C5 QR decoded payload equals the link's short URL", value, observed, observed === value);
  if (observed !== value) {
    record({
      id: "c5-qr-decode-mismatch",
      layer: "semantic-e2e",
      title: "QR code decoded payload does not equal the link's own short URL",
      target: "qrcode npm package output, decoded with jsQR",
      what_i_did: `Generated a QR PNG for value "${value}" using the same 'qrcode' package version web/ ships, wrote it to ${artifactPath}, then decoded it with jsQR.`,
      expected: value,
      observed,
      evidence: [artifactPath],
      repro: `node -e "require('qrcode').toDataURL('${value}').then(console.log)"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// C6 — conversion attribution + idempotency
// ---------------------------------------------------------------------------
async function checkC6(
  token: string,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C6: conversion attribution ==");
  const link = await mklink({
    destination: "https://example.com/c6",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c6`,
    tags: [],
    redirectType: "302",
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  const valueMinor = 194900; // ₹1,949.00 — deliberately not round
  const currency = "INR"; // matches the workspace default (docs/DECISIONS.md G7); registration seeds no other currency
  const externalId = `l4-${randomUUID()}`;
  const name = `L4 semantic conversion ${RUN}`;

  const first = await api(
    "/conversions",
    { method: "POST", body: JSON.stringify({ linkId: link.id, kind: "sale", name, valueMinor, currency, externalId }) },
    token,
  );
  if (first.status !== 201) {
    record({
      id: "c6-record-conversion-failed",
      layer: "semantic-e2e",
      title: "POST /conversions returned a non-201 status for a well-formed sale",
      target: "POST /conversions",
      what_i_did: `POST /conversions with { linkId: '${link.id}', kind: 'sale', name: '${name}', valueMinor: ${valueMinor}, currency: '${currency}', externalId: '${externalId}' }`,
      expected: "201, per packages/contract/src/analytics.ts's RecordConversionResult / conversions.controller.ts's @HttpCode(201)",
      observed: `HTTP ${first.status}: ${JSON.stringify(first.body)}`,
      evidence: [],
      repro: `curl -s -X POST ${API}/conversions -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '${JSON.stringify({ linkId: link.id, kind: "sale", name, valueMinor, currency, externalId })}'`,
      severity_hint: "sev1",
      confidence: "high",
    });
    return;
  }
  report("C6a first record() returns recorded=true", "true", String(first.body?.recorded), first.body?.recorded === true);

  // Idempotency: same externalId again must not create a second row.
  const second = await api(
    "/conversions",
    { method: "POST", body: JSON.stringify({ linkId: link.id, kind: "sale", name, valueMinor, currency, externalId }) },
    token,
  );
  report("C6b duplicate externalId returns recorded=false", "false", String(second.body?.recorded), second.body?.recorded === false);
  if (second.status !== 201 || second.body?.recorded !== false) {
    record({
      id: "c6-idempotency-broken",
      layer: "semantic-e2e",
      title: "Recording a conversion twice with the same externalId did not report recorded=false on the second call",
      target: "POST /conversions (idempotency)",
      what_i_did: `POSTed the identical conversion body (same externalId="${externalId}") to /conversions twice in a row.`,
      expected: "Second call: recorded=false, per packages/contract/src/analytics.ts's RecordConversionResult doc comment (\"recorded is false when externalId matched an existing row\").",
      observed: `HTTP ${second.status}, body=${JSON.stringify(second.body)}`,
      evidence: [],
      repro: `for i in 1 2; do curl -s -X POST ${API}/conversions -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' -d '${JSON.stringify({ linkId: link.id, kind: "sale", name, valueMinor, currency, externalId })}'; done`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }

  // Poll the conversions report until the attributed link shows up, then
  // check the value/currency are unchanged and there's exactly one row (not
  // two) worth of revenue/signup attribution.
  const reportFor = async () => {
    const res = await api("/conversions?range=24h", {}, token);
    const rows = (res.body?.byLink ?? []) as Array<{ link: string; revenue: number; signups: number; clicks: number }>;
    return rows.find((r) => r.link === link.slug);
  };
  const { value: byLinkRow, waitedSeconds } = await pollUntil(reportFor, (v) => v !== undefined, 90);

  if (!byLinkRow) {
    record({
      id: "c6-not-attributed",
      layer: "semantic-e2e",
      title: `Conversion never appeared in the conversions report's byLink[] for slug "${link.slug}" after ${waitedSeconds.toFixed(1)}s`,
      target: "GET /conversions?range=24h .byLink[]",
      what_i_did: `Recorded a sale conversion (valueMinor=${valueMinor}, currency=${currency}) against link ${link.id}/${link.slug}, then polled GET /conversions?range=24h for up to 90s looking for byLink[].link === "${link.slug}".`,
      expected: `A byLink[] row for "${link.slug}"`,
      observed: `No matching row after ${waitedSeconds.toFixed(1)}s. Full byLink: (see repro)`,
      evidence: [],
      repro: `curl -s "${API}/conversions?range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev1",
      confidence: "high",
    });
    report("C6c conversion attributed to the correct link", link.slug, "not found", false);
    return;
  }
  report("C6c conversion attributed to the correct link", link.slug, byLinkRow.link, byLinkRow.link === link.slug);

  const expectedRevenueMajor = valueMinor / 100;
  report("C6d revenue value unchanged (major units)", String(expectedRevenueMajor), String(byLinkRow.revenue), byLinkRow.revenue === expectedRevenueMajor);
  if (byLinkRow.revenue !== expectedRevenueMajor) {
    record({
      id: "c6-revenue-value-mismatch",
      layer: "semantic-e2e",
      title: "byLink[].revenue does not equal the recorded valueMinor converted to major units",
      target: "GET /conversions?range=24h .byLink[].revenue",
      what_i_did: `Recorded valueMinor=${valueMinor} (${currency}) as a sale for link ${link.slug}, then read byLink[].revenue for that link after it appeared in the report.`,
      expected: `${expectedRevenueMajor} (valueMinor / 100, per packages/contract/src/analytics.ts's doc comment: "1999 is ₹19.99, never 19.99")`,
      observed: `${byLinkRow.revenue}`,
      evidence: [],
      repro: `curl -s "${API}/conversions?range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }

  // Currency: the report states ONE currency for the whole workspace
  // (docs/DECISIONS.md G7), read from the top-level `currency` field, not
  // per-row. Assert it matches what was sent (workspace default is INR for a
  // freshly registered account, and this script explicitly sent "INR").
  const fullReport = await api("/conversions?range=24h", {}, token);
  report("C6e report currency unchanged", currency, String(fullReport.body?.currency), fullReport.body?.currency === currency);
  if (fullReport.body?.currency !== currency) {
    record({
      id: "c6-currency-mismatch",
      layer: "semantic-e2e",
      title: "Conversions report currency does not match the currency this script recorded the sale in",
      target: "GET /conversions?range=24h .currency",
      what_i_did: `Recorded a sale in currency "${currency}" (a freshly registered workspace's own default, per docs/DECISIONS.md G7), then read the report's top-level .currency field.`,
      expected: currency,
      observed: String(fullReport.body?.currency),
      evidence: [],
      repro: `curl -s "${API}/conversions?range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }

  // Idempotency at the money level: exactly one sale's worth of revenue, not
  // two, despite having POSTed the conversion twice.
  report(
    "C6f revenue reflects exactly one sale despite 2 POSTs with same externalId",
    String(expectedRevenueMajor),
    String(byLinkRow.revenue),
    byLinkRow.revenue === expectedRevenueMajor,
  );
}

// ---------------------------------------------------------------------------
// C7 — query/UTM merge on redirect (oracle: DECISIONS.md + smoke-redirect.sh,
// never apps/redirect's implementation)
// ---------------------------------------------------------------------------
async function checkC7() {
  console.log("\n== C7: query/UTM merge on redirect ==");

  // Oracle, read verbatim from the two files the brief names — NOT from
  // apps/redirect/src/main.ts. scripts/smoke-redirect.sh (read earlier in
  // this session, verbatim, not paraphrased into a guess) asserts:
  //   - a plain link's stored destination has the visitor's query string
  //     appended ("query string is forwarded" — expects "a=1" in the
  //     Location for ?a=1)
  //   - forwardQuery=false drops the click-time query entirely
  //   - a link created with a stored UTM object has that UTM appended when
  //     no click-time utm_source is given ("stored UTM is appended" —
  //     expects "utm_source=newsletter")
  //   - when the visitor's OWN query string carries utm_source, that value
  //     WINS over the stored one ("click-time UTM wins over stored" —
  //     expects "utm_source=twitter" when the link's stored utm.source is
  //     "newsletter" and the click is `?utm_source=twitter`)
  // docs/DECISIONS.md does not separately re-state this merge rule beyond
  // what smoke-redirect.sh already encodes as an executable oracle, so this
  // check reconstructs exactly those three assertions with its own fixture
  // link rather than importing/running that script (the brief says this
  // layer "adds a new harness" and must not modify or drive existing test
  // scripts as if they were this layer's own checks).
  const RUN = `l4s${Date.now().toString(36)}c7`;

  const email = `l4-c7-${Date.now()}-${randomBytes(4).toString("hex")}@example.com`;
  const password = `L4-semantic-${randomBytes(8).toString("hex")}`;
  const reg = await api("/auth/register", { method: "POST", body: JSON.stringify({ name: "L4 C7 Tester", email, password }) });
  const token = reg.body?.accessToken;
  if (!token) {
    coverageGaps.push(`C7: could not register a fresh account for the UTM-merge check (HTTP ${reg.status}): ${JSON.stringify(reg.body)}`);
    return;
  }

  const createRes = await api(
    "/links",
    {
      method: "POST",
      body: JSON.stringify({
        destination: "https://example.com/c7",
        domain: LINK_DOMAIN,
        slug: `${RUN}-utm`,
        tags: [],
        redirectType: "302",
        rules: [],
        forwardQuery: true,
        deepLink: false,
        hideReferrer: false,
        publicPreview: true,
        utm: { source: "newsletter", campaign: "spring" },
      }),
    },
    token,
  );
  if (createRes.status !== 201) {
    coverageGaps.push(`C7: link creation failed (HTTP ${createRes.status}): ${JSON.stringify(createRes.body)}`);
    return;
  }
  const link = { id: createRes.body.id, slug: createRes.body.slug };

  const createNoForward = await api(
    "/links",
    {
      method: "POST",
      body: JSON.stringify({
        destination: "https://example.com/c7-noforward",
        domain: LINK_DOMAIN,
        slug: `${RUN}-noforward`,
        tags: [],
        redirectType: "302",
        rules: [],
        forwardQuery: false,
        deepLink: false,
        hideReferrer: false,
        publicPreview: true,
      }),
    },
    token,
  );
  const noForwardLink = { id: createNoForward.body?.id, slug: createNoForward.body?.slug };

  try {
    // 1. query string is forwarded
    const r1 = await hit(link.slug, {});
    const res1 = await fetch(`${RD}/${link.slug}?a=1`, { redirect: "manual" });
    const loc1 = res1.headers.get("location") ?? "";
    report("C7a query string forwarded (?a=1 present in Location)", "contains a=1", loc1, loc1.includes("a=1"));
    if (!loc1.includes("a=1")) {
      record({
        id: "c7-query-not-forwarded",
        layer: "semantic-e2e",
        title: "A forwardQuery=true link's click-time query string is not appended to the Location",
        target: `GET ${RD}/${link.slug}?a=1`,
        what_i_did: `Created a link with forwardQuery=true and destination https://example.com/c7, then requested ${RD}/${link.slug}?a=1.`,
        expected: 'Location contains "a=1" — oracle: scripts/smoke-redirect.sh\'s "query string is forwarded" assertion.',
        observed: loc1,
        evidence: [],
        repro: `curl -sI "${RD}/${link.slug}?a=1"`,
        severity_hint: "sev1",
        confidence: "high",
      });
    }

    // 2. forwardQuery=false drops it
    if (noForwardLink.slug) {
      const res2 = await fetch(`${RD}/${noForwardLink.slug}?a=1`, { redirect: "manual" });
      const loc2 = res2.headers.get("location") ?? "";
      const expected2 = "https://example.com/c7-noforward";
      report("C7b forwardQuery=false drops the query", expected2, loc2, loc2 === expected2);
      if (loc2 !== expected2) {
        record({
          id: "c7-forwardquery-false-not-dropped",
          layer: "semantic-e2e",
          title: "forwardQuery=false did not drop the click-time query string",
          target: `GET ${RD}/${noForwardLink.slug}?a=1`,
          what_i_did: `Created a link with forwardQuery=false and destination https://example.com/c7-noforward, then requested ${RD}/${noForwardLink.slug}?a=1.`,
          expected: `Location == "${expected2}" exactly — oracle: scripts/smoke-redirect.sh's "forwardQuery=false drops it" assertion.`,
          observed: loc2,
          evidence: [],
          repro: `curl -sI "${RD}/${noForwardLink.slug}?a=1"`,
          severity_hint: "sev2",
          confidence: "high",
        });
      }
    } else {
      coverageGaps.push("C7b (forwardQuery=false) skipped: the no-forward fixture link failed to create.");
    }

    // 3. stored UTM is appended when no click-time UTM given
    const res3 = await fetch(`${RD}/${link.slug}`, { redirect: "manual" });
    const loc3 = res3.headers.get("location") ?? "";
    report("C7c stored UTM appended (utm_source=newsletter)", "contains utm_source=newsletter", loc3, loc3.includes("utm_source=newsletter"));
    if (!loc3.includes("utm_source=newsletter")) {
      record({
        id: "c7-stored-utm-not-appended",
        layer: "semantic-e2e",
        title: "A link's stored UTM parameters are not appended when the visitor sends none",
        target: `GET ${RD}/${link.slug}`,
        what_i_did: `Created a link with utm.source="newsletter", utm.campaign="spring", then requested ${RD}/${link.slug} with no query string.`,
        expected: 'Location contains "utm_source=newsletter" — oracle: scripts/smoke-redirect.sh\'s "stored UTM is appended" assertion.',
        observed: loc3,
        evidence: [],
        repro: `curl -sI "${RD}/${link.slug}"`,
        severity_hint: "sev1",
        confidence: "high",
      });
    }

    // 4. click-time UTM wins over stored
    const res4 = await fetch(`${RD}/${link.slug}?utm_source=twitter`, { redirect: "manual" });
    const loc4 = res4.headers.get("location") ?? "";
    report("C7d click-time UTM wins over stored (utm_source=twitter)", "contains utm_source=twitter, not newsletter", loc4, loc4.includes("utm_source=twitter") && !loc4.includes("utm_source=newsletter"));
    if (!(loc4.includes("utm_source=twitter") && !loc4.includes("utm_source=newsletter"))) {
      record({
        id: "c7-clicktime-utm-does-not-win",
        layer: "semantic-e2e",
        title: "Click-time utm_source does not win over the link's stored utm_source",
        target: `GET ${RD}/${link.slug}?utm_source=twitter`,
        what_i_did: `Requested ${RD}/${link.slug}?utm_source=twitter on a link whose stored utm.source is "newsletter".`,
        expected: 'Location contains "utm_source=twitter" and does NOT contain "utm_source=newsletter" — oracle: scripts/smoke-redirect.sh\'s "click-time UTM wins over stored" assertion.',
        observed: loc4,
        evidence: [],
        repro: `curl -sI "${RD}/${link.slug}?utm_source=twitter"`,
        severity_hint: "sev1",
        confidence: "high",
      });
    }
    void r1; // silence unused; r1 was a warm-up hit before the ?a=1 assertion
  } finally {
    await api(`/links/${link.id}`, { method: "DELETE" }, token).catch(() => {});
    if (noForwardLink.id) await api(`/links/${noForwardLink.id}`, { method: "DELETE" }, token).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// C8 — click-limit gate blocks visitors past the cap (extra check, beyond the
// brief's C1-C7, added because a first pass came back with zero mismatches
// and steering §2 treats that as a signal to test harder, not a clean bill
// of health).
// ---------------------------------------------------------------------------
async function checkC8(
  sql: postgres.Sql,
  token: string,
  mklink: (input: Record<string, unknown>) => Promise<{ id: string; slug: string; domain: string }>,
  RUN: string,
) {
  console.log("\n== C8: click-limit gate ==");
  const LIMIT = 3;
  const link = await mklink({
    destination: "https://example.com/c8",
    domain: LINK_DOMAIN,
    slug: `${RUN}-c8`,
    tags: [],
    redirectType: "302",
    rules: [],
    clickLimit: LIMIT,
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
  });

  // gateFor() (apps/redirect/src/main.ts, read structurally to confirm the
  // gate exists and what it reads — link_counters via the resolver, not
  // click_events — never to invent the expected numbers) compares
  // link.clicks (the LAST ROLLUP's linkCounters value) against clickLimit.
  // So the first LIMIT clicks must succeed (linkCounters starts at 0), and
  // only once the rollup has folded them in does the gate see clicks >=
  // LIMIT and start blocking. This is exactly the "may overshoot slightly"
  // behavior docs/DECISIONS.md's Assumption 8 documents, read here for
  // structure (why we must wait for a rollup before the (LIMIT+1)th hit),
  // not for the expected outcome, which is fixed by construction: exactly
  // LIMIT clicks succeed, and clicks after the rollup catches up are 410s.
  for (let i = 0; i < LIMIT; i++) {
    const r = await hit(link.slug, { "User-Agent": UA_DESKTOP_1 });
    if (r.status !== 302) {
      record({
        id: `c8-click-${i + 1}-not-302`,
        layer: "semantic-e2e",
        title: `Click ${i + 1}/${LIMIT} (within the click limit) did not return 302`,
        target: `GET ${RD}/${link.slug}`,
        what_i_did: `Created a link with clickLimit=${LIMIT}, drove click ${i + 1} of ${LIMIT}.`,
        expected: "302 — within the limit, linkCounters.clicks has not yet reached clickLimit.",
        observed: `HTTP ${r.status}, Location: ${r.location}`,
        evidence: [],
        repro: `curl -sD - -o /dev/null "${RD}/${link.slug}" -H 'User-Agent: ${UA_DESKTOP_1}'`,
        severity_hint: "sev2",
        confidence: "high",
      });
    }
  }

  // Wait for the rollup to fold these into link_counters so the gate can see
  // the cap has been reached.
  const counterClicks = async () => {
    const [row] = await sql<{ clicks: number | null }[]>`select clicks from link_counters where link_id = ${link.id}`;
    return row?.clicks ?? 0;
  };
  const { value: counted, waitedSeconds } = await pollUntil(counterClicks, (v) => v >= LIMIT, 90);
  report("C8a link_counters.clicks reaches the limit after rollup", String(LIMIT), String(counted), counted >= LIMIT);
  if (counted < LIMIT) {
    record({
      id: "c8-counter-never-reached-limit",
      layer: "semantic-e2e",
      title: `link_counters.clicks never reached the configured clickLimit (${LIMIT}) after ${waitedSeconds.toFixed(1)}s`,
      target: "link_counters (direct SQL, after rollup)",
      what_i_did: `Drove exactly ${LIMIT} clicks on a link with clickLimit=${LIMIT}, then polled link_counters.clicks for up to 90s.`,
      expected: `>= ${LIMIT}`,
      observed: `${counted} after ${waitedSeconds.toFixed(1)}s`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select clicks from link_counters where link_id = '${link.id}'"`,
      severity_hint: "sev1",
      confidence: "high",
    });
    return; // no point asserting the gate if the precondition never held
  }

  // The LINK_CACHE_TTL_SECONDS resolver cache (apps/redirect/src/caching-
  // resolver.ts) is 10s by default; polling for the rollup above already
  // took at least one 30s rollup cycle, so any prior cache entry for this
  // brand-new link has long since expired. The next hit re-resolves and
  // should see the fresh, over-limit counter.
  const over = await hit(link.slug, { "User-Agent": UA_DESKTOP_1 });
  report("C8b click past the limit is blocked (410)", "410", String(over.status), over.status === 410);
  if (over.status !== 410) {
    record({
      id: "c8-limit-not-enforced",
      layer: "semantic-e2e",
      title: `A click past the configured clickLimit (${LIMIT}) did not return 410`,
      target: `GET ${RD}/${link.slug}`,
      what_i_did: `Created a link with clickLimit=${LIMIT}, drove exactly ${LIMIT} clicks, waited for the rollup to fold them into link_counters (confirmed clicks=${counted}), then drove one more click.`,
      expected: "410, per apps/redirect/src/main.ts's gateFor() returning \"click_limit\" once link.clicks >= clickLimit, and the 410 body \"This link has reached its click limit.\"",
      observed: `HTTP ${over.status}, Location: ${over.location}`,
      evidence: [],
      repro: `curl -sD - -o /dev/null "${RD}/${link.slug}" -H 'User-Agent: ${UA_DESKTOP_1}'`,
      severity_hint: "sev1",
      confidence: "high",
    });
  }

  // Blocked clicks are still recorded as raw rows (per the code comment at
  // the call site, read structurally) — assert the raw blocked_reason column
  // directly, an independent surface from the redirect's own HTTP response.
  const blockedRaw = async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from click_events where link_id = ${link.id} and blocked_reason = 'click_limit'
    `;
    return row.n;
  };
  const blockedCount = await blockedRaw();
  report("C8c click_events.blocked_reason='click_limit' for the over-limit click", "1", String(blockedCount), blockedCount === 1);
  if (blockedCount !== 1) {
    record({
      id: "c8-blocked-reason-not-recorded",
      layer: "semantic-e2e",
      title: "The over-limit click was not recorded with blocked_reason='click_limit' in click_events",
      target: "click_events.blocked_reason (direct SQL)",
      what_i_did: `After confirming the (${LIMIT + 1})th click on link ${link.id} returned HTTP ${over.status}, queried click_events for rows with blocked_reason='click_limit'.`,
      expected: "1",
      observed: `${blockedCount}`,
      evidence: [],
      repro: `PGPASSWORD=snapurl psql -h localhost -p 5435 -U snapurl -d snapurl -c "select count(*) from click_events where link_id = '${link.id}' and blocked_reason = 'click_limit'"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }

  // Cross-surface: analytics totals.blocked should reflect it too, after the
  // rollup catches this new row up (rollupClicks counts blocked_reason is
  // not null into click_daily.blocked).
  const analyticsBlocked = async () => {
    const res = await api(`/analytics?linkId=${link.id}&range=24h`, {}, token);
    return res.body?.totals?.blocked as number | undefined;
  };
  const { value: apiBlocked, waitedSeconds: waited2 } = await pollUntil(analyticsBlocked, (v) => v === 1, 90);
  report("C8d API totals.blocked reflects the click-limit block", "1", String(apiBlocked), apiBlocked === 1);
  if (apiBlocked !== 1) {
    record({
      id: "c8-api-blocked-total-mismatch",
      layer: "semantic-e2e",
      title: `GET /analytics totals.blocked is not 1 after the click-limit block, waited ${waited2.toFixed(1)}s`,
      target: `GET /analytics?linkId=${link.id}&range=24h`,
      what_i_did: `After the over-limit click was confirmed blocked at the redirect (410) and recorded in click_events (blocked_reason='click_limit', count=${blockedCount}), polled GET /analytics?linkId=${link.id}&range=24h for totals.blocked.`,
      expected: "1",
      observed: `${apiBlocked} after ${waited2.toFixed(1)}s`,
      evidence: [],
      repro: `curl -s "${API}/analytics?linkId=${link.id}&range=24h" -H "Authorization: Bearer <token>"`,
      severity_hint: "sev2",
      confidence: "high",
    });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
function writeSummary() {
  const mismatches = checkRows.filter((r) => !r.match).length;
  const lines: string[] = [];
  lines.push("# L4 semantic e2e — summary");
  lines.push("");
  lines.push(`Run at ${new Date().toISOString()}. API=${API} RD=${RD}`);
  lines.push(`Rollup wait actually needed (C1's poll): ${rollupWaitSeconds !== null ? `${rollupWaitSeconds.toFixed(1)}s` : "n/a"}`);
  lines.push("");
  lines.push(`**${checkRows.length} assertions run, ${mismatches} mismatch(es).**`);
  lines.push("");
  lines.push("Per steering §2, zero findings/mismatches is treated as a failed run (assertions were too weak), not a clean bill of health.");
  lines.push("");
  lines.push("| check | ground truth constructed | observed | match? |");
  lines.push("|---|---|---|---|");
  for (const r of checkRows) {
    lines.push(`| ${r.check} | ${r.groundTruth} | ${escapeMd(r.observed)} | ${r.match ? "✅" : "❌"} |`);
  }
  lines.push("");
  lines.push("## Harness note (not a product finding)");
  lines.push("");
  lines.push(
    "An earlier version of this run's own cleanup DELETE calls set " +
      "`Content-Type: application/json` on every request, including the bodyless " +
      "`DELETE /links/:id` cleanup call. Fastify's JSON body parser rejects that combination " +
      "with 400 (\"Body cannot be empty when content-type is set to 'application/json'\"), " +
      "so cleanup silently failed and fixture links accumulated in the shared staging " +
      "database across runs (confirmed by direct SQL, then fixed in this harness's `api()` " +
      "helper to only set Content-Type when a body is actually present). Leftover fixtures " +
      "from that period were removed by hand via `delete from links where slug like 'l4s%'` " +
      "before the run this summary reflects. Recorded here for transparency since it could " +
      "otherwise look like this layer left junk behind — it is a harness bug, not a product " +
      "behavior finding, so it is not in findings.jsonl.",
  );
  lines.push("");
  lines.push("## Coverage gaps");
  lines.push("");
  if (coverageGaps.length === 0) {
    lines.push("(none recorded)");
  } else {
    for (const g of coverageGaps) lines.push(`- ${g}`);
  }
  lines.push("");
  lines.push(
    "- A/B weighted routing (packages/domain/src/routing.ts's pickWeighted) was not " +
      "checked: it needs a statistical assertion (thousands of clicks, a tolerance band " +
      "on the observed split) rather than an exact-value oracle, which is a different " +
      "shape of check than this layer's \"drive N, expect exactly N\" checks. Left for a " +
      "dedicated statistical/property-based pass rather than a loose in-line assertion here.",
  );
  lines.push(
    "- Password-protected-link unlock tokens, scheduled/expired-link fallback routing, and " +
      "deep-link intent URLs are exercised for STATUS CODES and Location headers by " +
      "scripts/smoke-redirect.sh already; this layer did not re-derive independent value " +
      "oracles for them (no analytics/conversion VALUE rides on those paths beyond what " +
      "C1-C4 already cover for a plain link), so they were left to that existing smoke " +
      "suite rather than duplicated here.",
  );
  lines.push(
    "- City-level breakdown (contract's Analytics.cities[] with its k-anonymity floor, " +
      "CITY_MIN_CLICKS=5 in analytics.service.ts) was not driven: doing so honestly needs " +
      "at least 5 clicks in one city to clear the floor and a separate small-city mix to " +
      "prove the fold into \"Other cities\", which is a second full C3-shaped check this " +
      "run did not have a remaining check slot for. Recorded here rather than asserted " +
      "loosely.",
  );
  writeFileSync(SUMMARY_PATH, lines.join("\n") + "\n");
  console.log(`\nWrote ${SUMMARY_PATH}`);
  console.log(`Wrote ${FINDINGS_PATH}`);
  console.log(`\n${checkRows.length} assertions run, ${mismatches} mismatch(es).`);
}

function escapeMd(s: string): string {
  return String(s).replace(/\|/g, "\\|").slice(0, 300);
}

main().catch((err) => {
  console.error("FATAL:", err);
  writeSummary();
  process.exit(1);
});
