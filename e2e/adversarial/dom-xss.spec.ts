import { test, expect } from "@playwright/test";
import { registerRealUser, type RealSession } from "../support/real-session";

/* ============================================================
   L5 adversarial — stored XSS DOM-execution oracle (issue #607, #885).

   The HTTP-level check in the original run.mjs established that profile.name,
   profile.bio and block.title accept and echo markup verbatim (the contract
   schema is a plain z.string(), no HTML stripping declared) — that is expected
   per the contract, not itself a finding. What that check could NOT determine
   is whether the payload actually EXECUTES once the web app renders it, which
   is the oracle issue #607 names explicitly: "DOM-based oracle (does the
   payload execute), not a judgement call."

   #885 — SELF-SEEDING. This spec used to read a slug a prior, gitignored
   `.qa-runs/run.mjs` pass had written the payload into (`BIO_SLUG` env var) and
   `test.skip(!SLUG, …)` when that env var was absent. `run.mjs` is not in the
   repo, so wired into CI the suite reported one silent skip on every run — a
   security check that never ran. It now seeds its OWN payload in `beforeAll`:
   register a user over the API, then `PUT /bio-pages` with the stored-XSS
   payload in the three fields it probes (profile.name, profile.bio, a block
   title), published `live`. If seeding fails the suite FAILS; it never skips.

   The payload is the public canonical stored-XSS probe already used elsewhere
   in this repo (e2e/mocked-api/bio-editor-inline-errors.spec.ts): an
   `<img onerror>` / `<svg onload>` that calls `alert()`. No new information is
   exposed. Per qa-oracles §8 / SECURITY.md: if a run on `main` finds a LIVE
   stored-XSS (the payload fires), that is reported through the private channel,
   never a public issue — this spec's assertion failing on `main` IS that signal.

   The oracle is DOM execution, observed by a `window.alert` override + the
   Playwright `dialog` event (payload calls `alert`), not log inspection and not
   a judgement about what "should" happen. The public route is
   web/src/app/b/[[...parts]]/page.tsx (the `/b/<slug>` system-domain alias);
   the fields render through web/src/components/bio/bio-page-card.tsx, which is
   XSS-safe by construction (every string is an escaped React text child).
   ============================================================ */

const API_URL = process.env.QA_API_URL ?? "http://localhost:3001/api/v1";

/* Canonical public stored-XSS probes. Each tries to run `alert(...)`, which the
   test catches via a window.alert override and the dialog event. If the field
   were rendered as raw HTML (rather than an escaped React text child) the
   onerror/onload handler would fire on load. */
const NAME_PAYLOAD = `<img src=x onerror="alert('xss-name')">`;
const BIO_PAYLOAD = `<svg onload="alert('xss-bio')"></svg>`;
const BLOCK_TITLE_PAYLOAD = `<img src=x onerror="alert('xss-block')">`;

/** Seeded in beforeAll; the test navigates to /b/<slug>. Not exported, not an
 *  env var. */
let seededSlug = "";

test.beforeAll(async () => {
  // Register a throwaway account and seed a published bio page carrying the
  // stored-XSS payload in every field this spec probes. Any failure here throws
  // and fails the suite — it must never silently skip (issue #885).
  const session: RealSession = await registerRealUser();

  const wsRes = await fetch(`${API_URL}/workspaces/current`, {
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  if (!wsRes.ok) {
    throw new Error(`dom-xss seed: GET /workspaces/current returned ${wsRes.status}`);
  }
  const ws = (await wsRes.json()) as { defaultDomain?: string };
  const domain = ws.defaultDomain;
  if (!domain) {
    throw new Error("dom-xss seed: GET /workspaces/current returned no defaultDomain");
  }

  const slug = `xss-probe-${Date.now().toString(36)}`;
  const putRes = await fetch(`${API_URL}/bio-pages`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      domain,
      slug,
      status: "live",
      profile: { name: NAME_PAYLOAD, bio: BIO_PAYLOAD },
      blocks: [{ kind: "link", title: BLOCK_TITLE_PAYLOAD, href: "https://example.com/xss" }],
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(
      `dom-xss seed: PUT /bio-pages returned ${putRes.status}; body=${body.slice(0, 400)}`,
    );
  }

  seededSlug = slug;
});

test("stored XSS payload in a public bio page does not execute in the DOM", async ({ page }) => {
  expect(seededSlug, "beforeAll must have seeded a bio page slug").not.toBe("");

  let fired = false;
  page.on("dialog", async (d) => {
    fired = true;
    await d.dismiss();
  });
  await page.exposeFunction("__xssSignal", () => {
    fired = true;
  });
  await page.addInitScript(() => {
    // Overriding window.alert catches alert(1)/alert(document.domain) even if
    // the dialog event above is suppressed by the browser for some reason.
    window.alert = (...args: unknown[]) => {
      // @ts-expect-error exposed by exposeFunction above, not declared on Window
      void window.__xssSignal?.(args);
    };
  });

  // Base URL comes from the config's use.baseURL (#885): a relative path lets
  // Playwright prepend it, so there is no second QA_WEB_URL env var.
  await page.goto(`/b/${seededSlug}`, { waitUntil: "networkidle" });
  // Give any injected <img onerror>/<svg onload> a moment to fire.
  await page.waitForTimeout(1500);

  const bodyHTML = await page.content();
  const rawTagPresent = /<script>|onerror=|onload=/i.test(bodyHTML);

  // The actual oracle is `fired`, not `rawTagPresent` — JSX text interpolation
  // can legitimately contain the literal substring "onerror=" as escaped text
  // (&lt;img onerror=...&gt;) without it ever being parsed as an attribute.
  // `rawTagPresent` is recorded in the failure message only for triage.
  expect(
    fired,
    `payload must not execute as script/event-handler in the DOM ` +
      `(rawTagPresentInServedHTML=${rawTagPresent})`,
  ).toBe(false);
});
