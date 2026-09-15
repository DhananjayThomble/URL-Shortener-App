import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/* ============================================================
   API-driven idempotent seeder for the real-stack e2e suite.

   Context: issue #421 — 24 of 27 failing real-stack tests fail because they
   assert on entities that exist only in web/src/lib/api/fixtures.ts. A freshly
   registered real workspace is empty, so assertions on specific slugs, members,
   forms, bio pages, reports and conversions cannot resolve.

   This module is the Playwright globalSetup for playwright.real.config.ts. It:
     1. Registers (or reuses) ONE shared workspace for the whole test run.
     2. Creates — through the real API — the entities the specs assert on.
     3. Writes the seed state (tokens + entity IDs) to SEED_STATE_FILE so that
        real-session.ts can reuse the same workspace instead of always creating
        a fresh, empty one.
     4. Is idempotent: running twice against the same workspace does not create
        duplicates or fail.

   Narrowing rule (issue after first seeding attempt): "seed only what specs READ;
   never what they WRITE." Violations cause regressions:
   - Bio pages: bio.spec.ts writes its own page, so we must NOT pre-seed one.
     The editor auto-selects pages[0]; a seeded page in slot 0 causes the spec's
     "Publish" click to target the wrong page.
   - Importer "skip" test: relies on spring-sale being "already taken" on whatever
     domain the import panel defaults to. We seed spring-sale UNSUFFIXED on the
     workspace's default domain (localhost:3002) so it is always taken there.
     We also clean up stale verifying custom domains left by domains.spec parallel
     runs, so localhost:3002 stays as domains[0] and the import panel default.

   Oracles:
   - Entity shapes: packages/contract/src/* (declared payload truth).
   - Entity literals: web/src/lib/api/fixtures.ts (defines what specs assert on).
   - Member name behaviour: apps/api/src/members/members.service.ts
     GET /members returns user?.name ?? email. To get "Arjun Kapoor" we must
     first register a real user with name "Arjun Kapoor", THEN invite that email
     into the workspace — the list join picks up the user row's name.
   - Form slugs: global namespace. We suffix with a run-specific token stored in
     the seed state to avoid collisions on a shared staging DB.
   - Conversion events: POST /conversions is idempotent via externalId.

   Nothing secret is committed. Credentials are generated at runtime.
   ============================================================ */

const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";
const RUN_DIR = process.env.QA_RUN_DIR ?? path.resolve(__dirname, "../../.qa-runs/real-stack");

/** Where the shared workspace tokens + entity IDs are persisted. */
export const SEED_STATE_FILE = path.join(RUN_DIR, "seed-state.json");

