import { expect, test, type Page } from "@playwright/test";
import { mockApi, type MockReply } from "../support/mock-api";

/* E2E (#765): with public previews off, the "+" page for a link with NO
   password says so, instead of "That didn't load" + Try again.

   The redirect rewrites <slug>+ to /p/<slug>. With previews off,
   GET /public/links/:slug/preview answers 403 (PublicService.preview). The page
   rendered the generic ErrorState for it — an offer to retry something the owner
   deliberately switched off — and its footer still claimed "Anyone can see this
   page by adding +".

   Oracle: the API's own refusal body (packages/contract/src/public.ts —
   PREVIEWS_OFF_CODE / PREVIEWS_OFF_MESSAGE) and PublicLinkLock (the short URL
   and whether a password guards it, never the destination). Only THAT 403 is the
   deliberate state: any other 403 and any 5xx stays the retryable error.

   Every reply copies a status and body PublicService really sends. */

const SECRET = "https://acme.com/private-board-deck";
const PREVIEWS_OFF: MockReply = {
  status: 403,
  body: {
    statusCode: 403,
    message: "The owner of this link has turned off public previews.",
    error: "Forbidden",
    code: "previews_off",
  },
};
// An API deployed before the code existed: same status and message, no code.
const PREVIEWS_OFF_OLD_API: MockReply = {
  status: 403,
  body: { statusCode: 403, message: "The owner of this link has turned off public previews.", error: "Forbidden" },
};
const LOCK_OPEN: MockReply = { status: 200, body: { shortUrl: "snap.to/open", passwordProtected: false } };
// A hostile/old lock reply that smuggles a destination: the page must never render it.
const LOCK_OPEN_WITH_SECRET: MockReply = {
  status: 200,
  body: { shortUrl: "snap.to/open", passwordProtected: false, destination: SECRET },
};

async function standInForRedirect(page: Page): Promise<() => string> {
  let redirectedTo = "";
  await page.route("https://snap.to/**", async (route) => {
    redirectedTo = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>redirect</p>" });
  });
  return () => redirectedTo;
}

