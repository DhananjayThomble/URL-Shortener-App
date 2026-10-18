import { expect, test, type Page } from "@playwright/test";
import { MOCK_USER, MOCK_WORKSPACE, mockApi, seedMockSession } from "../support/mock-api";

/* #795 — the marketing pages and Settings made claims the product contradicts.
   Each assertion below pins one corrected string; the oracle for every one is a
   repo document or a control the app actually ships:

   - Pricing: there is no billing and exactly one plan (docs/DECISIONS.md,
     "Billing: the controls are removed rather than faked"), so "forever, for now"
     (self-contradicting) and "on every plan" were unbacked.
   - Retention: Settings offers 1 year / 3 years / Forever-up-to-the-operator's-limit
     and says rollups are kept regardless (SELF-HOSTING.md "Retention"), so
     "retained analytics history carries no limit" was false.
   - Self-host: the guide is six steps, not one command (SELF-HOSTING.md §2-§5).
     The commands asserted here are the ones that guide gives; the Node test
     web/src/lib/self-host-quickstart.test.ts checks them against the file itself.
   - Settings must not show an environment-variable name to an end user.

   The marketing routes are static, so they need no API. Run on desktop and, via
   the pixel-7 project, on a phone. */

const body = (page: Page) => page.locator("body");

test.describe("marketing copy (#795)", () => {
  test("/pricing: the price is not 'forever, for now' and nothing claims several plans", async ({ page }) => {
    await page.goto("/pricing");
    const text = await body(page).innerText();

    expect(text).not.toMatch(/forever,\s*for now/i);
    expect(text).not.toMatch(/every plan/i);
    await expect(page.getByText("$0", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("free right now", { exact: false }).first()).toBeVisible();
  });

  test("/pricing: retained analytics history is not listed as limitless; the retention setting is explained", async ({ page }) => {
    await page.goto("/pricing");

    // The "None of these carry a limit" list must not include analytics history.
    const metered = page.getByRole("heading", { name: "What typical shorteners meter" }).locator("xpath=ancestor::div[1]");
    await expect(metered).toBeVisible();
    await expect(metered.getByText("Retained analytics history")).toHaveCount(0);

    await expect(page.getByText("Raw click data is kept for the retention period you choose in Settings")).toBeVisible();
    await expect(page.getByText("rollups behind your dashboards are kept regardless", { exact: false })).toBeVisible();
  });

  test("/product: no 'every plan', and the preview bullet matches what /p/<slug> renders", async ({ page }) => {
    await page.goto("/product");
    const text = await body(page).innerText();

    expect(text).not.toMatch(/every plan/i);
    expect(text).not.toMatch(/Shows destination, owner and expiry/);
    await expect(page.getByText("Shows the destination, owner and any expiry or start date")).toBeVisible();
    await expect(page.getByText("Destination hidden until the password is entered, on protected links")).toBeVisible();
  });

  test("/ : no 'one command' and no 'every plan'", async ({ page }) => {
    await page.goto("/");
    const text = await body(page).innerText();

    expect(text).not.toMatch(/one command/i);
    expect(text).not.toMatch(/every plan/i);
    await expect(page.getByText("self-host with Docker Compose", { exact: false }).first()).toBeVisible();
  });

  test("/self-host: shows the real commands from SELF-HOSTING.md instead of claiming one command", async ({ page }) => {
    await page.goto("/self-host");
    const text = await body(page).innerText();

    expect(text).not.toMatch(/one command/i);
    expect(text).not.toMatch(/every plan/i);

    const quickstart = page.getByRole("region", { name: "Quick start" });
    await expect(quickstart).toBeVisible();
    const code = quickstart.locator("pre");
    await expect(code).toContainText("git clone https://github.com/DhananjayThomble/URL-Shortener-App.git");
    await expect(code).toContainText("cd URL-Shortener-App/deploy/single-node");
    await expect(code).toContainText("./init.sh");
    await expect(code).toContainText("docker compose pull");
    await expect(code).toContainText("docker compose up -d");
    await expect(code).toContainText("docker compose --profile migrate up migrate");

    // The steps that are not a command are said out loud, and the full guide is one click away.
    await expect(quickstart.getByText("APP_DOMAIN", { exact: false }).first()).toBeVisible();
    const guide = quickstart.getByRole("link", { name: /full self-hosting guide/i });
    await expect(guide).toHaveAttribute("href", /\/blob\/main\/SELF-HOSTING\.md$/);
  });

  test("/self-host: the page title/description do not promise one command", async ({ page }) => {
    await page.goto("/self-host");
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description ?? "").not.toMatch(/one command/i);
  });

  test("/settings: no environment variable name is shown to the user", async ({ page }) => {
    await seedMockSession(page);
    await mockApi(page, {
      "GET /auth/me": { status: 200, body: MOCK_USER },
      "GET /auth/workspaces": { status: 200, body: [] },
      "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
      "GET /domains": { status: 200, body: [] },
      "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
      "GET /bio-pages": { status: 200, body: [] },
      "GET /members": { status: 200, body: [] },
    });
    await page.goto("/settings");

    const scan = page.getByText("Scan destinations on create");
    await expect(scan).toBeVisible();
    const text = await body(page).innerText();

    expect(text).not.toContain("GOOGLE_SAFE_BROWSING_API_KEY");
    // Any SHOUTY_SNAKE_CASE token is an env var leaking into the UI.
    expect(text).not.toMatch(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/);
    await expect(page.getByText("Safe Browsing key", { exact: false })).toBeVisible();
  });
});
