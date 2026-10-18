import { expect, test, type Page } from "@playwright/test";
import { mockApi, type MockReply } from "../support/mock-api";

/* E2E (#762): a password-protected link can be unlocked when the owner has
   turned public previews off.

   With previews off, GET /public/links/:slug/preview answers 403
   (apps/api/src/public/public.service.ts, "The owner of this link has turned off
   public previews."). The page used to render the password form only from a
   successful preview, so the redirect's ?unlock=1 bounce landed on "That didn't
   load" and the link could not be opened at all.

   Oracle: PublicLinkLock (packages/contract/src/public.ts) — GET
   /public/links/:slug/lock is not gated by the previews switch and carries the
   short URL and whether a password guards it, never the destination. Unlock
   (POST …/unlock) returns a token the redirect checks.

   Every reply below copies a status and message PublicService really sends. */

const SECRET = "https://acme.com/private-board-deck";
const PREVIEWS_OFF: MockReply = {
  status: 403,
  body: { statusCode: 403, message: "The owner of this link has turned off public previews.", error: "Forbidden" },
};
const LOCK = { status: 200, body: { shortUrl: "snap.to/vault", passwordProtected: true } };
/* #800 — a hostile/old API that smuggles a destination into the lock reply.
   PublicService.lock never does this, but the page must not render whatever a
   lock reply happens to carry, so the no-leak assertions below have teeth. */
const LOCK_WITH_SECRET: MockReply = {
  status: 200,
  body: { shortUrl: "snap.to/vault", passwordProtected: true, destination: SECRET },
};
const NO_SUCH_ROUTE: MockReply = {
  status: 404,
  body: { statusCode: 404, message: "Cannot GET /api/v1/public/links/vault/lock", error: "Not Found" },
};

async function standInForRedirect(page: Page): Promise<() => string> {
  let redirectedTo = "";
  await page.route("https://snap.to/**", async (route) => {
    redirectedTo = route.request().url();
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>redirect</p>" });
  });
  return () => redirectedTo;
}

async function expectPasswordForm(page: Page) {
  await expect(page.getByText("This link is password protected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock and continue" })).toBeVisible();
  await expect(page.getByText(/Hidden until you enter the password/)).toBeVisible();
  await expect(page.getByText("snap.to/vault")).toBeVisible();
  // Nothing the previews switch hides, and no way round the password.
  await expect(page.getByText("Created by")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Continue( anyway)? to / })).toHaveCount(0);
  await expect(page.getByText("That didn't load")).toHaveCount(0);
}

