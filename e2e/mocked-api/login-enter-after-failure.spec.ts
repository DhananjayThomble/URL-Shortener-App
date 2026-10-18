import { expect, test, type Page } from "@playwright/test";
import { fakeAccessToken, MOCK_USER, MOCK_WORKSPACE, mockApi, nestError, type MockReply } from "../support/mock-api";

/* #778 — Enter must keep working on /login after a failed attempt.

   QA saw: wrong password -> error -> Enter did nothing; clicking "Sign in" worked.

   Cause: the submit button is `disabled` while the request is in flight. A button
   that is clicked and then disabled drops keyboard focus to <body>, and it stays
   there after the error comes back — so the next Enter has no form to submit, and
   Shift+Tab starts from the end of the page instead of the field the user was in.
   Enter inside a field always worked; Enter right after a CLICKED failure did not.
   The page now puts focus (and the selection) back in the field the user has to
   fix — the password, or the code at the 2FA step — so Enter and typing just work.

   Replies copy the API:
     apps/api/src/auth/auth.controller.ts  POST /auth/login      -> LoginResult | 401 "Invalid email or password"
     apps/api/src/auth/auth.service.ts     POST /auth/2fa/verify -> AuthSession | 401 "That code isn't right. ..."
   Runs on desktop Chrome and Pixel 7. */

const GOOD_PASSWORD = "correct horse battery";
const BAD_LOGIN = "Invalid email or password";
const BAD_CODE = "That code isn't right. Try the next one from your app.";
const TOTP = "123456";

async function mockSignIn(page: Page, { twoFactor = false }: { twoFactor?: boolean } = {}) {
  let signedIn = false;
  const session = (): MockReply => {
    signedIn = true;
    return { status: 200, body: { accessToken: fakeAccessToken(), refreshToken: "mock.refresh.token", user: MOCK_USER } };
  };
  const authed = (body: unknown) => (): MockReply => (signedIn ? { status: 200, body } : nestError(401, "Unauthorized"));
  return mockApi(page, {
    "GET /auth/me": authed(MOCK_USER),
    "POST /auth/login": (req) => {
      if ((req.body as { password?: string })?.password !== GOOD_PASSWORD) return nestError(401, BAD_LOGIN);
      return twoFactor ? { status: 200, body: { challenge: "totp", challengeToken: "mock.challenge" } } : session();
    },
    "POST /auth/2fa/verify": (req) => ((req.body as { code?: string })?.code === TOTP ? session() : nestError(401, BAD_CODE)),
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
  });
}

type Api = Awaited<ReturnType<typeof mockSignIn>>;
const loginPasswords = (api: Api) => api.callsTo("POST", "/auth/login").map((c) => (c.body as { password: string }).password);
const verifyCodes = (api: Api) => api.callsTo("POST", "/auth/2fa/verify").map((c) => (c.body as { code: string }).code);

test.describe("Enter after a failed sign-in (#778)", () => {
  test("password step: after a failed CLICK, focus is back in the password field and Enter submits", async ({ page, baseURL }) => {
    const api = await mockSignIn(page);
    await page.goto("/login");
    const password = page.getByLabel("Password");
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await password.fill("wrong password 1");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(BAD_LOGIN)).toBeVisible();
    expect(loginPasswords(api)).toEqual(["wrong password 1"]);

    // Enter, with no click in between, is a real submission (the reported symptom) …
    await page.keyboard.press("Enter");
    await expect.poll(() => loginPasswords(api)).toEqual(["wrong password 1", "wrong password 1"]);
    await expect(page.getByText(BAD_LOGIN)).toBeVisible();
    // … because focus did not fall to <body> (the cause).
    await expect(password).toBeFocused();

    // … and the old text is selected, so typing replaces it: fix, Enter, signed in.
    await page.keyboard.type(GOOD_PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${baseURL}/links`);
    expect(loginPasswords(api)).toEqual(["wrong password 1", "wrong password 1", GOOD_PASSWORD]);
  });

  test("password step: Enter inside a field re-submits after every failed attempt (guard)", async ({ page, baseURL }) => {
    const api = await mockSignIn(page);
    await page.goto("/login");
    const email = page.getByPlaceholder("you@company.com");
    const password = page.getByLabel("Password");
    await email.fill(MOCK_USER.email);
    await password.fill("wrong password 1");
    await password.press("Enter");
    await expect(page.getByText(BAD_LOGIN)).toBeVisible();

    await password.fill("wrong password 2");
    await password.press("Enter");
    await expect.poll(() => loginPasswords(api)).toEqual(["wrong password 1", "wrong password 2"]);

    // Implicit submission works from the email field too.
    await password.fill(GOOD_PASSWORD);
    await email.press("Enter");
    await expect(page).toHaveURL(`${baseURL}/links`);
    expect(loginPasswords(api)).toEqual(["wrong password 1", "wrong password 2", GOOD_PASSWORD]);
  });

  test("2FA step: after a failed CLICK on Verify, focus is back in the code field and Enter submits", async ({ page, baseURL }) => {
    const api = await mockSignIn(page, { twoFactor: true });
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByLabel("Password").fill(GOOD_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toBeFocused();

    await code.fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(BAD_CODE)).toBeVisible();
    expect(verifyCodes(api)).toEqual(["000000"]);

    // Enter with no click in between re-sends the code (the reported symptom) …
    await page.keyboard.press("Enter");
    await expect.poll(() => verifyCodes(api)).toEqual(["000000", "000000"]);
    await expect(page.getByText(BAD_CODE)).toBeVisible();
    // … because focus did not fall to <body> (the cause).
    await expect(code).toBeFocused();

    // … and typing replaces the selected wrong code.
    await page.keyboard.type(TOTP);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${baseURL}/links`);
    expect(verifyCodes(api)).toEqual(["000000", "000000", TOTP]);
  });

  test("2FA step: Enter inside the code field re-submits after a wrong code (guard)", async ({ page, baseURL }) => {
    const api = await mockSignIn(page, { twoFactor: true });
    await page.goto("/login");
    await page.getByPlaceholder("you@company.com").fill(MOCK_USER.email);
    await page.getByLabel("Password").fill(GOOD_PASSWORD);
    await page.keyboard.press("Enter");
    const code = page.getByRole("textbox", { name: "Authentication code" });
    await expect(code).toBeVisible();

    await code.fill("000000");
    await code.press("Enter");
    await expect(page.getByText(BAD_CODE)).toBeVisible();
    await code.fill("111111");
    await code.press("Enter");
    await expect.poll(() => verifyCodes(api)).toEqual(["000000", "111111"]);
    await code.fill(TOTP);
    await code.press("Enter");
    await expect(page).toHaveURL(`${baseURL}/links`);
    expect(verifyCodes(api)).toEqual(["000000", "111111", TOTP]);
  });
});
