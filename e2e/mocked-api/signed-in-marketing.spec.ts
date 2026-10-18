import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, seedMockSession, type MockReply } from "../support/mock-api";

/* #777 — a signed-in visitor on a marketing page still saw "Sign in / Start free",
   and /login and /register showed their forms instead of going to the dashboard.

   Two mechanisms, both visible only against the REAL web app + API client (which
   fixtures mode bypasses — hence this lane):
     - The marketing pages are static, so the header cannot know the session at
       build time. A pre-paint script in the root layout reads the stored tokens
       (the cheapest signal there is — NO API call) and marks <html data-auth="in">;
       CSS then shows "Go to dashboard" instead of Sign in / Start free.
     - /login and /register verify the session with GET /auth/me before
       redirecting (a stored token alone may be expired -> would loop), honouring a
       safe ?next= (safeNext, #775).

   Replies copy what the API sends (same sources as login-next.spec.ts):
     GET /auth/me  expired/no token -> 401 {"message":"Unauthorized"}
     POST /auth/refresh with a dead refresh token -> 401
   Runs on desktop Chrome and Pixel 7 (playwright.mocked-api.config.ts). */

const HEADER = "header";

/** Everything the dashboard shell fetches after /auth/me, answered as an authenticated user. */
function dashboard(): Record<string, MockReply> {
  return {
    "GET /workspaces/current": { status: 200, body: MOCK_WORKSPACE },
    "GET /auth/workspaces": {
      status: 200,
      body: [{ id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true }],
    },
    "GET /links": { status: 200, body: { items: [], total: 0, nextCursor: null } },
    "GET /bio-pages": { status: 200, body: [] },
    "GET /domains": { status: 200, body: [] },
    "GET /members": { status: 200, body: [] },
    "GET /api-keys": { status: 200, body: [] },
    "GET /webhooks": { status: 200, body: [] },
  };
}

/** A fully working session: /auth/me answers. */
const validSession = (): Record<string, MockReply> => ({ "GET /auth/me": { status: 200, body: MOCK_USER }, ...dashboard() });

/** A session whose tokens are dead: /auth/me and /auth/refresh both 401 (what the API sends). */
const expiredSession = (): Record<string, MockReply> => ({
  "GET /auth/me": nestError(401, "Unauthorized"),
  "POST /auth/refresh": nestError(401, "Unauthorized"),
});

/**
 * Samples every frame and remembers whether the WRONG header controls were ever
 * painted: `.auth-out` (Sign in / Start free) when `signedIn`, `.auth-in` when not.
 * Lets a spec assert "no flash", which a final-state check cannot.
 */
async function watchHeaderFlash(page: Page, signedIn: boolean) {
  await page.addInitScript(
    ([wrong]) => {
      (window as unknown as { __wrongHeaderPainted: boolean }).__wrongHeaderPainted = false;
      const tick = () => {
        for (const el of document.querySelectorAll(`header .${wrong}`)) {
          if (getComputedStyle(el).display !== "none") (window as unknown as { __wrongHeaderPainted: boolean }).__wrongHeaderPainted = true;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [signedIn ? "auth-out" : "auth-in"] as const,
  );
}

const wrongHeaderPainted = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wrongHeaderPainted: boolean }).__wrongHeaderPainted);

