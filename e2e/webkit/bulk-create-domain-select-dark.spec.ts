import { expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #810 — The Bulk create panel's Domain <select> must be READABLE in dark theme
 * on iOS WebKit. The bug: WebKit rendered the native <option> popup with its
 * light system colours (light-grey background, near-white text) because the
 * stylesheet declared no `color-scheme`. Chromium dark was fine, so this is
 * local WebKit-only evidence (playwright.webkit.config.ts, iPhone 15).
 *
 * Oracle: in dark theme the <select> must (a) sit under `color-scheme: dark` so
 * the UA paints native controls dark, and (b) resolve its own background to the
 * dark --surface token and its text to the dark --ink token — i.e. a DARK
 * background with LIGHT text, never the light-grey-on-near-white the bug showed.
 *
 * This FAILS on the pre-fix stylesheet: without the color-scheme declarations
 * `color-scheme` computes to "normal", and the select inherited no explicit
 * colours, so WebKit's native rendering diverged from the tokens. */

// Dark theme tokens (globals.css :root[data-theme="dark"]).
const DARK_SURFACE = "rgb(16, 22, 30)"; // --surface #10161e
const DARK_INK = "rgb(233, 238, 244)"; // --ink #e9eef4
// Light theme tokens, for the negative assertion.
const LIGHT_SURFACE = "rgb(255, 255, 255)"; // --surface #ffffff

/** Force dark before the app boots — the pre-paint script in app/layout.tsx
 *  reads localStorage["snapurl.appearance"].mode and stamps data-theme. */
async function seedDarkTheme(page: Page): Promise<void> {
  await page.addInitScript(
    ([key]) => window.localStorage.setItem(key, JSON.stringify({ mode: "dark" })),
    ["snapurl.appearance"] as const,
  );
}

const domain = (id: string, name: string) => ({
  id,
  domain: name,
  status: "live",
  ssl: "active",
  links: 0,
  rootRedirect: null,
  notFoundRedirect: null,
});

const blank = { countries: [], cities: [], devices: [], browsers: [], referrers: [], tags: [], topLinks: [] };

async function openLinks(page: Page): Promise<void> {
  await seedDarkTheme(page);
  await seedMockSession(page);
  await mockApi(page, {
    "GET /auth/me": { status: 200, body: MOCK_USER },
    "GET /auth/workspaces": { status: 200, body: [] },
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /domains": { status: 200, body: [domain("d1", "snap.to"), domain("d2", "go.acme.test")] },
    "GET /members": { status: 200, body: [] },
    "GET /analytics": {
      status: 200,
      body: { totals: { clicks: 0, unique: 0, scans: 0, conversions: 0, blocked: 0 }, deltas: {}, series: [], ...blank },
    },
    "GET /audit": { status: 200, body: { items: [], nextCursor: null } },
  });
  await page.goto("/links");
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("#810 — Bulk create Domain select is readable in dark theme on WebKit", () => {
  test("dark theme stamps data-theme=dark", async ({ page }) => {
    await openLinks(page);
    // SCRATCH RED-ON-BROKEN PROOF (#886) — reverted before merge. Asserts an
    // impossible theme value so the required e2e WebKit lane reds and ci-gate fails.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "scratch-red-on-broken-proof");
  });

  test("the Domain select follows the dark theme tokens, not light system colours", async ({ page }) => {
    await openLinks(page);

    // Open the Bulk create panel.
    await page.getByRole("button", { name: "Bulk create" }).click();

    // The panel's Domain select, populated from the mocked /domains response.
    // Scoped by its accessible label so it is not confused with the links
    // page's "Filter by domain" select.
    const select = page.getByLabel("Domain", { exact: true });
    await expect(select).toBeVisible();
    await expect(select.locator('option[value="snap.to"]')).toHaveCount(1);

    const computed = await select.evaluate((el) => {
      const cs = getComputedStyle(el);
      const option = el.querySelector("option");
      const ocs = option ? getComputedStyle(option) : null;
      return {
        colorScheme: cs.colorScheme,
        bg: cs.backgroundColor,
        fg: cs.color,
        optBg: ocs?.backgroundColor ?? null,
        optFg: ocs?.color ?? null,
      };
    });

    // (a) The UA is told to paint native controls dark — the core of the fix.
    //     Pre-fix this is "normal".
    expect(computed.colorScheme).toBe("dark");

    // (b) The collapsed control resolves to the DARK surface/ink tokens:
    //     a dark background with light text, never light-grey-on-near-white.
    expect(computed.bg).toBe(DARK_SURFACE);
    expect(computed.fg).toBe(DARK_INK);
    expect(computed.bg).not.toBe(LIGHT_SURFACE);

    // (c) The <option> rows carry the same explicit dark tokens so WebKit's
    //     native popup is readable.
    expect(computed.optBg).toBe(DARK_SURFACE);
    expect(computed.optFg).toBe(DARK_INK);
  });
});
