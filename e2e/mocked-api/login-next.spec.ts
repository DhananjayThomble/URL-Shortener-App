import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, seedMockSession, type MockReply } from "../support/mock-api";

/* #775 — signing in after a protected deep link lands on the page you asked for.

   The (app) layout guard used to `router.replace("/login")`, dropping the path,
   so every sign-in ended on /links. It now sends `/login?next=<path+query+hash>`
   (web/src/lib/safe-next.ts#loginRedirectFor) and the login page already honours
   a SAFE `next` (safeNext, #668/#699) after the password step AND the 2FA step.

   The guard's decision lives in the real API client + React Query layer (a 401
   from GET /auth/me), which fixtures mode bypasses — hence this lane. Replies
   copy what the API sends:
     apps/api/src/auth/auth.controller.ts  POST /auth/login     -> LoginResult (AuthSession | TotpChallenge)
     apps/api/src/auth/auth.controller.ts  POST /auth/2fa/verify -> AuthSession
     apps/api/src/auth/jwt guard           GET  /auth/me (no token) -> 401 "Unauthorized"
   Runs on desktop Chrome, Pixel 7 and iPhone 15 (playwright.mocked-api.config.ts). */

const TARGET = "/settings?section=security&from=email#two-factor";
const TARGET_NEXT = encodeURIComponent(TARGET);

type Mode = { twoFactor?: boolean };

/** A signed-out visitor who becomes signed in once POST /auth/login (or the 2FA verify) succeeds. */
async function mockSignIn(page: Page, { twoFactor = false }: Mode = {}) {
  let signedIn = false;
  const session = (): MockReply => {
    signedIn = true;
    return {
      status: 200,
      body: { accessToken: fakeAccessToken(), refreshToken: "mock.refresh.token", user: MOCK_USER },
    };
  };
  const authed = (body: unknown) => (): MockReply =>
    signedIn ? { status: 200, body } : nestError(401, "Unauthorized");
  return mockApi(page, {
    "GET /auth/me": authed(MOCK_USER),
    "POST /auth/login": () =>
      twoFactor ? { status: 200, body: { challenge: "totp", challengeToken: "mock.challenge" } } : session(),
    "POST /auth/2fa/verify": (req) =>
      (req.body as { code?: string })?.code === "123456"
        ? session()
        : nestError(401, "That code isn't right. Try the next one from your app."),
    "GET /workspaces/current": authed(MOCK_WORKSPACE),
    "GET /auth/workspaces": authed([
      { id: MOCK_WORKSPACE.id, name: MOCK_WORKSPACE.name, initials: MOCK_WORKSPACE.initials, role: "owner", current: true },
    ]),
    "GET /links": authed({ items: [], total: 0, nextCursor: null }),
    "GET /bio-pages": authed([]),
    "GET /domains": authed([]),
    "GET /members": authed([]),
    "GET /api-keys": authed([]),
    "GET /webhooks": authed([]),
    "POST /auth/logout": { status: 204 },
  });
}

/** Every URL the main frame visited, so a spec can prove it never passed through /links. */
function recordNavigations(page: Page): string[] {
  const urls: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) urls.push(f.url());
  });
  return urls;
}

async function signIn(page: Page) {
  await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
  await page.getByPlaceholder("••••••••").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in" }).click();
}

const pathOf = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}${u.hash}`;
};

test.describe("login ?next= from a protected deep link (#775)", () => {
  test("signed out on a deep link -> /login?next=<page> -> sign in -> back on that exact page", async ({ page, baseURL }) => {
    const api = await mockSignIn(page);
    const seen = recordNavigations(page);

    await page.goto(TARGET);
    await expect(page).toHaveURL(`${baseURL}/login?next=${TARGET_NEXT}`);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await signIn(page);
    await expect(page).toHaveURL(`${baseURL}${TARGET}`);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    expect(api.callsTo("POST", "/auth/login")).toHaveLength(1);
    // Straight there: the dashboard home was never an intermediate stop.
    expect(seen.map(pathOf).filter((p) => p.startsWith("/links"))).toEqual([]);
    // `replace`, not `push`: Back does not return to the signed-out deep link
    // that bounced, it leaves the app's login step behind too.
    expect(seen.map(pathOf)).toContain(`/login?next=${TARGET_NEXT}`);
  });

  test("a link-detail deep link survives the round trip", async ({ page, baseURL }) => {
    await mockSignIn(page);
    await page.goto("/links/lnk_abc123?tab=routing");
    await expect(page).toHaveURL(`${baseURL}/login?next=${encodeURIComponent("/links/lnk_abc123?tab=routing")}`);
    await signIn(page);
    await expect(page).toHaveURL(`${baseURL}/links/lnk_abc123?tab=routing`);
  });

  test("the 2FA step keeps next: password -> code -> back on the deep link", async ({ page, baseURL }) => {
    const api = await mockSignIn(page, { twoFactor: true });

    await page.goto(TARGET);
    await expect(page).toHaveURL(`${baseURL}/login?next=${TARGET_NEXT}`);
    await signIn(page);

    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toBeVisible();
    // The challenge step is the same /login?next=… page — next is not lost.
    await expect(page).toHaveURL(`${baseURL}/login?next=${TARGET_NEXT}`);

    // A wrong code keeps us on the challenge, still carrying next.
    await code.fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText("That code isn't right. Try the next one from your app.")).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/login?next=${TARGET_NEXT}`);

    await code.fill("123456");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(`${baseURL}${TARGET}`);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    expect(api.callsTo("POST", "/auth/2fa/verify")).toHaveLength(2);
  });

  /* Hostile `next` values a phisher could put in a /login link. Each must land
     on /links on OUR origin — never another host, never a javascript: URL. */
  const HOSTILE = [
    "https://evil.example/links",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(document.domain)",
    "%2F%2Fevil.example", // decoded once by URLSearchParams -> "%2F%2F…" still not a path
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/..//evil.example",
    "/%2e%2e//evil.example",
    "/links\r\nSet-Cookie: x=1",
    "/links%0d%0aSet-Cookie:x=1",
  ];

  test("a hostile next falls back to /links on our own origin", async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    await mockSignIn(page);
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
      await signIn(page);
      await expect(page, `next=${JSON.stringify(next)}`).toHaveURL(`${baseURL}/links`);
      // Sign out between vectors so the next /login starts signed out again.
      await page.evaluate(() => window.localStorage.clear());
    }
    expect(offSite).toEqual([]);
  });

  test("already signed in: the deep link opens directly, no /login bounce", async ({ page, baseURL }) => {
    await seedMockSession(page);
    const api = await mockApi(page, {
      "GET /auth/me": { status: 200, body: MOCK_USER },
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
    });
    const seen = recordNavigations(page);

    await page.goto(TARGET);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}${TARGET}`);
    expect(seen.map(pathOf).filter((p) => p.startsWith("/login"))).toEqual([]);
    expect(api.callsTo("POST", "/auth/login")).toHaveLength(0);
  });

  test("a deliberate sign-out goes to a bare /login — it does not remember the page", async ({ page, baseURL }) => {
    await mockSignIn(page);
    await page.goto(TARGET);
    await signIn(page);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    // …and stays bare: no late guard redirect rewrites it to ?next=.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(`${baseURL}/login`);
  });
});