/** On a phone the header controls live in the hamburger menu. */
async function openMenuIfMobile(page: Page) {
  const burger = page.getByRole("button", { name: "Open menu" });
  if (!(await burger.isVisible())) return;
  const menu = page.locator("#mobile-menu");
  // The button is server-rendered, so a click before hydration is lost: retry until the menu is really open.
  await expect(async () => {
    if (!(await menu.isVisible())) await burger.click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass();
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}${u.hash}`;
};

function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (f) => {
    // Next.js re-writes the current URL once on hydration (a same-document "navigation");
    // that is not a visit.
    if (f === page.mainFrame() && urls[urls.length - 1] !== f.url()) urls.push(f.url());
  });
  return urls;
}

/** Samples every frame for the sign-in form (the password field). */
async function watchLoginFormPaint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __formPainted: boolean }).__formPainted = false;
    const tick = () => {
      if (document.querySelector('input[type="password"]')) (window as unknown as { __formPainted: boolean }).__formPainted = true;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const formPainted = (page: Page) => page.evaluate(() => (window as unknown as { __formPainted: boolean }).__formPainted);

const MARKETING = ["/", "/pricing", "/product", "/self-host", "/for-developers"];

test.describe("marketing header reflects the session (#777)", () => {
  test("signed out: Sign in + Start free, no Go to dashboard, no API call", async ({ page }) => {
    const api = await mockApi(page, {});
    await watchHeaderFlash(page, false);
    await page.goto("/");
    await openMenuIfMobile(page);

    const header = page.locator(HEADER).first();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Start free" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
    expect(await wrongHeaderPainted(page)).toBe(false);
    expect(api.calls).toEqual([]);
  });

  for (const path of MARKETING) {
    test(`signed in: ${path} shows Go to dashboard instead of Sign in / Start free — no flash, no API call`, async ({ page }) => {
      await seedMockSession(page);
      const api = await mockApi(page, validSession());
      await watchHeaderFlash(page, true);
      await page.goto(path);
      await openMenuIfMobile(page);

      const header = page.locator(HEADER).first();
      const dash = header.getByRole("link", { name: "Go to dashboard" });
      await expect(dash).toBeVisible();
      await expect(dash).toHaveAttribute("href", "/links");
      await expect(header.getByRole("link", { name: "Sign in" })).toHaveCount(0);
      await expect(header.getByRole("link", { name: "Start free" })).toHaveCount(0);
      // The wrong controls were never painted, not even for a frame…
      expect(await wrongHeaderPainted(page)).toBe(false);
      // …and finding out cost nothing: the static page made no API request.
      expect(api.calls).toEqual([]);
    });
  }

  test("signed in: Go to dashboard really opens the dashboard", async ({ page, baseURL }) => {
    await seedMockSession(page);
    await mockApi(page, validSession());
    await page.goto("/");
    await openMenuIfMobile(page);
    await page.locator(HEADER).first().getByRole("link", { name: "Go to dashboard" }).click();
    await expect(page).toHaveURL(`${baseURL}/links`);
    await expect(page.getByRole("heading", { name: "Links", exact: true })).toBeVisible();
  });

  test("expired session: the header says Go to dashboard, the click ends on /login (cleared, no loop), and the header recovers", async ({
    page,
    baseURL,
  }) => {
    await seedMockSession(page);
    const api = await mockApi(page, expiredSession());
    const seen = recordNavigations(page);
    await page.goto("/");
    await openMenuIfMobile(page);
    // The hint is only a hint — it cannot know the tokens are dead. No request was made to find out.
    await page.locator(HEADER).first().getByRole("link", { name: "Go to dashboard" }).click();

    // The dashboard guard proves it dead, clears the tokens and sends the visitor to sign in carrying where they were going.
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent("/links")}`);
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    expect(await page.evaluate(() => [localStorage.getItem("snapurl.accessToken"), localStorage.getItem("snapurl.refreshToken")])).toEqual([null, null]);

    // Settled: no bounce between /login and /links.
    const before = seen.length;
    await page.waitForTimeout(1_500);
    expect(seen.length).toBe(before);
    expect(seen.map(pathOf).filter((p) => p === "/links")).toHaveLength(1);
    expect(api.callsTo("GET", "/auth/me")).toHaveLength(1);

    // Back on the marketing site (client-side nav via the logo) the header is signed-out again.
    await page.getByRole("link", { name: "SnapURL" }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await openMenuIfMobile(page);
    const header = page.locator(HEADER).first();
    await expect(header.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(header.getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
  });

  test("signing in client-side flips the header with no reload; another tab signing out flips it back", async ({ page, baseURL }) => {
    let signedIn = false;
    const authed = (body: unknown) => (): MockReply => (signedIn ? { status: 200, body } : nestError(401, "Unauthorized"));
    await mockApi(page, {
      ...Object.fromEntries(Object.entries(dashboard()).map(([k, v]) => [k, authed(v.body)])),
      "GET /auth/me": authed(MOCK_USER),
      "POST /auth/login": () => {
        signedIn = true;
        return { status: 200, body: { accessToken: fakeAccessToken(), refreshToken: "mock.refresh.token", user: MOCK_USER } };
      },
      "POST /auth/logout": { status: 204 },
    });

    // Sign in on /login with next=/pricing: router.push lands on a MARKETING page client-side, so
    // the pre-paint script never saw the tokens — the header must follow tokens.set().
    await page.goto(`/login?next=${encodeURIComponent("/pricing")}`);
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByPlaceholder("••••••••").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${baseURL}/pricing`);
    await openMenuIfMobile(page);
    await expect(page.locator(HEADER).first().getByRole("link", { name: "Go to dashboard" })).toBeVisible();
    await expect(page.locator(HEADER).first().getByRole("link", { name: "Sign in" })).toHaveCount(0);

    // Sign out in another tab: this tab's header follows via the storage event, no reload.
    const other = await page.context().newPage();
    await other.goto("/pricing");
    await other.evaluate(() => localStorage.clear());
    await other.close();
    await expect(page.locator(HEADER).first().getByRole("link", { name: "Go to dashboard" })).toHaveCount(0);
    await expect(page.locator(HEADER).first().getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});

test.describe("/login and /register redirect a signed-in visitor (#777)", () => {
  for (const route of ["/login", "/register"]) {
    test(`${route}: valid session -> dashboard, form never painted`, async ({ page, baseURL }) => {
      await seedMockSession(page);
      const api = await mockApi(page, validSession());
      await watchLoginFormPaint(page);
      const seen = recordNavigations(page);
      await page.goto(route);
      await expect(page).toHaveURL(`${baseURL}/links`);
      await expect(page.getByRole("heading", { name: "Links", exact: true })).toBeVisible();
      expect(await formPainted(page)).toBe(false);
      expect(api.callsTo("GET", "/auth/me")).toHaveLength(1);
      expect(api.callsTo("POST", "/auth/login")).toHaveLength(0);
      // replace, not push: Back does not return to a page that only redirects.
      expect(seen.map(pathOf).filter((p) => p === route)).toHaveLength(1);
      await page.goBack();
      await expect(page).not.toHaveURL(`${baseURL}${route}`);
    });

    test(`${route}: honours a safe ?next=`, async ({ page, baseURL }) => {
      await seedMockSession(page);
      await mockApi(page, validSession());
      const target = "/settings?section=security#two-factor";
      await page.goto(`${route}?next=${encodeURIComponent(target)}`);
      await expect(page).toHaveURL(`${baseURL}${target}`);
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    });
  }

  /* A phisher's /login?next=… link, opened by someone already signed in: the redirect itself must not leave the origin. */
  const HOSTILE = [
    "https://evil.example/links",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(document.domain)",
    "/%2F%2Fevil.example",
    "/..//evil.example",
    "/login", // an auth page is not a destination (would loop)
    "/register?next=%2Flogin",
  ];
  test("a hostile or self-referential next goes to /links on our own origin", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await seedMockSession(page);
    await mockApi(page, validSession());
    const origin = new URL(baseURL!).origin;
    const offSite: string[] = [];
    page.on("request", (r) => {
      if (r.isNavigationRequest() && new URL(r.url()).origin !== origin) offSite.push(r.url());
    });
    page.on("dialog", (d) => {
      offSite.push(`dialog:${d.message()}`);
      void d.dismiss();
    });
    for (const next of HOSTILE) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(page, `next=${JSON.stringify(next)}`).toHaveURL(`${baseURL}/links`);
    }
    expect(offSite).toEqual([]);
  });

  test("signed out: the form shows and no session request is made", async ({ page, baseURL }) => {
    const api = await mockApi(page, {});
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.goto("/register");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(api.calls).toEqual([]);
    expect(pathOf(page.url())).toBe("/register");
    expect(baseURL).toBeTruthy();
  });

  for (const route of ["/login", "/register"]) {
    test(`${route}: EXPIRED session shows the form, clears the dead tokens and does not loop`, async ({ page, baseURL }) => {
      await seedMockSession(page);
      const api = await mockApi(page, expiredSession());
      const seen = recordNavigations(page);
      await page.goto(`${route}?next=${encodeURIComponent("/analytics")}`);

      await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
      expect(await page.evaluate(() => [localStorage.getItem("snapurl.accessToken"), localStorage.getItem("snapurl.refreshToken")])).toEqual([null, null]);
      // The client tried to refresh once, found it dead, and stopped.
      expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);

      const before = seen.length;
      await page.waitForTimeout(1_500);
      expect(seen.length).toBe(before);
      await expect(page).toHaveURL(`${baseURL}${route}?next=${encodeURIComponent("/analytics")}`);
      expect(api.callsTo("GET", "/auth/me")).toHaveLength(1); // refresh failed, so no retry
      expect(seen.map(pathOf).filter((p) => p.startsWith("/analytics") || p === "/links")).toEqual([]);
    });
  }

  test("an access token that merely EXPIRED but has a live refresh token is refreshed and redirected", async ({ page, baseURL }) => {
    await seedMockSession(page, "stale.access.token", "live.refresh.token");
    const api = await mockApi(page, {
      ...validSession(),
      // First /auth/me carries the stale access token -> 401; after the refresh it is good.
      "GET /auth/me": (_req, nth) => (nth === 1 ? nestError(401, "Unauthorized") : { status: 200, body: MOCK_USER }),
      "POST /auth/refresh": { status: 200, body: { accessToken: fakeAccessToken(), refreshToken: "rotated.refresh.token" } },
    });
    await page.goto("/login");
    await expect(page).toHaveURL(`${baseURL}/links`);
    expect(api.callsTo("POST", "/auth/refresh")).toHaveLength(1);
  });

  test("API down (500 on /auth/me): the form is shown, tokens are kept, and nothing bounces", async ({ page, baseURL }) => {
    await seedMockSession(page);
    const api = await mockApi(page, { "GET /auth/me": { status: 500, body: { statusCode: 500, message: "Internal server error" } } });
    const seen = recordNavigations(page);
    await page.goto("/login");
    await expect(page.getByPlaceholder("you@company.com")).toBeVisible();
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(`${baseURL}/login`);
    expect(seen.map(pathOf)).toEqual(["/login"]);
    expect(api.callsTo("GET", "/auth/me")).toHaveLength(1);
    // A transient outage must not sign the visitor out.
    expect(await page.evaluate(() => localStorage.getItem("snapurl.refreshToken"))).toBe("mock.refresh.token");
  });

  test("after an expired-session probe fails, signing in on the same page navigates once", async ({ page, baseURL }) => {
    await seedMockSession(page);
    let signedIn = false;
    const api = await mockApi(page, {
      ...Object.fromEntries(Object.entries(dashboard()).map(([k, v]) => [k, () => (signedIn ? v : nestError(401, "Unauthorized"))])),
      "GET /auth/me": () => (signedIn ? { status: 200, body: MOCK_USER } : nestError(401, "Unauthorized")),
      "POST /auth/refresh": nestError(401, "Unauthorized"),
      "POST /auth/login": () => {
        signedIn = true;
        return { status: 200, body: { accessToken: fakeAccessToken(), refreshToken: "mock.refresh.token", user: MOCK_USER } };
      },
    });
    const seen = recordNavigations(page);
    await page.goto("/login?next=%2Fanalytics");
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByPlaceholder("••••••••").fill("correct horse battery");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(`${baseURL}/analytics`);
    await page.waitForTimeout(500);
    expect(api.callsTo("POST", "/auth/login")).toHaveLength(1);
    expect(seen.map(pathOf).filter((p) => p === "/analytics")).toHaveLength(1);
  });
});