async function expectPreviewsOffState(page: Page) {
  await expect(page.getByRole("heading", { name: "Previews are turned off" })).toBeVisible();
  await expect(page.getByText(/turned off public previews/)).toBeVisible();
  await expect(page.getByText("snap.to/open", { exact: true })).toBeVisible();
  // Retrying cannot change the owner's setting.
  await expect(page.getByText("That didn't load")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
  // Nothing the switch hides, and no password form for a link with no password.
  await expect(page.getByText("Created by")).toHaveCount(0);
  await expect(page.getByText("Safety scan")).toHaveCount(0);
  await expect(page.getByText("This link is password protected")).toHaveCount(0);
  // The footer must not claim anyone can see this page.
  await expect(page.getByText(/Anyone can see this page/)).toHaveCount(0);
  await expect(page.getByText(/We do not set cookies/)).toBeVisible();
}

test.describe("public trust page: previews off, no password (#765)", () => {
  test('shows "Previews are turned off", not the retryable error', async ({ page }) => {
    await mockApi(page, { "GET /public/links/open/preview": PREVIEWS_OFF, "GET /public/links/open/lock": LOCK_OPEN });
    await page.goto("/p/open");
    await expectPreviewsOffState(page);
  });

  test("an API from before the code existed (message only) shows the same state", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF_OLD_API,
      "GET /public/links/open/lock": LOCK_OPEN,
    });
    await page.goto("/p/open");
    await expectPreviewsOffState(page);
  });

  test("Continue goes through the short link (so the click is counted), never to the destination", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF,
      "GET /public/links/open/lock": LOCK_OPEN_WITH_SECRET,
    });
    const redirectedTo = await standInForRedirect(page);
    await page.goto("/p/open");
    const cont = page.getByRole("link", { name: "Continue to snap.to/open →" });
    await expect(cont).toHaveAttribute("href", "https://snap.to/open");
    expect(await page.content()).not.toContain(SECRET);
    await cont.click();
    await expect.poll(redirectedTo).toBe("https://snap.to/open");
  });

  test("the lock lookup is scoped to the host the redirect resolved the slug on (#800)", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF,
      "GET /public/links/open/lock": LOCK_OPEN,
    });
    await page.goto("/p/open?host=snap.to");
    await expectPreviewsOffState(page);
    expect(api.callsTo("GET", "/public/links/open/lock")[0]?.query).toEqual({ host: "snap.to" });
  });

  test("keyboard: Tab reaches Continue, then Report this link, each showing a focus ring", async ({ page }) => {
    await mockApi(page, { "GET /public/links/open/preview": PREVIEWS_OFF, "GET /public/links/open/lock": LOCK_OPEN });
    await page.goto("/p/open");
    await expectPreviewsOffState(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /^Continue to snap.to\/open/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Report this link" })).toBeFocused();
  });

  test("Report this link still works from the previews-off state", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF,
      "GET /public/links/open/lock": LOCK_OPEN,
      "POST /public/links/open/report": { status: 201, body: { ok: true } },
    });
    await page.goto("/p/open");
    await page.getByRole("button", { name: "Report this link" }).click();
    await page.getByRole("button", { name: "Submit report" }).click();
    await expect(page.getByText("Report received — thank you")).toBeVisible();
    expect(api.callsTo("POST", "/public/links/open/report")).toHaveLength(1);
  });

  test("dark theme: the state and its Continue link are visible", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark", baseURL: test.info().project.use.baseURL });
    const page = await context.newPage();
    await mockApi(page, { "GET /public/links/open/preview": PREVIEWS_OFF, "GET /public/links/open/lock": LOCK_OPEN });
    await page.goto("/p/open");
    await expectPreviewsOffState(page);
    await expect(page.getByRole("link", { name: /^Continue to snap.to\/open/ })).toBeVisible();
    await context.close();
  });

  test("lock route unavailable (older API): the state, with no Continue guessed", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF,
      "GET /public/links/open/lock": {
        status: 404,
        body: { statusCode: 404, message: "Cannot GET /api/v1/public/links/open/lock", error: "Not Found" },
      },
    });
    await page.goto("/p/open");
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toBeVisible();
    await expect(page.getByText("That didn't load")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Continue/ })).toHaveCount(0);
  });

  test("flagged (?warning=unsafe) + previews off: the unsafe warning, no way on", async ({ page }) => {
    await mockApi(page, { "GET /public/links/open/preview": PREVIEWS_OFF, "GET /public/links/open/lock": LOCK_OPEN });
    await page.goto("/p/open?warning=unsafe");
    await expect(page.getByText("This link has been flagged as unsafe")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Continue/ })).toHaveCount(0);
    await expect(page.getByText("That didn't load")).toHaveCount(0);
  });

  test("a password-protected link keeps the password form (#762), not this state", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": { status: 200, body: { shortUrl: "snap.to/vault", passwordProtected: true } },
    });
    await page.goto("/p/vault?unlock=1");
    await expect(page.getByText("This link is password protected")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Continue/ })).toHaveCount(0);
    await expect(page.getByText(/Anyone can see this page/)).toHaveCount(0);
  });

  test("another 403 (not the owner's switch) stays the retryable error", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/open/preview": {
        status: 403,
        body: { statusCode: 403, message: "Forbidden resource", error: "Forbidden" },
      },
      "GET /public/links/open/lock": LOCK_OPEN,
    });
    await page.goto("/p/open");
    await expect(page.getByText("That didn't load")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toHaveCount(0);
    const before = api.callsTo("GET", "/public/links/open/preview").length;
    await page.getByRole("button", { name: /try again/i }).click();
    await expect.poll(() => api.callsTo("GET", "/public/links/open/preview").length).toBeGreaterThan(before);
  });

  test("an API outage stays the retryable error", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": { status: 500, body: { statusCode: 500, message: "Internal server error" } },
    });
    await page.goto("/p/open");
    await expect(page.getByText("That didn't load")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Previews are turned off" })).toHaveCount(0);
  });

  test("previews on: the full preview still carries the footer", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": {
        status: 200,
        body: {
          shortUrl: "snap.to/open",
          destination: "https://acme.com/pricing",
          passwordProtected: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: "Mock Workspace",
          verifiedDomain: true,
          safeBrowsing: "clean",
          scannedAt: "2026-01-01T00:00:00.000Z",
          setsCookies: false,
          redirectType: "302",
        },
      },
    });
    await page.goto("/p/open");
    await expect(page.getByText("Created by")).toBeVisible();
    await expect(page.getByText(/Anyone can see this page/)).toBeVisible();
  });
});
