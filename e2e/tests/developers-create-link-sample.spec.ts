import { expect, test } from "@playwright/test";
// The e2e package has no dependency on the workspace packages, so load the built
// contract by path (CI runs `pnpm build:packages` before the E2E job). This is the
// exact schema POST /links validates the body with.
import { CreateLinkInput } from "../../packages/contract/dist/index.js";
import { seedSession } from "../support/session";

/* E2E journey (#655): a developer opens /developers, reads the "Create a link"
   example under each language tab and copies it. The cURL body, once the
   placeholder domain is replaced by a real one, must be accepted by POST /links:
   the old sample sent a routing rule without the required `id` (HTTP 400
   "rules.0.id: expected string"), an expiry date that was already in the past,
   and a domain ("snap.to") the reader does not own.

   The sample text is read from what the page actually renders after clicking each
   tab, then the JSON is run through the real wire contract (CreateLinkInput) —
   no API/DB is needed, so this runs in the fixtures-mode suite. */

const REGION = /Create a link example request/;

async function sampleFor(page: import("@playwright/test").Page, tab: string, lang: string): Promise<string> {
  await page.getByRole("button", { name: tab, exact: true }).click();
  await expect(page.getByRole("button", { name: tab, exact: true })).toHaveAttribute("aria-pressed", "true");
  const region = page.getByRole("region", { name: `Create a link example request (${lang})` });
  await expect(region).toBeVisible();
  return (await region.textContent()) ?? "";
}

test.describe("developers: create-a-link sample", () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test("the sample a developer copies is accepted by the create-link contract", async ({ page }) => {
    await page.goto("/developers");
    await expect(page.getByRole("region", { name: REGION })).toBeVisible();

    // --- cURL (default tab): pull the JSON body out of the rendered `-d '...'`. ---
    const curl = await sampleFor(page, "cURL", "curl");
    const m = /-d '([\s\S]*)'\s*$/.exec(curl);
    expect(m, "cURL sample should contain a -d '<json>' body").not.toBeNull();
    const body = JSON.parse(m![1]);

    // The reader must substitute their own domain: the placeholder is explicit,
    // and a domain they do not own is not hard-coded.
    expect(body.domain).toBe("<your-domain>");
    expect(curl).not.toContain("snap.to");
    // No fixed past expiry baked into the sample.
    expect(body.expiresAt).toBeUndefined();

    // Substitute a real domain, as the reader would, and validate against POST /links' schema.
    const parsed = CreateLinkInput.safeParse({ ...body, domain: "go.example.com" });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);

    // The routing rule carries the required id (the original 400 was `rules.0.id`).
    expect(body.rules[0].id).toEqual(expect.any(String));
    expect(body.rules[0].id.length).toBeGreaterThan(0);
  });

  test("the cURL tab shows the rule id and the placeholder domain, with no stale expiry", async ({ page }) => {
    await page.goto("/developers");
    const text = await sampleFor(page, "cURL", "curl");
    expect(text, "cURL sample rule id").toContain("rule_in");
    expect(text, "cURL sample domain").toContain("<your-domain>");
    expect(text, "cURL sample stale domain").not.toContain("snap.to");
    expect(text, "cURL sample stale expiry").not.toMatch(/2026-09-30|expires_?[aA]t/);
  });

  /* Issue #656: cURL is the only sample we back. There are no typed SDKs, CLI
     or MCP server, so the TS/Python tabs must be gone and the page must not
     claim an MCP server or SDKs. */
  test("there are no TS/Python tabs and no SDK/MCP claims on /developers", async ({ page }) => {
    await page.goto("/developers");
    await expect(page.getByRole("button", { name: "cURL", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "TS", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Python", exact: true })).toHaveCount(0);

    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toContain("MCP");
    expect(body).not.toContain("SDKs");
  });

  /* Issue #656: the marketing landing page must not claim typed SDKs, a CLI,
     an MCP server, or PDF/EPS QR export — none exist. QR is SVG + PNG only. */
  test("the marketing landing page makes no unbacked product claims", async ({ page }) => {
    await page.goto("/");
    const body = (await page.locator("body").textContent()) ?? "";
    expect(body).not.toContain("typed SDKs");
    expect(body).not.toContain("CLI");
    expect(body).not.toContain("MCP server");
    expect(body).not.toContain("PDF");
    expect(body).not.toContain("EPS");
    expect(body).toContain("SVG and PNG");
  });
});