test.describe("public trust page: previews off, password-protected link (#762)", () => {
  test("arriving from the redirect shows the password form, focused", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
    });
    await page.goto("/p/vault?unlock=1");
    await expectPasswordForm(page);
    await expect(page.getByPlaceholder("Password")).toBeFocused();
  });

  test("the right password (click) goes back through the short link with an unlock token", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
      "POST /public/links/vault/unlock": { status: 200, body: { unlockToken: "tok_762", expiresIn: 300 } },
    });
    const redirectedTo = await standInForRedirect(page);

    await page.goto("/p/vault?unlock=1");
    await page.getByPlaceholder("Password").fill("hunter2");
    await page.getByRole("button", { name: "Unlock and continue" }).click();

    await expect.poll(redirectedTo).toBe("https://snap.to/vault?k=tok_762");
    expect(api.callsTo("POST", "/public/links/vault/unlock")).toHaveLength(1);
    expect(api.callsTo("POST", "/public/links/vault/unlock")[0]?.body).toEqual({ password: "hunter2" });
  });

  test("Enter submits too", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
      "POST /public/links/vault/unlock": { status: 200, body: { unlockToken: "tok_enter", expiresIn: 300 } },
    });
    const redirectedTo = await standInForRedirect(page);
    await page.goto("/p/vault?unlock=1");
    await page.getByPlaceholder("Password").fill("hunter2");
    await page.getByPlaceholder("Password").press("Enter");
    await expect.poll(redirectedTo).toBe("https://snap.to/vault?k=tok_enter");
  });

  test("a wrong password says so and stays on the page, without the destination", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      // A lock reply that smuggles a destination: the page must never render it.
      "GET /public/links/vault/lock": LOCK_WITH_SECRET,
      "POST /public/links/vault/unlock": {
        status: 401,
        body: { statusCode: 401, message: "That password isn't right.", error: "Unauthorized" },
      },
    });
    await page.goto("/p/vault?unlock=1");
    expect(await page.content()).not.toContain(SECRET);
    await page.getByPlaceholder("Password").fill("nope");
    await page.getByRole("button", { name: "Unlock and continue" }).click();
    await expect(page.getByText("That password isn't right.")).toBeVisible();
    await expect(page).toHaveURL(/\/p\/vault\?unlock=1$/);
    expect(await page.content()).not.toContain(SECRET);
  });

  test("an empty password cannot be submitted", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
    });
    await page.goto("/p/vault?unlock=1");
    await expect(page.getByRole("button", { name: "Unlock and continue" })).toBeDisabled();
    await page.getByPlaceholder("Password").press("Enter");
    expect(api.callsTo("POST", "/public/links/vault/unlock")).toHaveLength(0);
  });

  test("rate-limited unlock tells the visitor to wait", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
      "POST /public/links/vault/unlock": {
        status: 429,
        body: { statusCode: 429, message: "ThrottlerException: Too Many Requests" },
      },
    });
    await page.goto("/p/vault?unlock=1");
    await page.getByPlaceholder("Password").fill("x");
    await page.getByRole("button", { name: "Unlock and continue" }).click();
    await expect(page.getByText("Too many requests. Wait a moment and try again.")).toBeVisible();
  });

  test('the "+" preview of a protected link with previews off also offers the form', async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK,
    });
    await page.goto("/p/vault");
    await expectPasswordForm(page);
  });

  test("previews off, no password: the previews-off error, no password form", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/open/preview": PREVIEWS_OFF,
      "GET /public/links/open/lock": { status: 200, body: { shortUrl: "snap.to/open", passwordProtected: false } },
    });
    await page.goto("/p/open?unlock=1");
    await expect(page.getByText("That didn't load")).toBeVisible();
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
  });

  test("deploy skew — API without the lock route: the previews-off error, no crash, no form", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": NO_SUCH_ROUTE,
    });
    await page.goto("/p/vault?unlock=1");
    await expect(page.getByText("That didn't load")).toBeVisible();
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
  });

  test("previews on: the lock route is never called", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/vault/preview": {
        status: 200,
        body: {
          shortUrl: "snap.to/vault",
          destination: null,
          passwordProtected: true,
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
    await page.goto("/p/vault?unlock=1");
    await expect(page.getByText("Created by")).toBeVisible();
    await expect(page.getByText("This link is password protected")).toBeVisible();
    expect(api.callsTo("GET", "/public/links/vault/lock")).toHaveLength(0);
  });

  test("an unknown slug: the 404 message, and no lock call", async ({ page }) => {
    const api = await mockApi(page, {
      "GET /public/links/ghost/preview": {
        status: 404,
        body: { statusCode: 404, message: "That link doesn't exist.", error: "Not Found" },
      },
    });
    await page.goto("/p/ghost?unlock=1");
    await expect(page.getByText("That link doesn't exist.")).toBeVisible();
    expect(api.callsTo("GET", "/public/links/ghost/lock")).toHaveLength(0);
  });

  /* #800 (opus item 3) — a flagged, password-protected link with previews off.
     The redirect's flagged gate runs before the password gate, so it bounces
     here as ?warning=unsafe and would bounce back even with the right password.
     The lock view must therefore show the unsafe warning and NO password form,
     or the visitor is stuck in a loop. */
  test("flagged + protected + previews off: the unsafe warning, no password form", async ({ page }) => {
    await mockApi(page, {
      "GET /public/links/vault/preview": PREVIEWS_OFF,
      "GET /public/links/vault/lock": LOCK_WITH_SECRET,
    });
    await page.goto("/p/vault?unlock=1&warning=unsafe");
    // The warning is shown; the form is not.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("This link is password protected")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unlock and continue" })).toHaveCount(0);
    await expect(page.getByPlaceholder("Password")).toHaveCount(0);
    // Still the short link, and still never the smuggled destination.
    await expect(page.getByText("snap.to/vault")).toBeVisible();
    expect(await page.content()).not.toContain(SECRET);
  });
});
