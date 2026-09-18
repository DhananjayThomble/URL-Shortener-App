import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../support/session";
import { createRealLink, registerRealUser, seedSessionTokens } from "../support/real-session";

/* ============================================================
   Issue #459 — programmatic-label audit (axe `label` + `select-name`).

   Oracle: axe-core's own `label` and `select-name` rules (WCAG 2.1 SC 4.1.2 /
   1.3.1). Not a judgement call — a form control either has a programmatically
   associated accessible name or it does not.

   Runs against the REAL staging stack (playwright.a11y.config.ts builds web with
   NEXT_PUBLIC_USE_FIXTURES=false, pointed at api :3001). qa-oracles §5 forbids
   QA against fixtures; the markup an axe rule inspects is produced by the React
   components regardless of the data source, but running real keeps this audit
   honest and identical to the run that first filed #438.

   --- What this scans (be precise; the issue counts routes) ---
   11 static (app) routes in ROUTES below, each × 2 viewports × 2 themes = 44 checks.
   Plus per (viewport × theme):
     · the create-link drawer, walking its 6 tabs               → 4 checks
     · the /links/[id] detail page's "Edit destination" Field   → 4 checks
   Total = 52 checks. (An earlier revision of this file said "13 routes" and
   scanned 11; that prose was wrong. The set below is the real set.)

   --- Coverage gaps (qa-oracles §3 requires stating these) ---
   · /links/[id] is a DYNAMIC route: the a11y config drops the entity-seed
     globalSetup, so there is no pre-seeded link to open. The dedicated test
     below registers its own account and creates ONE link via the API, then
     scans that page's `<Field label="Destination">` — the same Field
     association the whole issue turns on. If the API is unreachable that test
     errors (it does not silently pass).
   · Auth routes (/login, /register, /2fa, /forgot) live OUTSIDE (app) and are
     NOT scanned here — this audit is scoped to the authenticated dashboard,
     matching the surface #438/#459 were filed against.
   · Modals/menus that only open on a specific row action (e.g. per-link
     dropdowns) beyond the create-link drawer are not exhaustively opened.
   · Placeholder text satisfies axe's `label` rule (`non-empty-placeholder`),
     so 0 violations here does NOT mean every control has a real accessible
     name. #469 documents two controls in the create-link drawer scanned by
     this very suite where `<label for>` resolves to a wrapper `<div>`
     (Short link, create-link-drawer.tsx) or to nothing at all (Tags, which
     wraps a `<Controller>` that never forwards `id`) — both pass this audit
     today. A green run here is not proof #469 is closed.

   --- CI does NOT run this suite ---
   Nothing in .github/workflows/, the root package.json or e2e/package.json
   references playwright.a11y.config.ts or e2e/a11y. `pnpm test:e2e` resolves to
   the fixtures config (testDir: ./tests) and never matches these files. This is
   a manual QA-lab suite, run against a live staging stack; it is a guard you
   invoke, not a gate that runs on every push. Wiring it into the QA lab is
   tracked separately.
   ============================================================ */

const RULES = ["label", "select-name"];

const ROUTES = [
  "/links",
  "/analytics",
  "/conversions",
  "/forms",
  "/bio",
  "/qr",
  "/domains",
  "/developers",
  "/team",
  "/reports",
  "/settings",
];

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const THEMES = ["light", "dark"] as const;

/** Force a theme before the app boots — the pre-paint script in app/layout.tsx
 *  reads localStorage["snapurl.appearance"].mode and sets data-theme from it. */
async function seedTheme(page: Page, mode: (typeof THEMES)[number]): Promise<void> {
  await page.addInitScript(
    ([key, m]) => window.localStorage.setItem(key, JSON.stringify({ mode: m })),
    ["snapurl.appearance", mode] as const,
  );
}

function runAxe(page: Page) {
  return new AxeBuilder({ page }).withRules(RULES).analyze();
}

/** Flatten axe violation nodes into a compact, greppable list for the report. */
function summarise(violations: Awaited<ReturnType<typeof runAxe>>["violations"]) {
  return violations.flatMap((v) =>
    v.nodes.map((n) => ({ rule: v.id, target: n.target.join(" "), html: n.html.slice(0, 200) })),
  );
}

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    test.describe(`${theme} / ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test.beforeEach(async ({ page }) => {
        await seedTheme(page, theme);
        await seedSession(page);
      });

      for (const route of ROUTES) {
        test(`${route} has no label/select-name violations`, async ({ page }) => {
          await page.goto(route);
          // Let the route-guarded page settle before scanning.
          await page.waitForLoadState("networkidle").catch(() => {});
          const { violations } = await runAxe(page);
          expect(summarise(violations), JSON.stringify(summarise(violations), null, 2)).toEqual([]);
        });
      }

      test("create-link drawer has no label/select-name violations", async ({ page }) => {
        await page.goto("/links");
        await page.waitForLoadState("networkidle").catch(() => {});
        await page
          .getByRole("button", { name: /New link|Create a link/ })
          .first()
          .click();
        const drawer = page.getByRole("dialog", { name: "Create a link" });
        await expect(drawer).toBeVisible();
        // Walk every tab so each panel's controls are mounted and scanned — the
        // drawer renders one tab at a time.
        for (const tabName of ["Destination", "Routing", "Access", "UTM", "Social preview", "QR"]) {
          await drawer.getByRole("button", { name: tabName }).click();
          const { violations } = await runAxe(page);
          const found = summarise(violations);
          expect(found, `tab "${tabName}": ${JSON.stringify(found, null, 2)}`).toEqual([]);
        }
      });

      test("/links/[id] Edit destination Field has no label/select-name violations", async ({ page }) => {
        // Dynamic route: no globalSetup seeds a link, so create one against the
        // real API as a fresh account and drive the browser as that same account.
        // The `<Field label="Destination">` at links/[id]/page.tsx is exactly the
        // association this issue turns on; it only mounts after clicking "Edit".
        const session = await registerRealUser();
        const link = await createRealLink(session);
        await seedSessionTokens(page, session);

        await page.goto(`/links/${link.id}`);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.getByRole("button", { name: "Edit", exact: true }).first().click();
        // Field label + associated input must be present before scanning. Match
        // the control by its exact accessible name — "Destination" as a substring
        // also appears in the topbar search's aria-label and the Cancel button.
        await expect(page.getByRole("textbox", { name: "Destination", exact: true })).toBeVisible();

        const { violations } = await runAxe(page);
        const found = summarise(violations);
        expect(found, JSON.stringify(found, null, 2)).toEqual([]);
      });
    });
  }
}
