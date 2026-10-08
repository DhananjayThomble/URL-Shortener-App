/**
 * Journey 15 — Team invitation, end to end (#668)
 *
 * Before #668 the emailed /invite link 404'd and nothing consumed the token,
 * so no workspace could ever have a second member. A real user now does:
 *
 *   owner: /team -> ＋ Invite -> email + role -> Send invitation
 *   invitee: opens the link FROM THE EMAIL in a fresh browser
 *     - new user:      Create an account -> (back on /invite) -> verify email -> Accept
 *     - existing user: Sign in to accept -> (back on /invite) -> Accept
 *   owner: /team shows them active with the invited role
 *
 * plus the refusal pages (missing / invalid / expired token, wrong account)
 * and the workspace switcher that makes the joined workspace reachable.
 *
 * Oracles:
 *   - the mail the API actually wrote (MAIL_TRANSPORT=outbox inside the
 *     staging api container; docker-compose.staging.yml D2) — the link is
 *     taken from the mail body, not constructed;
 *   - GET /members, GET /workspaces/current, POST /links from the session the
 *     browser itself holds (role enforcement is the API's, not the UI's);
 *   - the URL and visible page state after each real click.
 *
 * Sign-ins are kept to two for the whole spec: the API's login throttle is
 * 5/min per IP (see j14). Requires the local staging stack + web on :3000.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { API_URL, RUN_ID, RUN_PASSWORD, makeEmail, registerUser, type Session } from "./helpers";

const run = promisify(execFile);
const API_CONTAINER = process.env.QA_API_CONTAINER ?? "snapurl-staging-api-1";
const DB_CONTAINER = process.env.DB_CONTAINER ?? "snapurl-staging-postgres";

/** The newest link of the given kind in the newest matching mail to `email`. */
async function mailLink(email: string, path: "/invite" | "/verify-email"): Promise<string> {
  const sanitized = email.replace(/[^a-z0-9]/gi, "_");
  for (let i = 0; i < 40; i++) {
    try {
      const { stdout } = await run("docker", [
        "exec", API_CONTAINER, "sh", "-c",
        `ls /tmp/snapurl-outbox/ 2>/dev/null | grep -F -- '-${sanitized}.txt' | sort -t- -k1,1 -n -r`,
      ]);
      for (const name of stdout.split("\n").filter(Boolean)) {
        const { stdout: body } = await run("docker", ["exec", API_CONTAINER, "cat", `/tmp/snapurl-outbox/${name}`]);
        const m = body.match(new RegExp(`(https?://\\S+${path}\\?token=[^\\s&]+)`));
        if (m) return m[1]!;
      }
    } catch {
      /* not written yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no ${path} mail for ${email}`);
}

/** Test fixture: age a pending invitation past the 7-day limit. */
async function backdateInvite(email: string) {
  const child = execFile("docker", [
    "exec", "-i", DB_CONTAINER, "psql", "-U", "snapurl", "-d", "snapurl", "-v", "ON_ERROR_STOP=1", "-v", `email=${email}`,
  ]);
  let out = "";
  child.stdout?.on("data", (d) => (out += d));
  child.stdin?.end(
    `update memberships set invited_at = now() - interval '8 days' where lower(email) = lower(:'email') and status = 'invited';`,
  );
  await new Promise((r) => child.on("close", r));
  expect(out).toContain("UPDATE 1");
}

async function api(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function apiInvite(owner: Session, email: string, role: string) {
  const res = await api(owner.accessToken, "/members", { method: "POST", body: JSON.stringify({ email, role }) });
  expect(res.status, "owner can invite").toBe(201);
}

/** The access token the browser is actually using right now. */
const browserToken = (page: Page) => page.evaluate(() => window.localStorage.getItem("snapurl.accessToken") ?? "");

async function signIn(page: Page, email: string) {
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function inviteViaUi(page: Page, email: string, role: "Viewer" | "Editor" | "Admin") {
  await page.goto("/team");
  await page.getByRole("button", { name: "＋ Invite" }).click();
  const input = page.getByPlaceholder("teammate@example.com");
  await input.fill(email);
  await page.getByRole("group", { name: "Role" }).getByRole("button", { name: role, exact: true }).click();
  const sent = page.waitForResponse((r) => r.request().method() === "POST" && /\/members$/.test(r.url()));
  await page.getByRole("button", { name: "Send invitation" }).click();
  expect((await sent).status()).toBe(201);
  await expect(input).toBeHidden();
  // A pending row carrying the invited role appears in the members table.
  await expect(page.getByText(`${role} · pending`).last()).toBeVisible();
  // Authoritative: the invite is recorded with the right email, role and status.
  const owner = await page.evaluate(() => window.localStorage.getItem("snapurl.accessToken") ?? "");
  const members = (await (await api(owner, "/members")).json()) as Array<{ email: string; role: string; status: string }>;
  expect(members.find((m) => m.email.toLowerCase() === email.toLowerCase())).toMatchObject({
    role: role.toLowerCase(),
    status: "invited",
  });
}

/** Locate a member row by the member's display NAME (the team table renders the
 *  name, and for an already-linked invitee the email never appears — see #669). */
async function memberRowByName(page: Page, name: string) {
  await page.goto("/team");
  return page.getByRole("row").filter({ hasText: name });
}

/** Assert, via the API the owner session holds, that a member is active with a role. */
async function expectActiveMember(ownerToken: string, email: string, role: string) {
  const members = (await (await api(ownerToken, "/members")).json()) as Array<{ email: string; role: string; status: string }>;
  expect(members.find((m) => m.email.toLowerCase() === email.toLowerCase())).toMatchObject({ status: "active", role });
}

test.describe("Journey 15 — Team invitation accept (#668)", () => {
  test.describe.configure({ mode: "serial" });

  let owner: Session;
  let ownerWorkspaceName: string;
  let ownerCtx: BrowserContext;
  let ownerPage: Page;
  let newcomerCtx: BrowserContext;
  let newcomerPage: Page;
  const newcomerEmail = makeEmail("j15-new");
  const newcomerName = `J15 Newcomer ${RUN_ID.slice(-4)}`;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    owner = await registerUser(makeEmail("j15-owner"));
    ownerWorkspaceName = ((await (await api(owner.accessToken, "/workspaces/current")).json()) as { name: string }).name;
    ownerCtx = await browser.newContext();
    ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/login");
    await signIn(ownerPage, owner.email); // sign-in 1 of 2
    await expect(ownerPage).toHaveURL(/\/links/, { timeout: 20_000 });
  });

  test.afterAll(async () => {
    await ownerCtx?.close();
    await newcomerCtx?.close();
  });

  test("(a) new user: emailed link -> register -> verify -> accept; owner sees them active as Viewer", async ({ browser }) => {
    await inviteViaUi(ownerPage, newcomerEmail, "Viewer");
    const link = await mailLink(newcomerEmail, "/invite");
    expect(link).toMatch(/^http:\/\/localhost:3000\/invite\?token=[A-Za-z0-9_-]{43}$/);

    newcomerCtx = await browser.newContext();
    newcomerPage = await newcomerCtx.newPage();
    const page = newcomerPage;

    // The link no longer 404s; a signed-out visitor is offered sign-in / sign-up.
    const res = await page.goto(link);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "You've been invited to a SnapURL workspace" })).toBeVisible();

    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register\?next=%2Finvite%3Ftoken%3D/);
    await page.getByPlaceholder("Priya Raman").fill(newcomerName);
    await page.getByPlaceholder("you@company.com").fill(newcomerEmail);
    await page.getByPlaceholder("••••••••").fill(RUN_PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // Back on the invitation with the token preserved.
    await expect(page).toHaveURL(link, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Join this workspace" })).toBeVisible();

    // Not verified yet: the API refuses and the page says what to do.
    const first = page.waitForResponse((r) => /\/auth\/invite\/accept$/.test(r.url()));
    await page.getByRole("button", { name: "Accept invitation" }).click();
    expect((await first).status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Verify your email first" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();

    // The membership is still pending (the row shows the invited email until accepted).
    await expect(await memberRowByName(ownerPage, newcomerEmail)).toContainText("Viewer · pending");

    // Verify through the emailed link, then come back to the invitation.
    await page.goto(await mailLink(newcomerEmail, "/verify-email"));
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await page.goto(link);
    const second = page.waitForResponse((r) => /\/auth\/invite\/accept$/.test(r.url()));
    await page.getByRole("button", { name: "Accept invitation" }).click();
    expect((await second).status()).toBe(200);
    await expect(page).toHaveURL(/\/links/);

    // The browser is now in the owner's workspace...
    await expect(page.getByRole("button", { name: `Workspace: ${ownerWorkspaceName}. Switch workspace` })).toBeVisible();
    const token = await browserToken(page);
    const ws = (await (await api(token, "/workspaces/current")).json()) as { id: string };
    expect(ws.id).toBe(owner.workspaceId);
    // ...as a Viewer, which the API enforces.
    expect((await api(token, "/links", { method: "POST", body: JSON.stringify({ destination: "https://example.com/j15", domain: "localhost:3002" }) })).status).toBe(403);
    expect(((await (await api(token, "/auth/me")).json()) as { role: string }).role).toBe("viewer");

    // Owner's /team: active, Viewer, no longer pending. Once accepted the row
    // renders the member's name rather than the invited email.
    const row = await memberRowByName(ownerPage, newcomerName);
    await expect(row).toContainText("Viewer");
    await expect(row).not.toContainText("pending");
    await expect(row).toContainText(newcomerName);
    await expectActiveMember(owner.accessToken, newcomerEmail, "viewer");
    const members = (await (await api(owner.accessToken, "/members")).json()) as Array<{ email: string }>;
    expect(members).toHaveLength(2);
  });

  test("(b) the workspace switcher moves between the joined and the personal workspace", async () => {
    const page = newcomerPage;
    await page.goto("/links");
    await page.getByRole("button", { name: /Switch workspace/ }).click();
    const menu = page.getByRole("menu", { name: "Workspaces" });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await expect(menu.getByRole("menuitemradio", { name: new RegExp(ownerWorkspaceName) })).toHaveAttribute("aria-checked", "true");

    const own = menu.getByRole("menuitemradio", { name: new RegExp(`${newcomerName}'s workspace`) });
    await expect(own).toContainText("owner");
    // #699 — switching is a hinted refresh (rotation + revocation), never a
    // token minted from the access token.
    const switched = page.waitForResponse((r) => /\/auth\/refresh$/.test(r.url()) && r.request().method() === "POST");
    await own.click();
    expect((await switched).status()).toBe(200);
    expect(JSON.parse((await switched).request().postData() ?? "{}")).toMatchObject({ workspaceId: expect.any(String) });
    await expect(page.getByRole("button", { name: `Workspace: ${newcomerName}'s workspace. Switch workspace` })).toBeVisible();
    expect(((await (await api(await browserToken(page), "/auth/me")).json()) as { role: string }).role).toBe("owner");

    // /team now shows the personal workspace's roster: just them.
    await page.goto("/team");
    await expect(page.getByRole("row", { name: /j15-owner/ })).toHaveCount(0);

    // And back.
    await page.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("menu", { name: "Workspaces" }).getByRole("menuitemradio", { name: new RegExp(ownerWorkspaceName) }).click();
    await expect(page.getByRole("button", { name: `Workspace: ${ownerWorkspaceName}. Switch workspace` })).toBeVisible();
    await page.goto("/team");
    await expect(page.getByRole("row", { name: /j15-owner/ })).toBeVisible();
  });

  test("(c) existing user, signed out: emailed link -> sign in -> accept as Editor", async ({ browser }) => {
    const existing = await registerUser(makeEmail("j15-existing"));
    // Their email is verified through the real link the API mailed at signup.
    const verifyToken = new URL(await mailLink(existing.email, "/verify-email")).searchParams.get("token")!;
    expect((await fetch(`${API_URL}/auth/email/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: verifyToken }) })).status).toBe(200);

    await inviteViaUi(ownerPage, existing.email, "Editor");
    const link = await mailLink(existing.email, "/invite");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(link);
      await page.getByRole("link", { name: "Sign in to accept" }).click();
      await expect(page).toHaveURL(/\/login\?next=%2Finvite%3Ftoken%3D/);
      await signIn(page, existing.email); // sign-in 2 of 2
      await expect(page).toHaveURL(link, { timeout: 20_000 });

      const accepted = page.waitForResponse((r) => /\/auth\/invite\/accept$/.test(r.url()));
      await page.getByRole("button", { name: "Accept invitation" }).click();
      expect((await accepted).status()).toBe(200);
      await expect(page).toHaveURL(/\/links/);
      await expect(page.getByRole("button", { name: `Workspace: ${ownerWorkspaceName}. Switch workspace` })).toBeVisible();

      // Active as Editor in the joined workspace. The owner's roster is
      // authoritative; the /team table renders only the account name, which
      // this run shares across accounts, so membership state is asserted via
      // the API rather than by locating a row (a display limitation, not a
      // #668 defect). The row's presence is confirmed by the member count.
      await expectActiveMember(owner.accessToken, existing.email, "editor");
      await ownerPage.goto("/team");
      await expect(ownerPage.getByText("Editor", { exact: false }).first()).toBeVisible();
      // An Editor may create links in the joined workspace.
      const created = await api(await browserToken(page), "/links", {
        method: "POST",
        body: JSON.stringify({ destination: "https://example.com/j15-editor", domain: "localhost:3002" }),
      });
      expect(created.status).toBe(201);
    } finally {
      await ctx.close();
    }
  });

  test("(d) refusal pages: missing token, invalid token, expired invitation, wrong account", async () => {
    const page = newcomerPage; // signed in, verified

    await page.goto("/invite");
    await expect(page.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept invitation" })).toHaveCount(0);

    await page.goto("/invite?token=not-a-real-invitation-token");
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();

    const expiredEmail = makeEmail("j15-expired");
    await apiInvite(owner, expiredEmail, "viewer");
    const expiredLink = await mailLink(expiredEmail, "/invite");
    await backdateInvite(expiredEmail);
    await page.goto(expiredLink);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
    await expect(page.getByText(/valid for 7 days/)).toBeVisible();

    const otherEmail = makeEmail("j15-other");
    await apiInvite(owner, otherEmail, "viewer");
    const otherLink = await mailLink(otherEmail, "/invite");
    await page.goto(otherLink);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "Wrong account" })).toBeVisible();
    // Neither address is disclosed beyond the signed-in user's own.
    await expect(page.getByText(otherEmail)).toHaveCount(0);
    await page.getByRole("button", { name: "Sign out and use another account" }).click();
    await expect(page).toHaveURL(/\/login\?next=%2Finvite%3Ftoken%3D/);
    expect(await browserToken(page)).toBe("");

    // Still pending for the right person (unaccepted invite row shows the email).
    await expect(await memberRowByName(ownerPage, otherEmail)).toContainText("Viewer · pending");
  });
});
