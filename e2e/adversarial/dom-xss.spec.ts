import { test, expect } from "@playwright/test";

/* ============================================================
   L5 adversarial — stored XSS DOM-execution oracle (issue #607).

   The HTTP-level check in run.mjs established that profile.name, profile.bio
   and block.title accept and echo markup verbatim (the contract schema is a
   plain z.string(), no HTML stripping declared) — that is expected per the
   contract, not itself a finding. What that check could NOT determine is
   whether the payload actually EXECUTES once the web app renders it, which is
   the oracle issue #607 names explicitly: "DOM-based oracle (does the payload
   execute), not a judgement call."

   This spec takes a slug a prior run.mjs pass already wrote the payload into
   (BIO_SLUG env var) and navigates a real browser to /b/<slug>, the public
   route in web/src/app/b/[slug]/page.tsx. A `window.__xssFired` flag set by
   onerror/onload/script injection is the pass/fail signal — not log
   inspection, not a judgement call about what "should" happen.
   ============================================================ */

const BASE_URL = process.env.QA_WEB_URL ?? "http://localhost:3000";
const SLUG = process.env.BIO_SLUG;

test("stored XSS payload in a public bio page does not execute in the DOM", async ({ page }) => {
  test.skip(!SLUG, "BIO_SLUG not provided — run.mjs must create the page first");

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

  await page.goto(`${BASE_URL}/b/${SLUG}`, { waitUntil: "networkidle" });
  // Give any injected <img onerror>/<svg onload> a moment to fire.
  await page.waitForTimeout(1500);

  const bodyHTML = await page.content();
  const rawTagPresent = /<script>|onerror=|onload=/i.test(bodyHTML);

  // The actual oracle is `fired`, not `rawTagPresent` — JSX text
  // interpolation can legitimately contain the literal substring "onerror="
  // as escaped text (&lt;img onerror=...&gt;) without it ever being parsed
  // as an attribute. Both are recorded so the finding shows what each method
  // independently observed.
  console.log(`DOM_XSS_RESULT slug=${SLUG} fired=${fired} rawTagPresentInServedHTML=${rawTagPresent}`);

  expect(fired, "payload must not execute as script/event-handler in the DOM").toBe(false);
});