export interface SeedState {
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
  workspaceId: string;
  /** Default domain for this workspace (e.g. "localhost:3002"). */
  domain: string;
  /** Actual IDs returned by the API for seeded links. */
  linkIds: Record<string, string>;
  /** Actual IDs + slugs for seeded forms. */
  formIds: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Low-level API helpers
// ---------------------------------------------------------------------------

async function req(
  method: string,
  urlPath: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function apiPost(urlPath: string, body: unknown, token?: string): Promise<unknown> {
  const { status, body: resBody } = await req("POST", urlPath, body, token);
  if (status === 409) return null; // Conflict — already exists, caller handles
  if (status >= 400) {
    throw new Error(`POST ${API_URL}${urlPath} → ${status}: ${JSON.stringify(resBody).slice(0, 400)}`);
  }
  return resBody;
}

async function apiPut(urlPath: string, body: unknown, token: string): Promise<unknown> {
  const { status, body: resBody } = await req("PUT", urlPath, body, token);
  if (status >= 400) throw new Error(`PUT ${API_URL}${urlPath} → ${status}: ${JSON.stringify(resBody).slice(0, 400)}`);
  return resBody;
}

async function apiPatch(urlPath: string, body: unknown, token: string): Promise<unknown> {
  const { status, body: resBody } = await req("PATCH", urlPath, body, token);
  if (status >= 400) throw new Error(`PATCH ${API_URL}${urlPath} → ${status}: ${JSON.stringify(resBody).slice(0, 400)}`);
  return resBody;
}

async function apiGet(urlPath: string, token: string): Promise<unknown> {
  const { status, body: resBody } = await req("GET", urlPath, undefined, token);
  if (status >= 400) throw new Error(`GET ${API_URL}${urlPath} → ${status}: ${JSON.stringify(resBody).slice(0, 400)}`);
  return resBody;
}

// ---------------------------------------------------------------------------
// Step 1 — Register / reuse shared workspace
// ---------------------------------------------------------------------------

async function registerAccount(name: string, email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
  const result = await apiPost("/auth/register", { name, email, password }) as { accessToken: string; refreshToken: string } | null;
  if (!result) {
    // 409 — already registered, try login
    const loginResult = await apiPost("/auth/login", { email, password }) as { accessToken: string; refreshToken: string } | null;
    if (!loginResult?.accessToken) throw new Error(`seed: could not register or login as ${email}`);
    return loginResult;
  }
  if (!result.accessToken) throw new Error(`seed: register returned no token for ${email}`);
  return result;
}

// ---------------------------------------------------------------------------
// Step 2 — Links
//
// Spec assertions requiring specific slugs:
//   spring-sale  → reports.spec.ts (aria-labels hardcode "Mark report on /spring-sale reviewed"
//                  and "Flag the link for report on /spring-sale"); also importers "skip" test
//                  (needs spring-sale to be "already taken" on the import panel's default domain).
//   app          → reports.spec.ts (aria-label "Dismiss report on /app")
//   webinar-q3   → topbar-search.spec.ts (asserts /webinar-q3/ slug in listbox)
//
// Narrowing rule: specs that READ slugs get exact slugs. Specs that WRITE entities
// to the workspace get no help from the seeder.
//
// "spring-sale" and "app" are seeded WITHOUT workspace-prefix so the slug names match
// the hardcoded aria-labels in reports.spec.ts exactly. They are created on the
// workspace's default domain (localhost:3002); being on that domain also ensures
// they are "already taken" when the importers "skip" test tries to import them.
//
// Additional links for QR (first link → QR preview), conversions (utm.campaign),
// and full list; these use a workspace prefix to avoid collisions.
// ---------------------------------------------------------------------------

interface LinkSeed {
  slug: string;
  destination: string;
  title: string;
  suffixed?: boolean; // default true; false = seed without workspace prefix
  utm?: { source?: string; medium?: string; campaign?: string };
}

const LINK_SEEDS: LinkSeed[] = [
  // Unseeded (exact slug required by specs):
  { slug: "spring-sale", suffixed: false, destination: "https://acme.com/collections/spring-2026", title: "Spring Sale 2026",
    utm: { source: "instagram", medium: "social", campaign: "Spring 2026" } },
  { slug: "app",         suffixed: false, destination: "https://apps.apple.com/acme/download",      title: "Download the Acme app" },
  // Suffixed (topbar-search needs /webinar-q3/ regex match, accepts suffix):
  { slug: "demo",          destination: "https://calendly.com/acme/demo?team=sales",  title: "Book a demo" },
  { slug: "pricing",       destination: "https://acme.com/pricing",                   title: "Pricing" },
  { slug: "beta-invite",   destination: "https://acme.com/beta/signup",              title: "Private beta invite" },
  { slug: "spring-launch", destination: "https://acme.com/spring",                    title: "Spring launch" },
  { slug: "webinar-q3",    destination: "https://acme.com/events/q3-webinar",         title: "Q3 webinar" },
];

async function seedLinks(token: string, domain: string, existing: Record<string, string>, wsPrefix: string): Promise<Record<string, string>> {
  const ids: Record<string, string> = { ...existing };

  ids["__slug_suffix__"] = wsPrefix;

  for (const link of LINK_SEEDS) {
    const useSuffix = link.suffixed !== false;
    const actualSlug = useSuffix ? `${link.slug}-${wsPrefix}` : link.slug;
    const storeKey = link.slug;

    if (ids[storeKey]) continue; // already seeded

    const result = await apiPost("/links", {
      destination: link.destination,
      domain,
      slug: actualSlug,
      title: link.title,
      ...(link.utm ? { utm: link.utm } : {}),
    }, token);

    if (result === null) {
      // 409 — this slug is taken; find it in this workspace
      const list = await apiGet(`/links?search=${encodeURIComponent(actualSlug)}`, token) as {
        items: Array<{ id: string; slug: string }>;
      };
      const found = list.items.find((l) => l.slug === actualSlug);
      if (found) {
        ids[storeKey] = found.id;
        if (link.slug === "spring-sale" && link.utm) {
          await apiPatch(`/links/${found.id}`, { utm: { source: "instagram", medium: "social", campaign: "Spring 2026" } }, token);
        }
      }
    } else {
      ids[storeKey] = (result as { id: string }).id;
    }
  }

  // Convenience lookup keys
  ids["__spring_sale_slug__"] = "spring-sale";
  ids["__app_slug__"] = "app";
  ids["__webinar_slug__"] = `webinar-q3-${wsPrefix}`;

  return ids;
}

// ---------------------------------------------------------------------------
// Step 3 — Forms
//
// Specs assert on:
//   "Spring launch feedback" (title) — forms.spec.ts asserts:
//     · getByText("/f/spring-feedback") visible
//     · Ada Lovelace in responses
//     · "phone (removed)" column (response with undeclared 'phone' key)
//   "Beta waitlist" — forms.spec.ts asserts:
//     · "name (removed)", "notes (removed)", "phone (removed)" columns
//     · Email column header present
//
// Form slugs are global. We suffix with a stable per-workspace token so the
// same workspace always uses the same slug (idempotent), but different
// workspaces don't collide.
// ---------------------------------------------------------------------------

async function seedForms(
  token: string,
  existing: Record<string, string>,
  workspaceId: string,
): Promise<Record<string, string>> {
  const formIds: Record<string, string> = { ...existing };

  // Suffix = first 8 chars of workspaceId (stable, unique per workspace)
  const suffix = formIds["__suffix__"] ?? workspaceId.replace(/-/g, "").slice(0, 8);
  formIds["__suffix__"] = suffix;

  const feedbackSlug = `spring-feedback-${suffix}`;
  const betaSlug = `beta-waitlist-${suffix}`;

  const feedbackFields = [
    { key: "name",  label: "Your name",                  type: "text",     required: true,  placeholder: "Ada Lovelace" },
    { key: "email", label: "Email",                      type: "email",    required: true,  placeholder: "you@company.com" },
    { key: "plan",  label: "How are you using SnapURL?", type: "select",   required: false, options: ["Personal", "Team", "Agency"] },
    { key: "notes", label: "Anything else?",             type: "textarea", required: false, placeholder: "Optional" },
  ];
  const betaFields = [
    { key: "email", label: "Email", type: "email", required: true },
  ];

  // --- Spring launch feedback ---
  if (!formIds["spring-feedback"]) {
    const result = await apiPost("/forms", {
      title: "Spring launch feedback",
      slug: feedbackSlug,
      description: "Two minutes, and it genuinely shapes what we build next.",
      status: "draft",
      fields: feedbackFields,
    }, token) as { id: string } | null;

    if (result === null) {
      // Slug already exists — find it
      const forms = await apiGet("/forms", token) as Array<{ id: string; slug: string }>;
      const found = forms.find((f) => f.slug === feedbackSlug);
      if (found) formIds["spring-feedback"] = found.id;
    } else {
      formIds["spring-feedback"] = result.id;
      // Patch to live (PATCH replaces fields so we must pass them)
      await apiPatch(`/forms/${result.id}`, { status: "live", fields: feedbackFields }, token);
    }
  }

  // --- Beta waitlist ---
  if (!formIds["beta-waitlist"]) {
    const result = await apiPost("/forms", {
      title: "Beta waitlist",
      slug: betaSlug,
      description: "",
      status: "draft",
      fields: betaFields,
    }, token) as { id: string } | null;

    if (result === null) {
      const forms = await apiGet("/forms", token) as Array<{ id: string; slug: string }>;
      const found = forms.find((f) => f.slug === betaSlug);
      if (found) formIds["beta-waitlist"] = found.id;
    } else {
      formIds["beta-waitlist"] = result.id;
      // Keep draft status, keep fields
      await apiPatch(`/forms/${result.id}`, { status: "draft", fields: betaFields }, token);
    }
  }

  // --- Submit form responses for spring-feedback (idempotent: check count first) ---
  const feedbackId = formIds["spring-feedback"];
  if (feedbackId && !formIds["__responses_seeded__"]) {
    const responseList = await apiGet(`/forms/${feedbackId}/responses`, token) as { total: number };
    if (responseList.total < 3) {
      // Ada: name+email+plan+notes (all declared fields)
      await apiPost(`/public/forms/${feedbackSlug}`, {
        answers: { name: "Ada Lovelace", email: "ada@example.com", plan: "Team", notes: "The QR export saved us." },
      });
      // Grace: name+email+plan only
      await apiPost(`/public/forms/${feedbackSlug}`, {
        answers: { name: "Grace Hopper", email: "grace@example.com", plan: "Agency" },
      });
      // Alan: name+email+phone (phone is NOT a declared field → "phone (removed)" column)
      await apiPost(`/public/forms/${feedbackSlug}`, {
        answers: { name: "Alan Turing", email: "alan@example.com", phone: "+44 20 7946 0000" },
      });
    }
    formIds["__responses_seeded__"] = "1";
  }

  // Store the actual slugs so real-session.ts can write them as env or storage
  formIds["__feedback_slug__"] = feedbackSlug;
  formIds["__beta_slug__"] = betaSlug;

  return formIds;
}

// ---------------------------------------------------------------------------
// Step 4 — Bio page
//
// bio.spec.ts has TWO tests:
//   (a) "cannot create a bio page without a back-half" — reads getByRole("row", { name: /\/acme\b/ })
//   (b) "create a bio page as a draft, see it listed, then publish it" — WRITES a new bio page
//
// Rule: seed only what specs READ; never what they WRITE.
// Test (b) creates its own bio page via the UI (PUT /bio-pages upsert). When we pre-seed
// a bio page in the shared workspace, the UI's /bio page opens with the seeder's page in
// the editor (pages[0]). The spec then creates a NEW draft page and clicks "Publish" —
// but the Publish button still acts on pages[0] (the seeder's already-live page), so the
// new draft's row never transitions to "Live" and the assertion fails.
//
// Therefore: do NOT seed a bio page here. Test (a)'s /acme row is a genuine seed-data need,
// but seeding it breaks test (b). Since both tests run in the same shared workspace and we
// cannot seed selectively per test, bio pages are NOT seeded. Test (a) is categorised (a)
// in the triage: still missing seed data.
// ---------------------------------------------------------------------------

// seedBioPage is intentionally absent.
// bio.spec.ts "cannot create without back-half" (reads /acme) → category (a): missing seed.
// bio.spec.ts "create a draft, publish it" (writes its own page) → must NOT have existing pages.

// ---------------------------------------------------------------------------
// Step 1.5 — Clean up stale verifying custom domains
//
// domains.spec.ts WRITES a new custom domain per run (e.g. "e2e-{ts}.example.com").
// Over multiple runs on the same shared workspace, these accumulate and remain in
// "verifying" status. The API's GET /domains returns them BEFORE localhost:3002
// (the live default domain) in its list. The import panel uses domains[0].domain as
// its default target: if domains[0] is a verifying domain, the importers "skip" test
// gets "isn't verified yet" instead of "already taken" → "1 failed" not "1 skipped".
//
// We delete any non-live custom domains before seeding links. localhost:3002 stays
// untouched (it is the workspace default and cannot be deleted via the domains API).
// ---------------------------------------------------------------------------

async function cleanStaleVerifyingDomains(token: string): Promise<void> {
  const domains = await apiGet("/domains", token) as Array<{ id: string; domain: string; status: string }>;
  for (const d of domains) {
    if (d.status !== "live" && d.domain !== "localhost:3002") {
      try {
        const { status } = await req("DELETE", `/domains/${d.id}`, undefined, token);
        if (status < 400) {
          console.log(`[seed] deleted stale verifying domain ${d.domain}`);
        } else {
          console.warn(`[seed] could not delete domain ${d.domain}: status ${status}`);
        }
      } catch (e) {
        console.warn(`[seed] domain delete threw: ${e}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5 — Team member "Arjun Kapoor"
//
// team.spec.ts:51 asserts getByRole("row", { name: /Arjun Kapoor/ }) then removes it.
// team-mobile-tables.spec.ts:53 also waits for that row before the test body.
//
// GET /members returns name = user?.name ?? email. To get "Arjun Kapoor" the
// user must have a registered account with name "Arjun Kapoor". Then inviting
// that email attaches the user row (members.service.ts:invite() looks up users
// by email) and list() returns user.name = "Arjun Kapoor".
//
// We store Arjun's email in the state so we can re-seed after a removal.
// Idempotency check: GET /members and look for a row with /Arjun Kapoor/.
// ---------------------------------------------------------------------------

async function seedArjunKapoor(
  token: string,
  existing: Record<string, string>,
  workspaceId: string,
): Promise<Record<string, string>> {
  const ids = { ...existing };

  // Check if already on the team
  const members = await apiGet("/members", token) as Array<{ id: string; name: string; email: string }>;
  const alreadyOnTeam = members.some((m) => /Arjun Kapoor/i.test(m.name));
  if (alreadyOnTeam) {
    console.log("[seed] Arjun Kapoor already on team, skipping");
    return ids;
  }

  // Arjun's email — stable per workspace (uses workspaceId prefix)
  const arjunEmail = `arjun.kapoor.${workspaceId.slice(0, 8)}@e2e-seed.local`;
  ids["__arjun_email__"] = arjunEmail;

  // Ensure Arjun has a real account (register; 409 → already exists, that's fine)
  await apiPost("/auth/register", {
    name: "Arjun Kapoor",
    email: arjunEmail,
    password: randomBytes(16).toString("base64url"),
  });

  // Invite to workspace (409 → already invited)
  const result = await apiPost("/members", { email: arjunEmail, role: "editor" }, token);
  if (result === null) {
    console.log("[seed] Arjun already invited");
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Step 6 — Abuse reports
//
// reports.spec.ts asserts:
//   /spring-sale row with status "Open" (for review+flag path)
//   /app row (for dismiss path)
//
// The spec button aria-labels hardcode the slug: "Mark report on /spring-sale reviewed",
// "Flag the link for report on /spring-sale", "Dismiss report on /app".
// The links are seeded without suffix (exact slug names) to match these aria-labels.
//
// POST /public/links/:slug/report is unauthenticated, returns { ok: true }.
// Idempotency: check existing reports before posting.
// ---------------------------------------------------------------------------

async function seedReports(token: string, springSaleSlug: string, appSlug: string): Promise<void> {
  const existing = await apiGet("/reports", token) as Array<{ slug: string }>;
  const existingSlugs = new Set(existing.map((r) => r.slug));

  if (!existingSlugs.has(springSaleSlug)) {
    await apiPost(`/public/links/${springSaleSlug}/report`, {
      reason: "This link redirects to a fake login page that steals passwords.",
    });
  }
  if (!existingSlugs.has(appSlug)) {
    await apiPost(`/public/links/${appSlug}/report`, {
      reason: "Sends unsolicited bulk traffic to a spam site.",
    });
  }
}

// ---------------------------------------------------------------------------
// Step 7 — Conversions
//
// conversions.spec.ts:24 asserts:
//   getByText("Subscription started") — a ConversionEvent.name in the events table
//   getByText("Spring 2026")          — a campaign in byLink (from utm.campaign)
//
// POST /conversions records an event. externalId makes it idempotent.
// The spring-sale link must have utm.campaign = "Spring 2026" (seeded in step 2).
// ---------------------------------------------------------------------------

async function seedConversions(token: string, linkIds: Record<string, string>): Promise<void> {
  const existing = await apiGet("/conversions", token) as { events: Array<{ name: string }> };
  if (existing.events.some((e) => e.name === "Subscription started")) return;

  const springSaleId = linkIds["spring-sale"];
  if (!springSaleId) {
    console.warn("[seed] spring-sale link not found, skipping conversions");
    return;
  }

  await apiPost("/conversions", {
    linkId: springSaleId,
    kind: "sale",
    name: "Subscription started",
    valueMinor: 99900,
    externalId: "seed-sub-001",
  }, token);

  await apiPost("/conversions", {
    linkId: springSaleId,
    kind: "signup",
    name: "Account created",
    valueMinor: 0,
    externalId: "seed-acct-001",
  }, token);
}

// ---------------------------------------------------------------------------
// Main globalSetup entry-point
// ---------------------------------------------------------------------------

export default async function globalSetup(): Promise<void> {
  console.log("[seed] starting real-stack seeder …");
  mkdirSync(RUN_DIR, { recursive: true });

  // ---- Load existing state ----
  let state: SeedState | null = null;
  if (existsSync(SEED_STATE_FILE)) {
    try {
      state = JSON.parse(readFileSync(SEED_STATE_FILE, "utf8")) as SeedState;
      console.log(`[seed] loaded existing state for ${state.email}`);
    } catch {
      console.warn("[seed] state file unreadable, starting fresh");
      state = null;
    }
  }

  // ---- Validate / refresh token ----
  let token: string;
  let email: string;
  let password: string;
  let domain: string;
  let workspaceId: string;
  let refreshToken: string;

  if (state) {
    const { status } = await req("GET", "/workspaces/current", undefined, state.accessToken);
    if (status === 200) {
      token = state.accessToken;
      refreshToken = state.refreshToken;
      email = state.email;
      password = state.password;
      domain = state.domain;
      workspaceId = state.workspaceId;
      console.log(`[seed] token valid, reusing workspace ${workspaceId}`);
    } else {
      console.log("[seed] token expired, re-logging in …");
      const loginResult = await apiPost("/auth/login", { email: state.email, password: state.password }) as {
        accessToken: string;
        refreshToken: string;
      } | null;
      if (loginResult?.accessToken) {
        token = loginResult.accessToken;
        refreshToken = loginResult.refreshToken;
        email = state.email;
        password = state.password;
        domain = state.domain;
        workspaceId = state.workspaceId;
        // Refresh stored tokens
        state.accessToken = token;
        state.refreshToken = refreshToken;
        console.log(`[seed] re-logged in for ${email}`);
      } else {
        console.log("[seed] re-login failed, registering new workspace …");
        state = null;
      }
    }
  }

  if (!state) {
    const pw = randomBytes(24).toString("base64url");
    const em = `seed-ws-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}@e2e.local`;
    const session = await registerAccount("E2E Seed Workspace", em, pw);
    token = session.accessToken;
    refreshToken = session.refreshToken;
    email = em;
    password = pw;

    const ws = await apiGet("/workspaces/current", token) as { id: string; defaultDomain: string };
    domain = ws.defaultDomain;
    workspaceId = ws.id;
    console.log(`[seed] registered ${email}, workspaceId=${workspaceId}, domain=${domain}`);

    state = { accessToken: token, refreshToken, email, password, workspaceId, domain, linkIds: {}, formIds: {} };
  }

  // Ensure narrowed bindings are assigned (TS flow)
  token = state.accessToken;
  refreshToken = state.refreshToken;
  email = state.email;
  password = state.password;
  domain = state.domain;
  workspaceId = state.workspaceId;

  // ---- Step 1.5: Clean stale verifying custom domains ----
  // domains.spec.ts adds a custom domain per run; accumulated verifying domains
  // shift domains[0] away from localhost:3002 and break the importers "skip" test.
  console.log("[seed] cleaning stale verifying domains …");
  await cleanStaleVerifyingDomains(token);

  // ---- Step 2: Links ----
  console.log("[seed] seeding links …");
  // wsPrefix: first 8 chars of workspaceId (no dashes), stable per workspace
  const wsPrefix = workspaceId.replace(/-/g, "").slice(0, 8);
  state.linkIds = await seedLinks(token, domain, state.linkIds ?? {}, wsPrefix);
  console.log(`[seed] links: ${Object.entries(state.linkIds).filter(([k]) => !k.startsWith('__')).map(([k,v]) => `${k}=${v.slice(0,8)}`).join(", ")}`);

  // ---- Step 3: Forms ----
  console.log("[seed] seeding forms …");
  state.formIds = await seedForms(token, state.formIds ?? {}, workspaceId);
  console.log(`[seed] forms: spring-feedback=${state.formIds["spring-feedback"]}, beta-waitlist=${state.formIds["beta-waitlist"]}`);

  // Step 4 (bio pages): intentionally skipped — see seedBioPage comment above.

  // ---- Step 5: Team member ----
  console.log("[seed] seeding team member …");
  const updatedIds = await seedArjunKapoor(token, state.linkIds, workspaceId);
  state.linkIds = updatedIds;

  // ---- Step 6: Abuse reports ----
  // spring-sale and app are now seeded without suffix so aria-labels match exactly.
  console.log("[seed] seeding abuse reports …");
  await seedReports(token, "spring-sale", "app");

  // ---- Step 7: Conversions ----
  console.log("[seed] seeding conversions …");
  await seedConversions(token, state.linkIds);

  // ---- Persist ----
  state.accessToken = token;
  state.refreshToken = refreshToken;
  writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`[seed] state written to ${SEED_STATE_FILE}`);
  console.log("[seed] done.");
}
